import {
  BlocksIcon,
  BotIcon,
  DatabaseIcon,
  FileTextIcon,
  GitBranchIcon,
  GraduationCapIcon,
  ListChecksIcon,
  PencilRulerIcon,
  ShieldCheckIcon,
  WaypointsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import {
  DATA_SCOPE_LABELS,
  LEARNING_DATA_SCOPES,
  type LearningDataScope,
} from "../db/learning-agents";

export const APP_DESIGN_DATA_SCOPES_HASH = "design-data-scopes";

type OverviewItem = {
  title: string;
  body: string;
  icon: ReactNode;
};

type MatrixRow = {
  name: string;
  timing: string;
  reads: string;
  output: string;
  writes: string;
};

const HOT_PATH: OverviewItem[] = [
  {
    title: "Conversation Agent",
    body: "每轮立即流式回复。它读学习者 MD 档案和上下文,负责自然对话,不做批改记账。",
    icon: <BotIcon className="size-4" />,
  },
  {
    title: "Tutor Agent",
    body: "与对话并行运行。它读 SQLite 里的薄弱项,输出结构化批改、掌握信号和表达缺口。",
    icon: <ListChecksIcon className="size-4" />,
  },
  {
    title: "代码记账",
    body: "LLM 只给离散观察;计数、置信度、状态变化由代码从信号确定性派生并写入数据库。",
    icon: <ShieldCheckIcon className="size-4" />,
  },
];

const AGENT_ROWS: MatrixRow[] = [
  {
    name: "Conversation",
    timing: "每轮热路径",
    reads: "MD 档案 + 对话历史 + 复习候选",
    output: "目标语言自然回复",
    writes: "turn.reply",
  },
  {
    name: "Tutor",
    timing: "每轮热路径",
    reads: "SQLite 薄弱表 + 用户输入",
    output: "TutorAnalysis JSON",
    writes: "mastery_event / mastery_item",
  },
  {
    name: "Profile Maintainer",
    timing: "后台偶尔运行",
    reads: "现有 MD + SQLite 聚合 + 近期对话",
    output: "更新后的 learner-profile.md",
    writes: "MD 档案",
  },
  {
    name: "Task / Learning",
    timing: "用户创建学习项目或专项课时",
    reads: "用户目标 + 选定学习数据 scope",
    output: "项目计划 / 专项课回复",
    writes: "learning_project / learning_agent / turn",
  },
  {
    name: "Explain / Reply Suggestion",
    timing: "用户点按钮时",
    reads: "被点消息 + 上下文 + MD 档案切片",
    output: "讲解、双语、推荐回复",
    writes: "turn 的按需结果",
  },
];

const STORAGE_ITEMS: OverviewItem[] = [
  {
    title: "SQLite 是地面真相",
    body: "保存 mastery_item、mastery_event、conversation、turn、learning_agent、agent_job 等结构化记录,可查询、可排序、可重算。",
    icon: <DatabaseIcon className="size-4" />,
  },
  {
    title: "MD 档案是叙述层",
    body: "保存用户人设、兴趣、正在练什么、已掌握什么、回避什么和个人笔记。它让对话 agent 知道这个人是谁。",
    icon: <FileTextIcon className="size-4" />,
  },
  {
    title: "两层不互相替代",
    body: "只用 MD 会丢可信计数;只用 SQLite 会丢定性上下文。所以对话读 MD,导师读 SQLite,维护 agent 再把聚合信息写回 MD。",
    icon: <GitBranchIcon className="size-4" />,
  },
];

const CUSTOMIZATION_ITEMS: OverviewItem[] = [
  {
    title: "微调内置能力",
    body: "在能力库里给内置能力追加补充指令,例如让讲解更短、例子更贴近你的行业。追加不会替换官方基础 prompt。",
    icon: <BlocksIcon className="size-4" />,
  },
  {
    title: "创建自定义 Observer",
    body: "让它每轮旁路观察并把结果放进教练面板。需要写入学习数据时,只能提出 memory proposal,由你确认后代码执行。",
    icon: <WaypointsIcon className="size-4" />,
  },
  {
    title: "设计专项课",
    body: "专项课是老师型会话,适合面试、商务邮件、旅行场景等目标。它可读取指定学习数据 scope,但课堂里的母语问题不会被普通 Tutor 误记账。",
    icon: <GraduationCapIcon className="size-4" />,
  },
];

const DATA_SCOPE_DETAILS: Record<
  LearningDataScope,
  { source: string; use: string; caution: string }
> = {
  profile: {
    source: "维护 agent 写入的学习者 MD 档案。",
    use: "适合让能力知道你的兴趣、偏好、长期目标和最近练习方向。",
    caution: "它是叙述层,不适合拿来判断准确计数或排序。",
  },
  comfortable: {
    source: "代码从 SQLite 已掌握项里选出的稳定脚手架。",
    use: "适合让老师复用你已经会的表达,把新内容接到旧能力上。",
    caution: "不要把它当成全部已学内容,这里只给少量高价值候选。",
  },
  weak_all: {
    source: "SQLite 中仍未掌握的词汇、语法、搭配、错误模式和表达缺口。",
    use: "适合通用观察 Agent、综合复习课和需要定向补弱的能力。",
    caution: "范围最大,如果任务只关心语法或表达缺口,优先选更窄的 scope。",
  },
  weak_grammar: {
    source: "SQLite 中最近仍薄弱的语法和错误模式。",
    use: "适合语法专项、错误模式归纳、面试前语言体检。",
    caution: "它不包含普通词汇和表达缺口,不要用它做全量学习报告。",
  },
  expression_gaps: {
    source: "Tutor 从母语/混说输入里识别出的“想说但说不出”。",
    use: "适合做场景表达训练、可复用句型课、真实意图改写。",
    caution: "这是意图层数据,不要把每个 gap 都当成用户已经学会的表达。",
  },
  today_turns: {
    source: "最近 24 小时或当天的对话、回复和批改摘要。",
    use: "适合今日复盘、课后总结和根据刚练过内容继续出题。",
    caution: "它偏近期,不代表长期薄弱排序。",
  },
  due_review: {
    source: "代码按薄弱程度和久未出现程度选出的复习候选。",
    use: "适合复习课、热身题和对话里自然插入旧知识。",
    caution: "这是候选列表,Agent 应该自然使用,不要机械逐条念完。",
  },
  proficiency: {
    source: "代码根据最近表现推断的难度校准。",
    use: "适合控制题目难度、语速、解释深度和目标语言比例。",
    caution: "它是粗粒度读数,不能替代具体 mastery item。",
  },
};

const DESIGN_RULES = [
  "先写清楚入口:每轮自动、选中文字、回复按钮、衍生新对话,还是专项课。",
  "再定义读取范围:profile、薄弱项、表达缺口、今日对话、复习候选或熟练项。",
  "输出要可验证:教练面板注释、结构化 proposal、课程回复或新对话上下文。",
  "不要让 Agent 直接改计数、密钥、provider 或密钥设置;这些只能由代码和用户确认动作处理。",
  "同一类学习问题要复用稳定 mastery_key,否则复习和统计会被拆散。",
];

function InfoCard({ item }: { item: OverviewItem }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-ui-body font-semibold">
        <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          {item.icon}
        </span>
        {item.title}
      </div>
      <p className="mt-2 mb-0 text-ui-body leading-relaxed text-ui-muted">
        {item.body}
      </p>
    </div>
  );
}

