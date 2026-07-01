import { generateAutoTitle } from "../agents/auto-title";
import { bilingual } from "../agents/bilingual";
import { explain } from "../agents/explain";
import { explainPoint } from "../agents/explain-point";
import { translate } from "../agents/translate";
import { getProvider, loadConfig } from "../config";
import {
  DEFAULT_CONVERSATION_TITLE,
  getConversation,
  getConversationModelOverride,
  renameConversation,
} from "../db/conversations";
import { formatTurns, getTurnsAfterId } from "../db/turns";
import { formatExperiencePreferences } from "../profile/preferences";
import { profileSliceForConversation, readProfile } from "../profile/profile";
import { getBuiltinAgentOverride, HOOKS, runTransformer } from "../runtime";
import { MissingApiKeyError, tailTurnsByChars } from "./shared";

// Explanation needs the immediate thread (what references resolve to), not the whole chat.
const EXPLAIN_CONTEXT_CHARS = 6000;

// On-demand explanation for a conversation reply: reads the Markdown profile (same source as the conversation agent), streams a native-language explanation.
// Not on the hot path; not persisted — explanations are cheap and can be regenerated on demand.
export async function explainReply(
  conversationId: string,
  turnId: string,
  reply: string,
  onDelta: (delta: string) => void,
): Promise<string> {
  const conversation = await getConversation(conversationId);
  const provider = await getProvider(
    getConversationModelOverride(conversation),
  );
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const [profileMd, turns] = await Promise.all([
    readProfile(config),
    getTurnsAfterId(conversationId, null),
  ]);
  const experiencePreferences = formatExperiencePreferences(
    profileMd,
    "reading",
  );
  const profileSlice = profileSliceForConversation(profileMd);
  // Context leading up to the explained reply: earlier turns plus the learner
  // message it answers, so cross-turn references ("that place you mentioned",
  // elliptical answers) resolve. A missing turn degrades to no history.
  const idx = turns.findIndex((t) => t.id === turnId);
  let history = "";
  if (idx >= 0) {
    const before = formatTurns(
      tailTurnsByChars(turns.slice(0, idx), EXPLAIN_CONTEXT_CHARS),
    );
    const userLine = turns[idx].userInput.trim();
    history = [before, userLine ? `User: ${userLine}` : ""]
      .filter(Boolean)
      .join("\n\n");
  }

  return runTransformer(
    "builtin:transformer:explain",
    HOOKS.turnExplain,
    () =>
      explain(
        provider,
        {
          nativeLanguage: config.nativeLanguage,
          targetLanguage: config.targetLanguage,
          level: config.level,
          experiencePreferences,
          profileSlice,
          history,
          reply,
          customInstructions: getBuiltinAgentOverride(
            "builtin:transformer:explain",
          )?.instructions,
        },
        onDelta,
      ),
    (text) => ({ chars: text.length }),
  );
}

// On-demand mini-lesson for ONE mastery point shown in the coach panel (recurring
// error, latest fix, or a review target). Teaches the rule + fresh examples so the
// learner can generalize; transient, not persisted, regenerated on demand.
export interface MasteryPointExplainArgs {
  conversationId: string | null;
  label: string;
  type: string;
  evidence?: string;
}

export async function explainMasteryPoint(
  args: MasteryPointExplainArgs,
  onDelta: (delta: string) => void,
): Promise<string> {
  const conversation = args.conversationId
    ? await getConversation(args.conversationId)
    : null;
  const provider = await getProvider(
    getConversationModelOverride(conversation),
  );
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const profileMd = await readProfile(config);
  return explainPoint(
    provider,
    {
      nativeLanguage: config.nativeLanguage,
      targetLanguage: config.targetLanguage,
      level: config.level,
      experiencePreferences: formatExperiencePreferences(profileMd, "reading"),
      profileSlice: profileSliceForConversation(profileMd),
      type: args.type,
      label: args.label,
      evidence: args.evidence,
    },
    onDelta,
  );
}

// Bilingual reading: convert a conversation reply into a target-language/native-language sentence-by-sentence interleave (bilingual Markdown).
// Does not read the profile; not persisted — cheap, regenerated on demand.
export async function bilingualReply(
  reply: string,
  conversationId?: string,
): Promise<string> {
  const conversation = conversationId
    ? await getConversation(conversationId)
    : null;
  const provider = await getProvider(
    getConversationModelOverride(conversation),
  );
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const experiencePreferences = formatExperiencePreferences(
    await readProfile(config),
    "reading",
  );
  return runTransformer(
    "builtin:transformer:bilingual",
    HOOKS.turnBilingual,
    () =>
      bilingual(provider, {
        nativeLanguage: config.nativeLanguage,
        targetLanguage: config.targetLanguage,
        experiencePreferences,
        reply,
        customInstructions: getBuiltinAgentOverride(
          "builtin:transformer:bilingual",
        )?.instructions,
      }),
    (text) => ({ chars: text.length }),
  );
}

// Selection translation/analysis: stream a native-language explanation for a text selection in the conversation, using its surrounding context.
// Does not read the profile; not persisted — cheap, regenerated on demand.
export async function translateSelection(
  selection: string,
  context: string,
  onDelta: (delta: string) => void,
): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const experiencePreferences = formatExperiencePreferences(
    await readProfile(config),
    "reading",
  );
  return runTransformer(
    "builtin:transformer:translate",
    HOOKS.turnTranslate,
    () =>
      translate(
        provider,
        {
          nativeLanguage: config.nativeLanguage,
          targetLanguage: config.targetLanguage,
          experiencePreferences,
          selection,
          context,
          customInstructions: getBuiltinAgentOverride(
            "builtin:transformer:translate",
          )?.instructions,
        },
        onDelta,
      ),
    (text) => ({ chars: text.length }),
  );
}

// LLM-generated conversation title: called after the first message is persisted.
// Silently skips when no provider is configured or the title was already changed by the user.
export async function generateAndSetConversationTitle(
  conversationId: string,
  firstUserInput: string,
): Promise<void> {
  const conv = await getConversation(conversationId);
  if (!conv || conv.title !== DEFAULT_CONVERSATION_TITLE) return;
  const provider = await getProvider(getConversationModelOverride(conv));
  if (!provider) return;

  const config = loadConfig();
  try {
    const title = await generateAutoTitle(provider, {
      targetLanguage: config.targetLanguage,
      nativeLanguage: config.nativeLanguage,
      firstMessage: firstUserInput,
    });
    if (title) await renameConversation(conversationId, title);
  } catch {
    // Silently fall back — the existing truncated title remains.
  }
}
