import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  type ClassifiedPreference,
  PREFERENCE_SCOPE_LABEL,
  type ProfilePreferences,
} from "../profile/preferences";
import type { ChatMessage, ModelProvider } from "../providers/types";
import {
  formatZodError,
  normalizeTutorPayload,
  parseLLMJson,
} from "./parse-llm-json";

const PreferenceItem = z.object({
  scope: z.enum(["global", "conversation", "tutor", "learning", "reading"]),
  instruction: z.string().min(1),
});

const PreferenceClassification = z.object({
  items: z.array(PreferenceItem).min(1),
});

function classificationJsonSchema() {
  const schema = zodToJsonSchema(PreferenceClassification, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete schema.$schema;
  return { name: "ProfilePreferenceClassification", schema };
}

function formatCurrentPreferences(prefs: ProfilePreferences): string {
  return (
    Object.keys(PREFERENCE_SCOPE_LABEL) as Array<keyof ProfilePreferences>
  )
    .map((scope) => {
      const body = prefs[scope].trim() || "(empty)";
      return `## ${PREFERENCE_SCOPE_LABEL[scope]}\n${body}`;
    })
    .join("\n\n");
}

function systemPrompt(): string {
  return `You classify a learner's free-form customization request into durable profile preferences for a language-learning app.

The app has these preference scopes:
- global: applies everywhere.
- conversation: normal chat replies only.
- tutor: correction feedback and learning-memory bookkeeping.
- learning: focused lessons / customized learning agents.
- reading: explanation, selected-text translation, and bilingual reading helpers.

Rules:
- Split the user's request into one or more concise durable instructions.
- Put each instruction in the narrowest scope that should obey it.
- Use global only when the request should affect most or all app modules.
- Preserve concrete wording, examples, language varieties, strictness, tone, and "ignore X" preferences.
- Do not invent preferences the user did not ask for.
- Return JSON only.`;
}

function userPrompt(instruction: string, prefs: ProfilePreferences): string {
  return `=== CURRENT PROFILE PREFERENCES ===
${formatCurrentPreferences(prefs)}

=== NEW USER CUSTOMIZATION REQUEST ===
${instruction}

Classify this request now.`;
}

function parseClassification(raw: string): ClassifiedPreference[] {
  const parsed = parseLLMJson(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const normalized = normalizeTutorPayload(parsed.value);
  const validated = PreferenceClassification.safeParse(normalized);
  if (!validated.success) {
    throw new Error(
      `偏好归类 JSON 校验失败:${formatZodError(validated.error)}`,
    );
  }
  return validated.data.items;
}

export async function classifyProfilePreferenceInstruction(
  provider: ModelProvider,
  instruction: string,
  prefs: ProfilePreferences,
): Promise<ClassifiedPreference[]> {
  const schema = classificationJsonSchema();
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
    { role: "user", content: userPrompt(instruction, prefs) },
  ];

  try {
    return parseClassification(
      await provider.generate({
        messages,
        temperature: 0,
        maxTokens: 1200,
        jsonSchema: schema,
        meta: { label: "profile_preferences" },
      }),
    );
  } catch (e) {
    console.warn("偏好归类 json_schema 失败,尝试 json_object:", e);
  }

  return parseClassification(
    await provider.generate({
      messages: [
        {
          role: "system",
          content: `${systemPrompt()}\n\nReturn exactly one JSON object matching this schema:\n${JSON.stringify(
            schema.schema,
          )}`,
        },
        { role: "user", content: userPrompt(instruction, prefs) },
      ],
      temperature: 0,
      maxTokens: 1200,
      jsonObject: true,
      meta: { label: "profile_preferences" },
    }),
  );
}
