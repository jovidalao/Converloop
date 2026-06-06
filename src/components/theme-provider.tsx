import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

export type Theme = "light" | "dark" | "system";
export type Accent = "gray" | "blue" | "purple" | "claude";

const STORAGE_KEY = "lang-agent-theme";
const ACCENT_STORAGE_KEY = "lang-agent-accent";
const GLASS_STORAGE_KEY = "lang-agent-glass";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  accent: Accent;
  setAccent: (accent: Accent) => void;
  glassEnabled: boolean;
  setGlassEnabled: (enabled: boolean) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function loadAccent(): Accent {
  const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
  if (stored === "gray") return "gray";
  if (stored === "blue") return "blue";
  if (stored === "purple") return "purple";
  if (stored === "claude") return "claude";
  if (localStorage.getItem("lang-agent-palette") === "claude") return "claude";
  return "blue";
}

function loadGlassEnabled(): boolean {
  return localStorage.getItem(GLASS_STORAGE_KEY) !== "false";
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
      // Changing the NSWindow appearance makes AppKit re-lay-out the traffic
      // lights back to their default position; decorum only re-pins on resize,
      // so re-pin explicitly. Defer a frame so it lands after AppKit's relayout.
      requestAnimationFrame(() => {
        void invoke("reapply_traffic_lights").catch(() => {});
      });
    })
    .catch(() => {});
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system",
  );
  const [accent, setAccentState] = useState<Accent>(loadAccent);
  const [glassEnabled, setGlassEnabledState] =
    useState<boolean>(loadGlassEnabled);

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

  // Reflect the accent on <html>; the [data-accent] CSS rules swap --brand.
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  useEffect(() => {
    document.documentElement.dataset.glass = glassEnabled ? "on" : "off";
  }, [glassEnabled]);

  function setTheme(next: Theme) {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }

  function setAccent(next: Accent) {
    localStorage.setItem(ACCENT_STORAGE_KEY, next);
    setAccentState(next);
  }

  function setGlassEnabled(next: boolean) {
    localStorage.setItem(GLASS_STORAGE_KEY, String(next));
    setGlassEnabledState(next);
  }

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        accent,
        setAccent,
        glassEnabled,
        setGlassEnabled,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
