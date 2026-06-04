import type { MasteryType } from "../db/mastery-logic";

// `@` 上下文菜单的纯逻辑:从学习数据(弱项 / 表达缺口)里挑一条,把可说出来的文本插回
// 输入框。刻意只做「输入层自动完成」——插入的就是用户自己要说的话,不走隐藏上下文通道,
// 不动 orchestrator、不污染导师批改。纯函数,可单测。

export interface MentionItem {
  key: string;
  label: string;
  type: MasteryType;
  /** 选中后插入输入框的文本(表达缺口用地道说法,其余用标签)。 */
  insertText: string;
}

export function toMentionItem(row: {
  key: string;
  label: string;
  type: string;
  notes?: string | null;
}): MentionItem {
  const insertText =
    row.type === "expression_gap" && row.notes?.trim()
      ? row.notes.trim()
      : row.label;
  // type comes from the mastery_item TEXT column; the DB only stores MasteryType.
  return {
    key: row.key,
    label: row.label,
    type: row.type as MasteryType,
    insertText,
  };
}

// 找到光标处正在输入的 @mention(前面是行首或空白,避免命中邮箱 a@b)。返回 token 与 @ 的下标。
export function mentionQueryAt(
  input: string,
  caret: number,
): { token: string; start: number } | null {
  const before = input.slice(0, caret);
  const m = /(?:^|\s)@([\p{L}\p{N}_'-]*)$/u.exec(before);
  if (!m) return null;
  const token = m[1];
  return { token, start: caret - token.length - 1 };
}

export function filterMentions(
  items: MentionItem[],
  token: string,
  limit = 8,
): MentionItem[] {
  const q = token.toLowerCase();
  if (!q) return items.slice(0, limit);
  return items
    .filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        it.insertText.toLowerCase().includes(q),
    )
    .slice(0, limit);
}

// 把选中的条目替换掉光标前的 @token,补一个空格;返回新值与新光标位置。
export function applyMention(
  input: string,
  caret: number,
  item: MentionItem,
): { value: string; caret: number } | null {
  const q = mentionQueryAt(input, caret);
  if (!q) return null;
  const insert = `${item.insertText} `;
  return {
    value: input.slice(0, q.start) + insert + input.slice(caret),
    caret: q.start + insert.length,
  };
}
