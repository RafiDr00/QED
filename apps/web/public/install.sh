#!/bin/sh
# Installs qed: one binary, no daemon.
#
#   curl -fsSL https://qed.dev/install.sh | sh
#
# Downloads the binary built for this machine from the release, checks it
# against the release's SHA256SUMS, and refuses to install anything that does
# not match. Nothing is installed until the checksum agrees and the binary
# has answered --help.
#
# The release signs SHA256SUMS with Sigstore, as its own release workflow.
# With cosign on the PATH, that signature is checked before the checksums are
# trusted, so a mirror that swapped both a binary and its checksum is caught.
# Without cosign the checksum is still checked, and the script says the
# signature was not.
#
# Environment:
#   QED_VERSION            release tag to install, e.g. v0.3.0 (default: latest)
#   QED_INSTALL_DIR        where to put it                   (default: ~/.local/bin)
#   QED_DOWNLOAD_BASE      where the release files are       (default: GitHub Releases)
#   QED_REQUIRE_SIGNATURE  1 to refuse to install without a checked signature
#   QED_COSIGN             the cosign to check it with       (default: cosign)

set -eu

repo="RafiDr00/QED"
releases="https://github.com/$repo/releases"

fail() {
  printf 'qed install: %s\n' "$1" >&2
  exit 1
}

version="${QED_VERSION:-latest}"
if [ "$version" = "latest" ]; then
  default_base="$releases/latest/download"
else
  default_base="$releases/download/$version"
fi
base="${QED_DOWNLOAD_BASE:-$default_base}"
dir="${QED_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Linux) platform="linux" ;;
  Darwin) platform="darwin" ;;
  MINGW* | MSYS* | CYGWIN*) platform="win32" ;;
  *) fail "there is no binary for $(uname -s). Download one from $releases." ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch="x64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *) fail "there is no binary for $(uname -m). Download one from $releases." ;;
esac

name="qed-$platform-$arch"
target="$dir/qed"
if [ "$platform" = "win32" ]; then
  name="$name.exe"
  target="$dir/qed.exe"
fi

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$1" -O "$2"
  else
    fail "needs curl or wget to download."
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    fail "needs sha256sum or shasum to check the download."
  fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

fetch "$base/SHA256SUMS" "$tmp/SHA256SUMS" ||
  fail "could not download SHA256SUMS from $base."

# Who may have signed SHA256SUMS: this repository's release workflow, run for
# a version tag, vouched for by GitHub's OIDC issuer. Nothing else.
identity="^https://github\.com/$repo/\.github/workflows/release\.yml@refs/tags/v"
issuer="https://token.actions.githubusercontent.com"
cosign="${QED_COSIGN:-cosign}"

if command -v "$cosign" >/dev/null 2>&1; then
  if fetch "$base/SHA256SUMS.sigstore.json" "$tmp/SHA256SUMS.sigstore.json" 2>/dev/null; then
    "$cosign" verify-blob \
      --bundle "$tmp/SHA256SUMS.sigstore.json" \
      --certificate-identity-regexp "$identity" \
      --certificate-oidc-issuer "$issuer" \
      "$tmp/SHA256SUMS" >/dev/null 2>&1 ||
      fail "SHA256SUMS is not signed by $repo's release workflow. Nothing was installed."
    signature="checked with cosign"
  elif [ "${QED_REQUIRE_SIGNATURE:-}" = 1 ]; then
    fail "the release has no SHA256SUMS signature, and QED_REQUIRE_SIGNATURE is set. Nothing was installed."
  else
    signature="absent: this release predates signing"
  fi
elif [ "${QED_REQUIRE_SIGNATURE:-}" = 1 ]; then
  fail "QED_REQUIRE_SIGNATURE is set, but there is no cosign to check the signature with. Nothing was installed."
else
  signature="not checked: install cosign to check it"
fi

# sha256sum writes "<hex>  <name>", or "<hex> *<name>" in binary mode.
expected="$(awk -v n="$name" '$2 == n || $2 == "*" n { print $1 }' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || fail "the release has no $name. Download one from $releases."

fetch "$base/$name" "$tmp/$name" || fail "could not download $name from $base."

actual="$(sha256 "$tmp/$name")"
[ "$actual" = "$expected" ] ||
  fail "$name does not match the release's checksum (expected $expected, got $actual). Nothing was installed."

chmod +x "$tmp/$name"
"$tmp/$name" --help >/dev/null 2>&1 ||
  fail "$name downloaded and matched its checksum, but does not run on this machine. Nothing was installed."

mkdir -p "$dir"
mv -f "$tmp/$name" "$target"
printf 'installed %s\n' "$target"
printf '  checksum matched; signature %s\n' "$signature"

case ":$PATH:" in
  *":$dir:"*) ;;
  *) printf '%s is not on your PATH. Add it:\n  export PATH="%s:$PATH"\n' "$dir" "$dir" ;;
esac
