import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { en, type Messages } from "./en";
import { zh } from "./zh";

export type Locale = "en" | "zh";
export type { Messages };

const resources: Record<Locale, Messages> = { en, zh };

const STORAGE_KEY = "lang-agent-locale";

// Recursively collect every leaf path of the message tree as a dot-joined
// string union, e.g. "sidebar.newChat". Gives `t()` autocomplete and stops
// typos at compile time.
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;

type InterpolationParams = Record<string, string | number>;

export type TFunction = (
  key: MessageKey,
  params?: InterpolationParams,
) => string;

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFunction;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

// Resolve a dot path against a locale tree. Falls back to the key itself if a
// value is missing so a missing translation is visible rather than blank.
function resolve(tree: Messages, key: string): string {
  let node: unknown = tree;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in node) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof node === "string" ? node : key;
}

// Replace {name} placeholders with the matching param value.
function interpolate(template: string, params?: InterpolationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in params ? String(params[name]) : match,
  );
}

function translate(
  locale: Locale,
  key: MessageKey,
  params?: InterpolationParams,
): string {
  return interpolate(resolve(resources[locale], key), params);
}

// Pick the initial locale: a previously stored choice wins; otherwise detect
// from the OS/browser language and fall back to English.
function detectLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "zh") return stored;
  const nav = navigator.language?.toLowerCase() ?? "";
  return nav.startsWith("zh") ? "zh" : "en";
}

// Provider-free lookup for contexts that can't use the hook (e.g. an error
// boundary mounted above LocaleProvider). Resolves against the stored locale.
export function staticT(key: MessageKey, params?: InterpolationParams): string {
  return translate(detectLocale(), key, params);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  // Reflect the active locale on <html lang> for accessibility and CSS hooks.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => {
    const t: TFunction = (key, params) => translate(locale, key, params);
    return {
      locale,
      setLocale: (next) => {
        localStorage.setItem(STORAGE_KEY, next);
        setLocaleState(next);
      },
      t,
    };
  }, [locale]);

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(LocaleContext);
  if (!ctx)
    throw new Error("useTranslation must be used within LocaleProvider");
  return ctx;
}
