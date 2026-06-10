import anthropicLogo from "@lobehub/icons-static-svg/icons/anthropic.svg?raw";
import chatglmLogo from "@lobehub/icons-static-svg/icons/chatglm-color.svg?raw";
import claudeLogo from "@lobehub/icons-static-svg/icons/claude-color.svg?raw";
import cohereLogo from "@lobehub/icons-static-svg/icons/cohere-color.svg?raw";
import deepSeekLogo from "@lobehub/icons-static-svg/icons/deepseek-color.svg?raw";
import geminiLogo from "@lobehub/icons-static-svg/icons/gemini-color.svg?raw";
import grokLogo from "@lobehub/icons-static-svg/icons/grok.svg?raw";
import groqLogo from "@lobehub/icons-static-svg/icons/groq.svg?raw";
import kimiLogo from "@lobehub/icons-static-svg/icons/kimi-color.svg?raw";
import metaLogo from "@lobehub/icons-static-svg/icons/meta-color.svg?raw";
import minimaxLogo from "@lobehub/icons-static-svg/icons/minimax-color.svg?raw";
import mistralLogo from "@lobehub/icons-static-svg/icons/mistral-color.svg?raw";
import openAiLogo from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import perplexityLogo from "@lobehub/icons-static-svg/icons/perplexity-color.svg?raw";
import qwenLogo from "@lobehub/icons-static-svg/icons/qwen-color.svg?raw";
import { SparklesIcon } from "lucide-react";
import { PROVIDER_PRESETS, type ProviderType } from "../../config";
import { staticT } from "../../i18n";

export const MODEL_PROVIDERS = Object.keys(PROVIDER_PRESETS) as ProviderType[];
export const CURRENT_MODEL_VALUE = "current";

interface ModelBrand {
  name: string;
  svg?: string;
  className?: string;
}

function modelBrand(model: string): ModelBrand {
  const lower = model.trim().toLowerCase();
  if (
    lower.includes("anthropic") ||
    lower.includes("claude") ||
    lower.includes("sonnet") ||
    lower.includes("haiku") ||
    lower.includes("opus")
  ) {
    return {
      name: lower.includes("anthropic") ? "Anthropic" : "Claude",
      svg: lower.includes("anthropic") ? anthropicLogo : claudeLogo,
      className: "text-info",
    };
  }
  if (lower.includes("gemini") || lower.includes("google")) {
    return {
      name: "Google Gemini",
      svg: geminiLogo,
      className: "text-brand",
    };
  }
  if (
    lower.includes("openai") ||
    lower.includes("gpt") ||
    lower.includes("chatgpt") ||
    /\bo[134]\b/.test(lower)
  ) {
    return {
      name: "OpenAI",
      svg: openAiLogo,
      className: "text-foreground",
    };
  }
  if (lower.includes("deepseek")) {
    return {
      name: "DeepSeek",
      svg: deepSeekLogo,
      className: "text-brand",
    };
  }
  if (lower.includes("qwen") || lower.includes("dashscope")) {
    return {
      name: "Qwen",
      svg: qwenLogo,
      className: "text-brand",
    };
  }
  if (lower.includes("llama") || lower.includes("meta")) {
    return {
      name: "Meta Llama",
      svg: metaLogo,
      className: "text-ui-secondary",
    };
  }
  if (lower.includes("mistral") || lower.includes("mixtral")) {
    return {
      name: "Mistral",
      svg: mistralLogo,
      className: "text-info",
    };
  }
  if (
    lower.includes("grok") ||
    lower.includes("xai") ||
    lower.includes("x-ai")
  ) {
    return {
      name: "xAI",
      svg: grokLogo,
      className: "text-foreground",
    };
  }
  if (lower.includes("groq")) {
    return {
      name: "Groq",
      svg: groqLogo,
      className: "text-destructive",
    };
  }
  if (lower.includes("perplexity") || lower.includes("pplx")) {
    return {
      name: "Perplexity",
      svg: perplexityLogo,
      className: "text-info",
    };
  }
  if (lower.includes("cohere") || lower.includes("command-r")) {
    return {
      name: "Cohere",
      svg: cohereLogo,
      className: "text-success",
    };
  }
  if (lower.includes("kimi") || lower.includes("moonshot")) {
    return {
      name: "Kimi",
      svg: kimiLogo,
      className: "text-foreground",
    };
  }
  if (
    lower.includes("glm") ||
    lower.includes("zhipu") ||
    lower.includes("chatglm")
  ) {
    return {
      name: "Zhipu GLM",
      svg: chatglmLogo,
      className: "text-info",
    };
  }
  if (lower.includes("minimax") || lower.includes("abab")) {
    return {
      name: "MiniMax",
      svg: minimaxLogo,
      className: "text-destructive",
    };
  }
  return {
    name: modelShortName(model),
    className: "text-ui-muted",
  };
}

export function ModelLogo({
  model,
  compact = false,
}: {
  model: string;
  compact?: boolean;
}) {
  const brand = modelBrand(model);
  const sizeClass = compact ? "size-3 [&_svg]:size-3" : "size-4 [&_svg]:size-4";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${sizeClass} ${brand.className}`}
      title={brand.name}
      role="img"
      aria-label={brand.name}
    >
      {brand.svg ? (
        <span
          className="contents"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: vetted local SVG asset string
          dangerouslySetInnerHTML={{ __html: brand.svg }}
        />
      ) : (
        <SparklesIcon className="size-3.5" />
      )}
    </span>
  );
}

export function modelShortName(model: string): string {
  const raw = model.trim();
  const lower = raw.toLowerCase();
  const claudeVersion = (family: string) => {
    const match = lower.match(
      new RegExp(`${family}[-_ ]?(\\d)(?:[-_.]?(\\d))?`),
    );
    if (!match) return "";
    return `${match[1]}${match[2] ? `.${match[2]}` : ""}`;
  };
  if (lower.includes("sonnet")) {
    const version = claudeVersion("sonnet");
    return version ? `Sonnet ${version}` : "Sonnet";
  }
  if (lower.includes("haiku")) {
    const version = claudeVersion("haiku");
    return version ? `Haiku ${version}` : "Haiku";
  }
  if (lower.includes("opus")) {
    const version = claudeVersion("opus");
    return version ? `Opus ${version}` : "Opus";
  }
  if (lower.includes("gpt-5.5")) return "GPT-5.5";
  if (lower.includes("gpt-5.4-mini")) return "GPT-5.4 mini";
  if (lower.includes("gpt-5.4-nano")) return "GPT-5.4 nano";
  if (lower.includes("gpt-5.4")) return "GPT-5.4";
  if (lower.includes("gpt-5.3-codex-spark")) return "GPT-5.3 Spark";
  if (lower.includes("gpt-4o-mini")) return "GPT-4o mini";
  if (lower.includes("gpt-4o")) return "GPT-4o";
  if (lower.includes("gemini")) {
    return raw
      .replace(/^gemini[-_ ]?/i, "Gemini ")
      .replace(/[-_ ]flash$/i, " Flash")
      .replace(/[-_]/g, " ");
  }
  return raw || staticT("chat.defaultModel");
}

export function modelSelectValue(
  providerType: ProviderType,
  model: string,
): string {
  return `${providerType}::${model}`;
}

export function parseModelSelectValue(
  value: string,
): { providerType: ProviderType; model: string } | null {
  const splitAt = value.indexOf("::");
  if (splitAt < 0) return null;
  const providerType = value.slice(0, splitAt) as ProviderType;
  if (!(providerType in PROVIDER_PRESETS)) return null;
  return { providerType, model: value.slice(splitAt + 2) };
}
