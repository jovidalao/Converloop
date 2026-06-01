import {
  ensureSections,
  type ParsedProfile,
  type ProfileSection,
  parseProfile,
  serializeProfile,
} from "./parse";

export const PREFERENCES_SECTION_TITLE = "AI preferences";

export type PreferenceScope =
  | "global"
  | "conversation"
  | "tutor"
  | "learning"
  | "reading";

export type AgentPreferenceScope = Exclude<PreferenceScope, "global">;

export interface ProfilePreferences {
  global: string;
  conversation: string;
  tutor: string;
  learning: string;
  reading: string;
}

export const PREFERENCE_SCOPE_LABEL: Record<PreferenceScope, string> = {
  global: "全局",
  conversation: "对话",
  tutor: "批改",
  learning: "专项课",
  reading: "讲解 / 翻译 / 双语阅读",
};

export const PREFERENCE_SCOPE_HEADING: Record<PreferenceScope, string> = {
  global: "Global",
  conversation: "Conversation",
  tutor: "Correction",
  learning: "Lessons",
  reading: "Reading help",
};

export const EMPTY_PROFILE_PREFERENCES: ProfilePreferences = {
  global: "",
  conversation: "",
  tutor: "",
  learning: "",
  reading: "",
};

const HEADING_TO_SCOPE = new Map(
  Object.entries(PREFERENCE_SCOPE_HEADING).map(([scope, heading]) => [
    heading.toLowerCase(),
    scope as PreferenceScope,
  ]),
);

function cleanInstruction(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function bulletize(text: string): string {
  const clean = text.trim();
  if (!clean) return "";
  return clean
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith("-") ? line : `- ${line}`))
    .join("\n");
}

export function parseProfilePreferences(body: string): ProfilePreferences {
  const prefs = { ...EMPTY_PROFILE_PREFERENCES };
  let current: PreferenceScope | null = null;
  const buffers: Record<PreferenceScope, string[]> = {
    global: [],
    conversation: [],
    tutor: [],
    learning: [],
    reading: [],
  };

  for (const line of body.split("\n")) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      current = HEADING_TO_SCOPE.get(heading[1].toLowerCase()) ?? null;
      continue;
    }
    if (current) buffers[current].push(line);
  }

  for (const scope of Object.keys(buffers) as PreferenceScope[]) {
    prefs[scope] = buffers[scope].join("\n").trim();
  }
  return prefs;
}

export function serializeProfilePreferences(prefs: ProfilePreferences): string {
  return (Object.keys(PREFERENCE_SCOPE_HEADING) as PreferenceScope[])
    .map((scope) => {
      const body = bulletize(prefs[scope]);
      return `### ${PREFERENCE_SCOPE_HEADING[scope]}\n${body}`;
    })
    .join("\n\n")
    .trim();
}

export function preferenceSectionBodyFromProfile(md: string): string {
  const profile = ensureSections(parseProfile(md));
  return (
    profile.sections.find((s) => s.title === PREFERENCES_SECTION_TITLE)?.body ??
    ""
  );
}

export function preferencesFromProfile(md: string): ProfilePreferences {
  return parseProfilePreferences(preferenceSectionBodyFromProfile(md));
}

function replaceSection(
  profile: ParsedProfile,
  title: string,
  body: string,
): ParsedProfile {
  const sections = profile.sections.map((section) =>
    section.title === title ? { ...section, body } : section,
  );
  if (sections.some((section) => section.title === title)) {
    return { ...profile, sections };
  }
  return {
    ...profile,
    sections: [...sections, { title, body }],
  };
}

export function writePreferencesToProfile(
  md: string,
  prefs: ProfilePreferences,
): string {
  const profile = ensureSections(parseProfile(md));
  return serializeProfile(
    replaceSection(
      profile,
      PREFERENCES_SECTION_TITLE,
      serializeProfilePreferences(prefs),
    ),
  );
}

export function updateProfilePreference(
  md: string,
  scope: PreferenceScope,
  body: string,
): string {
  const prefs = preferencesFromProfile(md);
  prefs[scope] = body;
  return writePreferencesToProfile(md, prefs);
}

export interface ClassifiedPreference {
  scope: PreferenceScope;
  instruction: string;
}

export function appendClassifiedPreferences(
  md: string,
  items: ClassifiedPreference[],
): string {
  const prefs = preferencesFromProfile(md);
  for (const item of items) {
    const instruction = cleanInstruction(item.instruction);
    if (!instruction) continue;
    const line = `- ${instruction}`;
    prefs[item.scope] = [prefs[item.scope].trim(), line]
      .filter(Boolean)
      .join("\n");
  }
  return writePreferencesToProfile(md, prefs);
}

export function formatExperiencePreferences(
  md: string,
  scope: AgentPreferenceScope,
): string {
  const prefs = preferencesFromProfile(md);
  const lines: string[] = [];
  if (prefs.global.trim()) {
    lines.push(`Global user preferences:\n${bulletize(prefs.global)}`);
  }
  if (prefs[scope].trim()) {
    lines.push(
      `${PREFERENCE_SCOPE_LABEL[scope]} preferences:\n${bulletize(prefs[scope])}`,
    );
  }
  return lines.join("\n\n");
}

export interface CorrectionPreferenceFlags {
  ignoreCapitalizationIssues: boolean;
  ignorePunctuationIssues: boolean;
}

export function correctionPreferenceFlags(
  md: string,
): CorrectionPreferenceFlags {
  const prefs = preferencesFromProfile(md);
  const text = `${prefs.global}\n${prefs.tutor}`.toLowerCase();
  const ignoreWords =
    /(ignore|忽略|不要|不用|不需要|别|無需|無須|don't|do not|not)/;
  const capitalizationWords =
    /(capitali[sz]ation|uppercase|lowercase|letter case|\bcase\b|大小写|大小寫|大写|大寫|小写|小寫)/;
  const punctuationWords =
    /(punctuation|comma|period|full stop|apostrophe|quote|标点|標點|逗号|逗號|句号|句號|撇号|撇號|引号|引號)/;
  const voiceInput = /(voice input|dictation|speech input|语音输入|語音輸入)/;
  return {
    ignoreCapitalizationIssues:
      (ignoreWords.test(text) && capitalizationWords.test(text)) ||
      (voiceInput.test(text) && capitalizationWords.test(text)),
    ignorePunctuationIssues:
      (ignoreWords.test(text) && punctuationWords.test(text)) ||
      (voiceInput.test(text) && punctuationWords.test(text)),
  };
}

export function isPreferenceSection(section: ProfileSection): boolean {
  return section.title === PREFERENCES_SECTION_TITLE;
}
