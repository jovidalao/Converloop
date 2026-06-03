// Agent Runtime —— hook 派发缝隙的类型层(Phase 1)。
// 见 docs/agent-runtime-plan.md。这里只定义类型与 hook 名,不含运行逻辑。

import type { TutorAnalysis } from "../agents/schema";
import type { WeakItem } from "../agents/tutor";
import type { AgentModifiers } from "../db/conversations";
import type { ReviewItem } from "../db/mastery";
import type { ProficiencySnapshot } from "../lib/proficiency";
import type { CorrectionPreferenceFlags } from "../profile/preferences";
import type { ModelProvider } from "../providers/types";

// 运行阶段 hook。Phase 1 只接线前两个(reply ∥ observe);其余先登记为常量、
// 不接线(YAGNI),标记未来的挂载点,见 docs/agent-runtime-plan.md 第三节。
export const HOOKS = {
  conversationReply: "conversation.reply",
  conversationObserve: "conversation.observe",
  // 以下尚未接线:
  conversationBeforeUserInput: "conversation.before_user_input",
  conversationAfterReply: "conversation.after_reply",
  conversationAction: "conversation.action",
  conversationIdle: "conversation.idle",
  conversationEnd: "conversation.end",
  turnExplain: "turn.explain",
  turnTranslate: "turn.translate",
  profileMaintain: "profile.maintain",
} as const;

export type HookName = (typeof HOOKS)[keyof typeof HOOKS];

export type AgentKind =
  | "reply_producer"
  | "observer"
  | "transformer"
  | "action"
  | "background";

// 能力库展示用的元信息(普通用户看「这个能力做什么/何时跑/读写什么」,而非 hook/schema)。
export interface AgentCard {
  title: string;
  description: string;
  timing: string; // 什么时候运行
  reads: string; // 能读什么数据
  writes: string; // 是否会提出写入学习记忆
  canDisable: boolean; // 主回复不可关;observer / action 可关
}

// 注册表导出给能力库的一条目录项。
export interface AgentCatalogEntry {
  id: string;
  kind: AgentKind;
  enabled: boolean;
  scope?: ActionScope;
  card?: AgentCard;
}

export type ConversationKind = "practice" | "learning_agent";

export interface Langs {
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
}

// 主回复完成 / 批改到达时回推 UI 的回调(orchestrator 的 TurnCallbacks 即此形状)。
export interface ConversationCallbacks {
  onReplyDelta: (delta: string) => void;
  /** 对话流式结束、可继续输入时触发;批改仍在后台进行。 */
  onReplyComplete?: (reply: string) => void;
  onAnalysis: (
    analysis: TutorAnalysis | null,
    opts?: { error?: string; proseFeedback?: string },
  ) => void;
}

// 两种会话的共享上下文。所有 DB 查询在 orchestrator 里查好后塞进来,Agent 只读不查。
interface BaseContext {
  provider: ModelProvider;
  conversationId: string;
  /** 本轮 id(UI 传入或本地生成),observer 写回挂这条 turn。 */
  turnId: string;
  userInput: string;
  langs: Langs;
  summary: string;
  history: string;
  callbacks: ConversationCallbacks;
  /** turn 行落库后 resolve(= 可以安全写 analysis_json);落库失败则 reject。
   *  observer 在写回前等它,避免往不存在的行写。 */
  turnPersisted: Promise<string>;
}

export interface PracticeContext extends BaseContext {
  kind: "practice";
  profileSlice: string;
  conversationPreferences: string;
  tutorPreferences: string;
  tutorFlags: CorrectionPreferenceFlags;
  /** 导师只看直近几轮;对话看全部水位后原文。 */
  tutorHistory: string;
  weakList: WeakItem[];
  reviewItems: ReviewItem[];
  proficiency: ProficiencySnapshot;
  /** 会话级调节(分支带来的难度/角色/第二天等);普通会话为空对象。 */
  agentModifiers: AgentModifiers;
}

export interface LearningContext extends BaseContext {
  kind: "learning_agent";
  experiencePreferences: string;
  agentName: string;
  agentPrompt: string;
  dataContext: string;
  kickoff: boolean;
}

export type ConversationContext = PracticeContext | LearningContext;

// reply_producer:每会话按 kind 唯一,流式产出主回复。
export interface ReplyProducer {
  id: string;
  kind: "reply_producer";
  conversationKind: ConversationKind;
  card?: AgentCard;
  run: (
    ctx: ConversationContext,
    onDelta: (delta: string) => void,
  ) => Promise<string>;
}

// observer:与主回复并行,产出结构化信号并自行走代码记账(LLM 不碰计数)。
// Phase 1 只在 practice 热路径运行,故只见 PracticeContext。
export interface Observer {
  id: string;
  kind: "observer";
  card?: AgentCard;
  run: (ctx: PracticeContext) => Promise<void>;
}

// action(conversation.action hook):用户点击触发的会话动作(分支、调换角色、升降难度…)。
// scope="session" 作用于整个会话(渲染在动作条);"turn" 作用于某条 turn(渲染在该轮按钮)。
// 多数 action 只是「代码建分支 + 注入修饰符」,run 返回要跳转的新会话 id。
export type ActionScope = "session" | "turn";

export interface ActionContext {
  conversationId: string;
  sourceTurnId?: string;
}

export interface ActionResult {
  /** 新建分支会话的 id;UI 据此切换过去。 */
  navigateTo?: string;
}

export interface ActionAgent {
  id: string;
  kind: "action";
  scope: ActionScope;
  label: string;
  description?: string;
  card?: AgentCard;
  run: (ctx: ActionContext) => Promise<ActionResult>;
}
