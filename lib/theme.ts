export const THEME_CACHE = "mantu-theme";

export type AppTheme = "light" | "dark";

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;
type ThemeRoot = Pick<HTMLElement, "dataset" | "style">;

export function normalizeTheme(value: unknown): AppTheme | null {
  return value === "dark" || value === "light" ? value : null;
}

export function readInitialTheme(
  storage: Pick<ThemeStorage, "getItem"> | undefined =
    typeof window === "undefined" ? undefined : window.localStorage,
  prefersDark: (() => boolean) | undefined =
    typeof window === "undefined"
      ? undefined
      : () => window.matchMedia("(prefers-color-scheme: dark)").matches,
): AppTheme {
  try {
    const saved = normalizeTheme(storage?.getItem(THEME_CACHE));
    if (saved) return saved;
  } catch {
    // Storage can be unavailable in hardened WebViews; use the system theme.
  }
  try {
    return prefersDark?.() ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(
  theme: AppTheme,
  root: ThemeRoot = document.documentElement,
) {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function writeThemeCache(
  theme: AppTheme,
  storage: Pick<ThemeStorage, "setItem"> | undefined =
    typeof window === "undefined" ? undefined : window.localStorage,
) {
  try {
    storage?.setItem(THEME_CACHE, theme);
    return true;
  } catch {
    return false;
  }
}
