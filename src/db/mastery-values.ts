export const MASTERY_TYPE_VALUES = [
  "vocab",
  "grammar",
  "collocation",
  "error_pattern",
  "expression_gap",
] as const;

export type MasteryType = (typeof MASTERY_TYPE_VALUES)[number];

export const TARGET_LANGUAGE_MASTERY_TYPE_VALUES = [
  "vocab",
  "grammar",
  "collocation",
  "error_pattern",
] as const;

export type TargetLanguageMasteryType =
  (typeof TARGET_LANGUAGE_MASTERY_TYPE_VALUES)[number];

export const GAP_KEY_ITEM_TYPE_VALUES = [
  "vocab",
  "grammar",
  "collocation",
] as const;

export const MASTERY_STATUS_VALUES = [
  "struggling",
  "learning",
  "known",
] as const;

export type MasteryStatus = (typeof MASTERY_STATUS_VALUES)[number];

export const SIGNAL_KIND_VALUES = [
  "error",
  "correct",
  "introduced",
  "gap",
] as const;

export type SignalKind = (typeof SIGNAL_KIND_VALUES)[number];

export const MASTERY_UPDATE_SIGNAL_VALUES = ["correct", "introduced"] as const;

export type MasteryUpdateSignal = (typeof MASTERY_UPDATE_SIGNAL_VALUES)[number];
