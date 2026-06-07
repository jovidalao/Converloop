import { describe, expect, it } from "vitest";
import {
  findProviderModelOption,
  inferContextLimit,
  isOAuthProvider,
  PROVIDER_PRESETS,
  PROVIDER_TYPES,
  type ProviderType,
  providerModelLabel,
} from "./config";

// Providers whose preset speaks the OpenAI chat/completions wire format (routed through createOpenAIProvider
// by buildProviderFor's fall-through). Kept in sync by the "stay OpenAI-compatible" assertion below.
const OPENAI_WIRE: ProviderType[] = [
  "openai",
  "deepseek",
  "openrouter",
  "xai",
  "mistral",
  "qwen",
  "moonshot",
  "glm",
  "minimax",
];

// The non-OpenAI wire formats (native adapters / subscription login).
const NON_OPENAI_WIRE: ProviderType[] = [
  "gemini",
  "anthropic",
  "claude-oauth",
  "codex-oauth",
];

describe("provider registration completeness", () => {
  it("every provider type has a preset, and the two sets partition all types", () => {
    for (const type of PROVIDER_TYPES) {
      expect(PROVIDER_PRESETS[type], `preset for ${type}`).toBeDefined();
    }
    expect([...OPENAI_WIRE, ...NON_OPENAI_WIRE].sort()).toEqual(
      [...PROVIDER_TYPES].sort(),
    );
  });

  it("includes the extra OpenAI-compatible providers", () => {
    expect(PROVIDER_TYPES).toEqual(
      expect.arrayContaining([
        "deepseek",
        "openrouter",
        "xai",
        "mistral",
        "qwen",
        "moonshot",
        "glm",
        "minimax",
      ]),
    );
  });

  it.each([...PROVIDER_TYPES])("preset %s is internally consistent", (type) => {
    const preset = PROVIDER_PRESETS[type];
    expect(preset.label.trim()).not.toBe("");
    expect(preset.shortLabel.trim()).not.toBe("");
    expect(preset.models.length).toBeGreaterThan(0);

    // No duplicate model ids, and every entry has a non-empty label/model.
    const ids = preset.models.map((m) => m.model);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of preset.models) {
      expect(m.model.trim()).not.toBe("");
      expect(m.label.trim()).not.toBe("");
    }

    // The default model must be one of the listed models (drives the settings dropdown's initial value).
    expect(ids).toContain(preset.model);
    expect(findProviderModelOption(type, preset.model)?.model).toBe(
      preset.model,
    );

    // A sane context window can always be inferred (or is overridable later).
    expect(inferContextLimit(preset.model)).toBeGreaterThan(0);

    // Label shown in the chat model switcher carries the provider's short label.
    expect(providerModelLabel(type, preset.model)).toContain(preset.shortLabel);
  });

  it.each(
    OPENAI_WIRE,
  )("OpenAI-wire preset %s builds a valid /chat/completions endpoint", (type) => {
    expect(isOAuthProvider(type)).toBe(false);
    const base = PROVIDER_PRESETS[type].baseUrl;
    const url = new URL(base);
    expect(url.protocol).toMatch(/^https?:$/);
    // Mirror openai.ts endpoint(): trim trailing slashes then append the path.
    const endpoint = `${base.replace(/\/+$/, "")}/chat/completions`;
    expect(() => new URL(endpoint)).not.toThrow();
    expect(endpoint).toMatch(/\/chat\/completions$/);
    expect(endpoint).not.toMatch(/\/\/chat\/completions$/);
  });

  it("flags exactly the subscription-login providers as OAuth", () => {
    const oauth = PROVIDER_TYPES.filter(isOAuthProvider);
    expect(oauth.sort()).toEqual(["claude-oauth", "codex-oauth"]);
  });
});
