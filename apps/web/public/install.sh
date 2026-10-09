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
# Environment:
#   QED_VERSION        release tag to install, e.g. v0.1.0  (default: latest)
#   QED_INSTALL_DIR    where to put it                     (default: ~/.local/bin)
#   QED_DOWNLOAD_BASE  where the release files are         (default: GitHub Releases)

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

case ":$PATH:" in
  *":$dir:"*) ;;
  *) printf '%s is not on your PATH. Add it:\n  export PATH="%s:$PATH"\n' "$dir" "$dir" ;;
esac
