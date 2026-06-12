import { BotIcon, MicIcon, Volume2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { type MessageKey, useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import { activeProvider, providerModelLabel, useConfig } from "../config";
import {
  loadSttConfig,
  STT_CONFIG_CHANGED_EVENT,
  type SttProvider,
} from "../stt/config";
import {
  EDGE_VOICES,
  loadTtsConfig,
  MIMO_VOICES,
  TTS_CONFIG_CHANGED_EVENT,
} from "../tts/config";

// Quiet status line on the new-chat start page: which LLM / TTS / STT providers a turn
// would use right now, read from the same stores as settings. ChatView stays mounted
// (hidden) while settings is open, so the TTS/STT values are re-read on the
// config-changed events instead of only at mount; the LLM part is already reactive
// via useConfig.

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

export function ProviderStatus() {
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

  const items = [
    {
      icon: BotIcon,
      label: t("newChat.providerLlm"),
      value: providerModelLabel(
        config.providerType,
        activeProvider(config).model,
      ),
      unset: false,
    },
    {
      icon: Volume2Icon,
      label: t("newChat.providerTts"),
      value: ttsValue,
      unset: false,
    },
    {
      icon: MicIcon,
      label: t("newChat.providerStt"),
      value: sttValue,
      unset: stt.sttProvider === null,
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t pt-3 text-ui-caption text-ui-muted">
      {items.map(({ icon: Icon, label, value, unset }) => (
        <span
          key={label}
          className="flex min-w-0 items-center gap-1.5"
          title={value}
        >
          <Icon className="size-3.5 shrink-0" />
          <span className="shrink-0">{label}</span>
          <span
            className={cn("truncate", !unset && "font-medium text-foreground")}
          >
            {value}
          </span>
        </span>
      ))}
    </div>
  );
}
