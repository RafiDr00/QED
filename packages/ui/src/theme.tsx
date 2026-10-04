import { useCallback, useSyncExternalStore } from "react";

/**
 * Theme handling.
 *
 * Void is the primary theme and it is what `:root` already carries, so the
 * first paint needs no JavaScript at all and cannot flash. The bootstrap below
 * only re-reads a stored preference before paint; everything else is the
 * [data-theme] attribute.
 */

export const THEME_STORAGE_KEY = "qed-theme";
export const THEMES = ["void", "paper"] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = "void";

export const THEME_LABEL: Readonly<Record<Theme, string>> = {
  void: "Void",
  paper: "Paper",
};

/**
 * Runs in <head>, before first paint, synchronously. Sets nothing when there
 * is no stored preference: the default is already in the stylesheet.
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="paper"||t==="void"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;

function isTheme(value: string | null | undefined): value is Theme {
  return value === "void" || value === "paper";
}

export function readTheme(): Theme {
  if (typeof document === "undefined") return DEFAULT_THEME;
  const attribute = document.documentElement.getAttribute("data-theme");
  return isTheme(attribute) ? attribute : DEFAULT_THEME;
}

const listeners = new Set<() => void>();

export function setTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // A blocked storage API must not break the toggle.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, readTheme, () => DEFAULT_THEME);
  return [theme, setTheme];
}

export interface ThemeToggleProps {
  /** Rendered as the accessible name; the visible text is the other theme. */
  label?: string;
}

/**
 * Two states, so a button, not a menu. The label names the theme it switches
 * to, which is the thing the reader wants to know.
 */
export function ThemeToggle({ label = "Theme" }: ThemeToggleProps) {
  const [theme, set] = useTheme();
  const next: Theme = theme === "void" ? "paper" : "void";
  const onClick = useCallback(() => {
    set(next);
  }, [next, set]);

  return (
    <button
      className="qed-button"
      data-variant="quiet"
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next]}.`}
    >
      {THEME_LABEL[next]}
    </button>
  );
}
