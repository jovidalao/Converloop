// Built-in capability "fine-tune" = APPEND user supplementary instructions after the official base prompt (does not replace it).
// Leaf module with no dependencies: can be imported by agents/* and runtime/* to avoid circular deps.

export const USER_INSTRUCTIONS_HEADER =
  "=== ADDITIONAL USER INSTRUCTIONS (apply on top of everything above) ===";

// When supplementary instructions exist, appends a marked block after base; otherwise returns base unchanged.
export function appendUserInstructions(
  base: string,
  instructions: string | undefined | null,
): string {
  const extra = instructions?.trim();
  if (!extra) return base;
  return `${base}\n\n${USER_INSTRUCTIONS_HEADER}\n${extra}`;
}
