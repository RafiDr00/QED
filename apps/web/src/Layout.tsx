import type { ReactNode } from "react";
import { Logo } from "@qed/ui";

/**
 * The marketing shell. It ships as static HTML: the only script on the page is
 * the theme bootstrap, so first paint needs nothing and cannot flash.
 */

export interface LayoutProps {
  children: ReactNode;
  /** Which nav item is the current page. */
  current?: "home" | "docs";
}

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/#verdicts", label: "Verdicts" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/docs/", label: "Docs" },
] as const;

export function Layout({ children, current = "home" }: LayoutProps) {
  return (
    <>
      <a className="qed-skip-link" href="#main">
        Skip to content
      </a>
      <header className="web-header">
        <div className="qed-page web-header-inner">
          <a className="web-home-link" href="/" aria-label="QED, home">
            <Logo variant="lockup" size="sm" decorative />
          </a>
          <nav aria-label="Primary">
            <ul className="web-nav">
              {NAV.map((item) => (
                <li key={item.href}>
                  <a
                    className="web-nav-link"
                    href={item.href}
                    {...(current === "docs" && item.href === "/docs/"
                      ? { "aria-current": "page" }
                      : {})}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="web-header-actions">
            {/* Wired by the inline theme script: this page ships no framework. */}
            <button
              className="qed-button"
              data-variant="quiet"
              type="button"
              id="qed-theme-toggle"
              aria-label="Switch to Paper theme (currently Void)"
            >
              Paper
            </button>
            <a className="qed-button web-cta" data-variant="primary" href="/docs/#install">
              Install
            </a>
          </div>
        </div>
      </header>

      <main id="main">{children}</main>

      <footer className="web-footer">
        <div className="qed-page web-footer-inner">
          <p className="t-mono-sm web-footer-note">
            QED &middot; deterministic verification &middot; qed.dev
          </p>
          <p className="t-mono-sm web-footer-note">
            Abstain rate 29% &middot; 7 verifiable of 41 changed &middot; median
            run 2m 14s
          </p>
        </div>
      </footer>
    </>
  );
}
