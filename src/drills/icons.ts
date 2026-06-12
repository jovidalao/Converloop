// Allowed drill icon names (drill@1 frontmatter `icon`). Pure data — the React mapping lives in
// components/drill-icons.tsx; the authoring spec embeds this list so external AIs pick valid names.
export const DRILL_ICON_NAMES = [
  "zap",
  "headphones",
  "mic",
  "target",
  "dumbbell",
  "languages",
  "ear",
  "brain",
  "timer",
  "sparkles",
  "pen-line",
  "message-circle",
  "book-open-check",
] as const;