function Section({
  title,
  intro,
  id,
  children,
}: {
  title: string;
  intro?: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-16 border-t py-5">
      <h3 className="m-0 text-ui-body font-semibold">{title}</h3>
      {intro && (
        <p className="mt-1 mb-3 max-w-3xl text-ui-body leading-relaxed text-ui-muted">
          {intro}
        </p>
      )}
      {children}
    </section>
  );
}

export function AppDesignView() {
  useEffect(() => {
    if (window.location.hash !== `#${APP_DESIGN_DATA_SCOPES_HASH}`) return;
    requestAnimationFrame(() => {
      document
        .getElementById(APP_DESIGN_DATA_SCOPES_HASH)
        ?.scrollIntoView({ block: "start" });
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    });
  }, []);

  return (
    <div className="flex h-full max-w-5xl flex-col overflow-y-auto px-6 pt-14 pb-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <PencilRulerIcon className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="mt-0 mb-1 text-ui-title font-semibold">设计说明</h2>
          <p className="m-0 max-w-3xl text-ui-body leading-relaxed text-ui-muted">
            这页解释本 app 的 Agent 分工、存储边界和定制化原则。目标是帮助你判断
            应该改 prompt、建专项课、加 Observer,还是直接编辑学习数据。
          </p>
        </div>
      </div>

      <Section
        title="核心心智模型"
        intro="每轮对话被拆成自然回复、结构化观察和确定性记账三件事。快的留在热路径,重的放到后台或按需触发。"
      >
        <div className="grid gap-3 md:grid-cols-3">
          {HOT_PATH.map((item) => (
            <InfoCard key={item.title} item={item} />
          ))}
        </div>
      </Section>

      <Section
        title="Agent 分工"
        intro="设计自己的能力时,先看它属于哪个入口和运行时机。不要把批改、对话、记账和课程规划塞进同一个 prompt。"
      >
        <div className="overflow-x-auto rounded-lg border">
          <div className="grid min-w-[760px] grid-cols-[1.1fr_1fr_1.4fr_1.4fr_1fr] gap-0 bg-muted px-3 py-2 text-ui-caption font-medium text-ui-muted">
            <span>Agent</span>
            <span>时机</span>
            <span>读取</span>
            <span>输出</span>
            <span>写入</span>
          </div>
          {AGENT_ROWS.map((row) => (
            <div
              key={row.name}
              className="grid min-w-[760px] grid-cols-[1.1fr_1fr_1.4fr_1.4fr_1fr] gap-0 border-t px-3 py-2 text-ui-caption leading-relaxed"
            >
              <span className="font-medium text-foreground">{row.name}</span>
              <span className="text-ui-muted">{row.timing}</span>
              <span>{row.reads}</span>
              <span>{row.output}</span>
              <span className="font-mono text-ui-muted">{row.writes}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="存储设计"
        intro="这里刻意分成结构化事实和可读叙述。用户可以理解并编辑数据,但计数和状态仍由代码保持一致。"
      >
        <div className="grid gap-3 md:grid-cols-3">
          {STORAGE_ITEMS.map((item) => (
            <InfoCard key={item.title} item={item} />
          ))}
        </div>
      </Section>

      <Section
        id={APP_DESIGN_DATA_SCOPES_HASH}
        title="可读数据范围"
        intro="创建自定义 Agent 时选择的“可读数据”,决定它能看到哪些学习上下文。范围越窄越容易稳定;范围越宽越适合综合总结。"
      >
        <p className="mt-0 mb-3 rounded-md bg-muted px-3 py-2 text-ui-caption leading-relaxed text-ui-muted">
          此外,自定义 Agent 始终能看到当前输入和必要的近期上下文;下面这些 scope
          是额外注入的学习数据。
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {LEARNING_DATA_SCOPES.map((scope) => {
            const label = DATA_SCOPE_LABELS[scope];
            const name = label.split(":")[0];
            const desc = label.replace(`${name}:`, "").trim();
            const detail = DATA_SCOPE_DETAILS[scope];
            return (
              <div key={scope} className="rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ui-body">{name}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-ui-caption text-ui-muted">
                    {scope}
                  </span>
                </div>
                <p className="mt-1 mb-2 text-ui-body leading-relaxed text-ui-muted">
                  {desc}
                </p>
                <dl className="m-0 grid gap-1 text-ui-caption leading-relaxed">
                  <div>
                    <dt className="inline text-ui-muted">来源: </dt>
                    <dd className="inline text-foreground">{detail.source}</dd>
                  </div>
                  <div>
                    <dt className="inline text-ui-muted">适合: </dt>
                    <dd className="inline text-foreground">{detail.use}</dd>
                  </div>
                  <div>
                    <dt className="inline text-ui-muted">注意: </dt>
                    <dd className="inline text-foreground">{detail.caution}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="你可以定制什么"
        intro="定制能力时优先选最小入口:能追加补充指令就不新建 Agent;能建专项课就不改热路径 Tutor。"
      >
        <div className="grid gap-3 md:grid-cols-3">
          {CUSTOMIZATION_ITEMS.map((item) => (
            <InfoCard key={item.title} item={item} />
          ))}
        </div>
      </Section>

      <Section title="设计检查清单">
        <ol className="m-0 grid gap-2 pl-5 text-ui-body leading-relaxed">
          {DESIGN_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
