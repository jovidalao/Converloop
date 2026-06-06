// Evidence-driven proficiency snapshot (pure logic, unit-testable; no DB/Tauri).
// config.level is user-supplied and set once; this derives a dynamic reading from recent real performance to fine-tune
// the conversation agent's difficulty and reply length (see conversation agent). Still "code does the accounting, LLM does not touch it":
// thresholds/bands live in code, are adjustable and testable, and the LLM only receives a single natural-language hint.

export interface ProficiencyMetrics {
  sampleTurns: number; // number of corrected turns (evidence volume)
  avgInputWords: number; // average input word count for non-gap turns (production length)
  errorsPer100Words: number; // errors per 100 words (production accuracy)
  gapRate: number; // fraction of turns with an expression_gap (native-language fallback rate)
  assistRate: number; // number of explain/bilingual requests per turn (comprehension difficulty)
  knownCount: number;
  strugglingCount: number;
}

export type ProductionBand = "emerging" | "developing" | "consolidating";
export type ComprehensionStrain = "low" | "moderate" | "high";

export interface ProficiencySnapshot {
  hasEvidence: boolean; // false when there is insufficient evidence; do not override the static level
  productionBand: ProductionBand;
  comprehensionStrain: ComprehensionStrain;
  calibrationHint: string; // one-sentence hint for the conversation agent (empty when evidence is insufficient)
  metrics: ProficiencyMetrics;
}

// Too little evidence — don't adjust difficulty; defer to the user-supplied level.
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
