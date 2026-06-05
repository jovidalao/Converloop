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
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t py-5">
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
