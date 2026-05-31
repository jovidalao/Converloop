// 证据驱动的水平快照(纯逻辑,可单测;不碰 DB/Tauri)。
// config.level 是用户自填、一次性的;这里从近期真实表现派生一个动态读数,用来微调
// 对话 agent 的难度与回复长度(见 conversation agent)。仍是「代码记账,LLM 不碰」:
// 阈值/分档在代码里、可调可测,LLM 只拿到一句自然语言提示。

export interface ProficiencyMetrics {
  sampleTurns: number; // 有批改的轮次数(证据量)
  avgInputWords: number; // 非缺口轮的平均输入词数(产出长度)
  errorsPer100Words: number; // 每百词错误数(产出准确度)
  gapRate: number; // 有 expression_gap 的轮次占比(母语回退频率)
  assistRate: number; // 每轮请求讲解/双语的次数(理解吃力)
  knownCount: number;
  strugglingCount: number;
}

export type ProductionBand = "emerging" | "developing" | "consolidating";
export type ComprehensionStrain = "low" | "moderate" | "high";

export interface ProficiencySnapshot {
  hasEvidence: boolean; // 证据不足时为 false,不要干扰静态 level
  productionBand: ProductionBand;
  comprehensionStrain: ComprehensionStrain;
  calibrationHint: string; // 给对话 agent 的一句话(证据不足则为空)
  metrics: ProficiencyMetrics;
}

// 证据太少就别瞎调难度,交给用户自填的 level。
const MIN_SAMPLE = 3;

function bandOf(m: ProficiencyMetrics): ProductionBand {
  if (m.avgInputWords >= 12 && m.gapRate < 0.1 && m.errorsPer100Words < 8) {
    return "consolidating";
  }
  if (m.avgInputWords < 6 || m.gapRate > 0.3 || m.errorsPer100Words > 25) {
    return "emerging";
  }
  return "developing";
}

function strainOf(m: ProficiencyMetrics): ComprehensionStrain {
  if (m.assistRate >= 0.5) return "high";
  if (m.assistRate >= 0.15) return "moderate";
  return "low";
}

const PRODUCTION_HINT: Record<ProductionBand, string> = {
  emerging:
    "They currently produce short, simple sentences — keep your language plain and concrete, and introduce new structures one at a time.",
  developing:
    "They handle moderately complex sentences — you can gently stretch them with slightly richer language.",
  consolidating:
    "They produce longer, fairly fluent sentences — feel free to use richer, more idiomatic language and longer turns.",
};

const COMPREHENSION_HINT: Record<ComprehensionStrain, string> = {
  low: "They rarely ask for help understanding replies, so you can challenge them.",
  moderate:
    "They sometimes ask for help understanding replies — keep explanations within reach.",
  high: "They often ask for help understanding replies, so favor simpler phrasing and shorter replies for now.",
};

export function computeProficiency(m: ProficiencyMetrics): ProficiencySnapshot {
  if (m.sampleTurns < MIN_SAMPLE) {
    return {
      hasEvidence: false,
      productionBand: "developing",
      comprehensionStrain: "low",
      calibrationHint: "",
      metrics: m,
    };
  }
  const productionBand = bandOf(m);
  const comprehensionStrain = strainOf(m);
  return {
    hasEvidence: true,
    productionBand,
    comprehensionStrain,
    calibrationHint: `${PRODUCTION_HINT[productionBand]} ${COMPREHENSION_HINT[comprehensionStrain]}`,
    metrics: m,
  };
}
