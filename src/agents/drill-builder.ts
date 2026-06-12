// In-app drill builder: turns a natural-language request into a drill@1 Markdown document. Uses the
// SAME authoring spec the "copy for external AI" button exports (single source of truth), validates
// with the same parser the importer runs, and feeds validation errors back for one self-correction
// round — so in-app generation and a ChatGPT round-trip produce exactly the same kind of artifact.

import { buildDrillAuthoringSpec } from "../drills/authoring-spec";
import { type DrillParseResult, parseDrillDocument } from "../drills/format";
import type { ChatMessage, ModelProvider } from "../providers/types";

export interface GeneratedDrillDocument {
  sourceMd: string;
  result: DrillParseResult;
}

// Pull the markdown document out of the reply: prefer the first fenced markdown block (the spec
// requires one); fall back to the raw text if the model skipped the fence but started with ---.
export function extractDrillDocument(reply: string): string {
  const fence = reply.match(/```+\s*(?:markdown|md)?\s*\n([\s\S]*?)\n```+/);
  if (fence) return fence[1].trim();
  const bare = reply.trim();
  if (bare.startsWith("---")) return bare;
  return bare;
}

export async function generateDrillDocument(
  provider: ModelProvider,
  description: string,
  ctx: { nativeLanguage: string; targetLanguage: string; level: string },
): Promise<GeneratedDrillDocument> {
  const system = `${buildDrillAuthoringSpec()}

## Learner context (use for locales and calibration notes)
Native language: ${ctx.nativeLanguage}
Target language: ${ctx.targetLanguage}
Level: ${ctx.level}
Add a \`locales\` entry for the learner's native language UI when it is not English.`;

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    {
      role: "user",
      content: `Create a training mode from this request:\n${description}`,
    },
  ];
  const raw = await provider.generate({
    messages,
    temperature: 0.4,
    maxTokens: 4096,
    meta: { label: "drill_builder" },
  });
  let sourceMd = extractDrillDocument(raw);
  let result = parseDrillDocument(sourceMd);
  if (!result.ok) {
    // One self-correction round: hand the validator output back, same as a user pasting errors into ChatGPT.
    const retry = await provider.generate({
      messages: [
        ...messages,
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `The app rejected that document with these validation errors:\n${result.errors
            .map((e) => `- ${e}`)
            .join(
              "\n",
            )}\nReturn the corrected COMPLETE document in one fenced markdown block.`,
        },
      ],
      temperature: 0.2,
      maxTokens: 4096,
      meta: { label: "drill_builder_fix" },
    });
    sourceMd = extractDrillDocument(retry);
    result = parseDrillDocument(sourceMd);
  }
  return { sourceMd, result };
}
