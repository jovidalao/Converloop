import { SparklesIcon } from "lucide-react";
import type { TFunction } from "@/i18n";
import { useTranslation } from "@/i18n";
import {
  PREFERENCE_SCOPE_LABEL,
  type PreferenceScope,
  type ProfilePreferences,
} from "../profile/preferences";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

const PREFERENCE_SCOPES: PreferenceScope[] = [
  "global",
  "conversation",
  "tutor",
  "learning",
  "reading",
];

// Free-form "tell the AI how to behave" panel: a single natural-language box that
// an AI classifier routes into per-module scopes, plus manual fine-tuning per
// module. Presentational only — state/persistence live in the host (ProfileView
// or the Settings → Customization section).
export function PreferencesPanel({
  preferences,
  smartDraft,
  smartBusy,
  variant = "card",
  onSmartDraftChange,
  onSmartApply,
  onScopeChange,
  onScopeBlur,
}: {
  preferences: ProfilePreferences;
  smartDraft: string;
  smartBusy: boolean;
  variant?: "card" | "plain";
  onSmartDraftChange: (value: string) => void;
  onSmartApply: () => void;
  onScopeChange: (scope: PreferenceScope, value: string) => void;
  onScopeBlur: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      className={
        variant === "card"
          ? "rounded-md border border-border/70 bg-card/80 p-4 shadow-minimal-flat"
          : undefined
      }
    >
      <div className="mb-4 flex flex-col gap-2">
        <div>
          <h3 className="m-0 text-ui-body font-semibold">
            {t("profile.aiCustomTitle")}
          </h3>
          <p className="m-0 mt-1 text-ui-body leading-snug text-ui-muted">
            {t("profile.aiCustomDesc")}
          </p>
        </div>
        <span className="w-fit rounded bg-primary/10 px-1.5 py-0.5 text-ui-caption text-primary">
          {t("profile.aiPreferenceBadge")}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <Textarea
          aria-label={t("profile.aiCustomAriaLabel")}
          className="min-h-28 resize-y bg-background/60 text-ui-body leading-normal"
          value={smartDraft}
          onChange={(e) => onSmartDraftChange(e.target.value)}
          placeholder={t("profile.smartDraftPlaceholder")}
        />
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={onSmartApply}
            disabled={smartBusy || !smartDraft.trim()}
            className="w-full"
          >
            <SparklesIcon size={15} />
            {smartBusy
              ? t("profile.aiClassifying")
              : t("profile.aiClassifySave")}
          </Button>
        </div>
      </div>

      <details className="mt-4">
        <summary className="text-ui-body font-medium text-ui-muted">
          {t("profile.finetuneByModule")}
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-3">
          {PREFERENCE_SCOPES.map((scope) => (
            <div key={scope} className="flex flex-col gap-1.5">
              <span className="text-ui-body text-ui-muted">
                {PREFERENCE_SCOPE_LABEL[scope]}
              </span>
              <Textarea
                aria-label={PREFERENCE_SCOPE_LABEL[scope]}
                className="min-h-24 resize-y bg-background/60 text-ui-body leading-normal"
                value={preferences[scope]}
                onChange={(e) => onScopeChange(scope, e.target.value)}
                onBlur={onScopeBlur}
                placeholder={t(
                  `profile.pref${scope.charAt(0).toUpperCase()}${scope.slice(1)}Placeholder` as Parameters<TFunction>[0],
                )}
              />
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
