import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "lang-agent-theme";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// Resolve the active theme to a concrete light/dark and reflect it on <html>.
function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  // Sync the native macOS window appearance so the traffic-light buttons
  // (notably their unfocused gray) match the in-app theme. In "system" mode we
  // must reset to null (follow OS): forcing an explicit window theme pins the
  // webview's prefers-color-scheme to that value, which would stop "system"
  // from ever tracking the OS appearance again.
  void getCurrentWindow()
    .setTheme(theme === "system" ? null : dark ? "dark" : "light")
    .then(() => {
      // After releasing a previously-pinned theme, the media query may only
      // reflect the OS once setTheme settles; re-read so "system" lands right
      // even if no "change" event fires.
      if (theme === "system") {
        document.documentElement.classList.toggle("dark", systemPrefersDark());
      }
    })
    .catch(() => {});
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system",
  );

  // Apply on mount + whenever the choice changes; keep "system" live by
  // listening to the OS preference while it's selected.
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  function setTheme(next: Theme) {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
