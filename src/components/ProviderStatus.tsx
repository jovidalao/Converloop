import { BotIcon, MicIcon, TriangleAlertIcon, Volume2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { type MessageKey, useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import { activeProvider, providerModelLabel, useConfig } from "../config";
import {
  loadSttConfig,
  STT_CONFIG_CHANGED_EVENT,
  type SttProvider,
  sttSupportsLanguage,
} from "../stt/config";
import {
  EDGE_VOICES,
  loadTtsConfig,
  MIMO_VOICES,
  TTS_CONFIG_CHANGED_EVENT,
  ttsSupportsLanguage,
} from "../tts/config";

// Clickable provider summary shown at the top of the start pages (new chat, training center, listening): which
// LLM / TTS / STT providers a turn would use right now, read from the same stores as settings; each item opens its
// corresponding settings section. Pass `kinds` to show only the services a page actually uses (e.g. listening is
// TTS-only). ChatView stays mounted (hidden) while settings is open, so the TTS/STT values are re-read on the
// config-changed events instead of only at mount; the LLM part is already reactive via useConfig.

export type ProviderKind = "llm" | "tts" | "stt";

const STT_NAME_KEYS: Record<SttProvider, MessageKey> = {
  soniox: "newChat.sttSoniox",
  openai: "newChat.sttOpenai",
  parakeet: "newChat.sttParakeet",
  qwen3: "newChat.sttQwen3",
};

// Voice labels read "Emma (English · Multilingual Female)"; the status line only has
// room for the given name. Unknown ids (hand-edited config) fall back to the raw id.
function voiceShortLabel(
  voices: { id: string; label: string }[],
  id: string,
): string {
  const label = voices.find((v) => v.id === id)?.label ?? id;
  const paren = label.indexOf(" (");
  return paren === -1 ? label : label.slice(0, paren);
}

export function ProviderStatus({
  onOpen,
  kinds,
}: {
  /** Open the settings section for a provider kind (omit to render a static, non-clickable summary). */
  onOpen?: (kind: ProviderKind) => void;
  /** Restrict the summary to these provider kinds (default: show LLM + TTS + STT). */
  kinds?: ProviderKind[];
}) {
  const { t } = useTranslation();
  const config = useConfig();
  const [tts, setTts] = useState(loadTtsConfig);
  const [stt, setStt] = useState(loadSttConfig);

  useEffect(() => {
    const syncTts = () => setTts(loadTtsConfig());
    const syncStt = () => setStt(loadSttConfig());
    const syncAll = () => {
      syncTts();
      syncStt();
    };
    window.addEventListener(TTS_CONFIG_CHANGED_EVENT, syncTts);
    window.addEventListener(STT_CONFIG_CHANGED_EVENT, syncStt);
    window.addEventListener("storage", syncAll);
    return () => {
      window.removeEventListener(TTS_CONFIG_CHANGED_EVENT, syncTts);
      window.removeEventListener(STT_CONFIG_CHANGED_EVENT, syncStt);
      window.removeEventListener("storage", syncAll);
    };
  }, []);

  const ttsValue =
    tts.ttsProvider === "edge"
      ? `${t("newChat.ttsEdge")} · ${voiceShortLabel(EDGE_VOICES, tts.edgeVoice)}`
      : `${t("newChat.ttsMimo")} · ${voiceShortLabel(MIMO_VOICES, tts.voice)}`;
  const sttValue =
    stt.sttProvider === null
      ? t("newChat.providerNotSet")
      : stt.sttProvider === "soniox"
        ? `${t("newChat.sttSoniox")} · ${stt.sonioxModel}`
        : stt.sttProvider === "openai"
          ? `${t("newChat.sttOpenai")} · ${stt.model}`
          : `${t(STT_NAME_KEYS[stt.sttProvider])} · ${t("newChat.providerLocal")}`;

  // Warn when the chosen voice/recognizer can't handle the language being learned (e.g. MiMo on Japanese,
  // Parakeet on Chinese). The cloud STT engines auto-detect any language, so they never warn.
  const ttsWarn = !ttsSupportsLanguage(tts.ttsProvider, config.targetLanguage)
    ? t("newChat.ttsLangWarning", { language: config.targetLanguage })
    : undefined;
  const sttWarn =
    stt.sttProvider &&
    !sttSupportsLanguage(stt.sttProvider, config.targetLanguage)
      ? t("newChat.sttLangWarning", { language: config.targetLanguage })
      : undefined;

  const items = [
    {
      icon: BotIcon,
      label: t("newChat.providerLlm"),
      value: providerModelLabel(
        config.providerType,
        activeProvider(config).model,
      ),
      unset: false,
      warn: undefined as string | undefined,
      kind: "llm" as const,
    },
    {
      icon: Volume2Icon,
      label: t("newChat.providerTts"),
      value: ttsValue,
      unset: false,
      warn: ttsWarn,
      kind: "tts" as const,
    },
    {
      icon: MicIcon,
      label: t("newChat.providerStt"),
      value: sttValue,
      unset: stt.sttProvider === null,
      warn: sttWarn,
      kind: "stt" as const,
    },
  ];

  const shown = kinds ? items.filter((it) => kinds.includes(it.kind)) : items;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-caption text-ui-muted">
      {shown.map(({ icon: Icon, label, value, unset, warn, kind }) => {
        const body = (
          <>
            <Icon className="size-3.5 shrink-0" />
            <span className="shrink-0">{label}</span>
            <span
              className={cn(
                "truncate",
                !unset && "font-medium text-foreground",
              )}
            >
              {value}
            </span>
            {warn && (
              <TriangleAlertIcon className="size-3.5 shrink-0 text-warning" />
            )}
          </>
        );
        return onOpen ? (
          <button
            key={label}
            type="button"
            onClick={() => onOpen(kind)}
            title={warn ?? value}
            className="-mx-1.5 flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-accent hover:text-foreground"
          >
            {body}
          </button>
        ) : (
          <span
            key={label}
            className="flex min-w-0 items-center gap-1.5"
            title={warn ?? value}
          >
            {body}
          </span>
        );
      })}
    </div>
  );
}
