export const DICTATION_PROGRESS_KEY = "dictation-review:progress:v1";

export type DictationPromptMode = "audio" | "meaning";
type DictationAttemptResult = "correct" | "incorrect";

export interface DictationAttemptStats {
  correctCount: number;
  incorrectCount: number;
  lastResult: DictationAttemptResult;
  updatedAt: number;
}

export interface DictationProgress {
  version: 1;
  attempts: Record<
    string,
    Partial<Record<DictationPromptMode, DictationAttemptStats>>
  >;
  cursors: Record<string, Partial<Record<DictationPromptMode, string>>>;
}

export function createEmptyDictationProgress(): DictationProgress {
  return { version: 1, attempts: {}, cursors: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseDictationProgress(raw: string | null): DictationProgress {
  if (!raw) return createEmptyDictationProgress();
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1) {
      return createEmptyDictationProgress();
    }
    return {
      version: 1,
      attempts: isRecord(value.attempts)
        ? (value.attempts as DictationProgress["attempts"])
        : {},
      cursors: isRecord(value.cursors)
        ? (value.cursors as DictationProgress["cursors"])
        : {},
    };
  } catch {
    return createEmptyDictationProgress();
  }
}

export function selectionKey(conversationIds: string[]): string {
  return JSON.stringify([...new Set(conversationIds)].sort());
}

export function getDictationCursor(
  progress: DictationProgress,
  key: string,
  mode: DictationPromptMode,
): string | null {
  return progress.cursors[key]?.[mode] ?? null;
}

export function setDictationCursor(
  progress: DictationProgress,
  key: string,
  mode: DictationPromptMode,
  itemId: string | null,
): DictationProgress {
  const current = progress.cursors[key]?.[mode] ?? null;
  if (current === itemId) return progress;

  const modes = { ...progress.cursors[key] };
  if (itemId) modes[mode] = itemId;
  else delete modes[mode];

  const cursors = { ...progress.cursors };
  if (Object.keys(modes).length > 0) cursors[key] = modes;
  else delete cursors[key];
  return { ...progress, cursors };
}

export function recordDictationAttempt(
  progress: DictationProgress,
  itemId: string,
  mode: DictationPromptMode,
  correct: boolean,
  updatedAt = Date.now(),
): DictationProgress {
  const previous = progress.attempts[itemId]?.[mode];
  const stats: DictationAttemptStats = {
    correctCount: (previous?.correctCount ?? 0) + (correct ? 1 : 0),
    incorrectCount: (previous?.incorrectCount ?? 0) + (correct ? 0 : 1),
    lastResult: correct ? "correct" : "incorrect",
    updatedAt,
  };
  return {
    ...progress,
    attempts: {
      ...progress.attempts,
      [itemId]: {
        ...progress.attempts[itemId],
        [mode]: stats,
      },
    },
  };
}

export function isDictationMastered(
  progress: DictationProgress,
  itemId: string,
  mode: DictationPromptMode,
): boolean {
  return (progress.attempts[itemId]?.[mode]?.correctCount ?? 0) > 0;
}

export function findNextUnmasteredItem<T extends { id: string }>(
  items: T[],
  currentId: string | null,
  progress: DictationProgress,
  mode: DictationPromptMode,
  delta: -1 | 1,
): T | null {
  if (items.length === 0) return null;
  const currentIndex = items.findIndex((item) => item.id === currentId);
  const start = currentIndex >= 0 ? currentIndex : delta > 0 ? -1 : 0;
  for (let step = 1; step <= items.length; step++) {
    const index = (start + delta * step + items.length) % items.length;
    const item = items[index];
    if (!isDictationMastered(progress, item.id, mode)) return item;
  }
  return null;
}
