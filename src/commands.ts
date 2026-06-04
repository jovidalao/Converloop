// 对话栏斜杠命令(/btw、/help 及现有会话动作的薄入口)。
// 这里只做「命令定义 + 解析/匹配」的纯逻辑;UI 在 SlashMenu,落地在 ChatView。
// 刻意不接入 Agent Runtime 的 hook 体系:斜杠命令是输入层关注点,先做轻量独立层。
// 依赖只取 enablement 这一叶子模块(纯 localStorage,无 db/provider 副作用),保持可测。

import { isAgentEnabled } from "./runtime/enablement";

export type SlashCommandKind = "message" | "action" | "meta";

export interface SlashCommand {
  /** 不含斜杠的命令名,小写,如 "btw"。 */
  name: string;
  description: string;
  /** 参数提示(message 类才有),如 "<想问 AI 的话>"。 */
  argsHint?: string;
  kind: SlashCommandKind;
  /** action 类:复用现有 conversation.action Agent 的 id。 */
  actionId?: string;
}

// 命令清单。message/meta 是新增行为;action 类是现有会话动作(builtin:action:*)的薄入口,
// 不引入新后端逻辑——执行时仍走 ChatView 的 runConversationAction → beginAction。
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "btw",
    description: "顺便问一句:本轮不计入上下文,也不批改",
    argsHint: "<想问 AI 的话>",
    kind: "message",
  },
  {
    name: "help",
    description: "查看所有可用命令",
    kind: "meta",
  },
  {
    name: "harder",
    description: "提高难度:基于当前对话另开一个更难的分支",
    kind: "action",
    actionId: "builtin:action:harder",
  },
  {
    name: "easier",
    description: "降低难度:另开一个更简单的分支",
    kind: "action",
    actionId: "builtin:action:easier",
  },
  {
    name: "swap",
    description: "调换角色:另开一个角色互换的分支",
    kind: "action",
    actionId: "builtin:action:swap_roles",
  },
  {
    name: "restart",
    description: "重新开始:保留设定,另开一个空白分支重练",
    kind: "action",
    actionId: "builtin:action:restart",
  },
  {
    name: "next-day",
    description: "第二天继续:另开一个承接剧情的新一天分支",
    kind: "action",
    actionId: "builtin:action:next_day",
  },
];

export interface ParsedSlash {
  command: SlashCommand;
  /** 命令词之后的参数(已去首尾空白);无参数为空串。 */
  rest: string;
}

// 提交时的命令路由:必须行首即 /,首词为已知命令名。未知命令返回 null(当普通文本发送)。
export function parseSlashInput(raw: string): ParsedSlash | null {
  const m = /^\/([a-zA-Z][\w-]*)(?:\s+([\s\S]*))?$/.exec(raw);
  if (!m) return null;
  const command = SLASH_COMMANDS.find((c) => c.name === m[1].toLowerCase());
  if (!command) return null;
  return { command, rest: (m[2] ?? "").trim() };
}

// 菜单态判定:输入以 / 开头、命令词还在编辑(尚无空格)时返回正在输入的命令词(可空串)。
// 一旦命令词后出现空格(进入「输入参数」态)或不以 / 开头,返回 null(菜单关闭)。
export function slashMenuToken(input: string): string | null {
  const m = /^\/([a-zA-Z][\w-]*)?$/.exec(input);
  return m ? (m[1] ?? "") : null;
}

export interface SlashMenuContext {
  /** 能否衍生分支(practice 且非草稿);为假时隐藏 action 类命令。 */
  canDerive: boolean;
}

// 给菜单用的过滤+排序:按命令词前缀/包含匹配,startsWith 优先;
// action 类在不能衍生或对应 Agent 被禁用时不出现。
export function matchSlashCommands(
  token: string,
  ctx: SlashMenuContext,
): SlashCommand[] {
  const q = token.toLowerCase();
  const available = SLASH_COMMANDS.filter((c) => {
    if (c.kind === "action") {
      if (!ctx.canDerive) return false;
      if (c.actionId && !isAgentEnabled(c.actionId)) return false;
    }
    return true;
  });
  if (!q) return available;
  return available
    .filter((c) => c.name.includes(q))
    .sort(
      (a, b) => (a.name.startsWith(q) ? 0 : 1) - (b.name.startsWith(q) ? 0 : 1),
    );
}
