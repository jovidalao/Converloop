// 内置能力「微调」= 在官方基础 prompt 之后【追加】用户补充指令(不替换基础 prompt)。
// 叶子模块,无依赖:agents/* 与 runtime/* 都可引用,避免循环依赖。

export const USER_INSTRUCTIONS_HEADER =
  "=== ADDITIONAL USER INSTRUCTIONS (apply on top of everything above) ===";

// 有补充指令时,在 base 之后追加一段带标记的块;无则原样返回 base。
export function appendUserInstructions(
  base: string,
  instructions: string | undefined | null,
): string {
  const extra = instructions?.trim();
  if (!extra) return base;
  return `${base}\n\n${USER_INSTRUCTIONS_HEADER}\n${extra}`;
}
