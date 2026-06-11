import type { TFunction } from "@/i18n";
import { MissingApiKeyError } from "../orchestrator";

export type DisplayError = {
  summary: string;
  detail?: string;
};

// Normalize a thrown error for display: well-known provider failures (auth /
// quota / timeout / network) map to short localized summaries with the raw
// message kept as expandable detail; long or structured raw messages collapse
// to a generic summary; short plain messages pass through as-is.
export function describeError(e: unknown, t: TFunction): DisplayError {
  const raw = e instanceof Error ? e.message : String(e);
  if (e instanceof MissingApiKeyError) {
    return { summary: raw };
  }
  const lower = raw.toLowerCase();
  const detail = raw.trim() ? raw : undefined;
  if (
    /\b(401|403)\b/.test(lower) ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("invalid api key")
  ) {
    return { summary: t("errors.requestAuth"), detail };
  }
  if (
    /\b(429)\b/.test(lower) ||
    lower.includes("quota") ||
    lower.includes("rate limit")
  ) {
    return { summary: t("errors.requestQuota"), detail };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return { summary: t("errors.requestTimeout"), detail };
  }
  if (
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("offline")
  ) {
    return { summary: t("errors.requestNetwork"), detail };
  }
  if (raw.length > 180 || raw.includes("\n") || /^[{[]/.test(raw.trim())) {
    return { summary: t("errors.requestFailed"), detail };
  }
  return { summary: raw };
}
