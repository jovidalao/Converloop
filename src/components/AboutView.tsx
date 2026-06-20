import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon, InfoIcon } from "lucide-react";
import { version } from "../../package.json";
import { useTranslation } from "../i18n";
import { WEBSITE_DESIGN_URL, WEBSITE_URL } from "../lib/links";

export function AboutView() {
  const { t } = useTranslation();

  const principles = [
    {
      title: t("about.principles.local.title"),
      body: t("about.principles.local.body"),
    },
    {
      title: t("about.principles.conversation.title"),
      body: t("about.principles.conversation.body"),
    },
    {
      title: t("about.principles.accounting.title"),
      body: t("about.principles.accounting.body"),
    },
    {
      title: t("about.principles.editable.title"),
      body: t("about.principles.editable.body"),
    },
  ];

  const features = [
    t("about.features.conversation"),
    t("about.features.correction"),
    t("about.features.lessons"),
    t("about.features.listening"),
    t("about.features.customize"),
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-8 pt-16 pb-20">
        <div className="flex items-start gap-4">
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <InfoIcon className="size-6" />
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5">
              <h2 className="m-0 text-ui-title font-semibold">Converloop</h2>
              <span className="font-mono text-ui-caption text-ui-muted">
                v{version}
              </span>
            </div>
            <p className="mt-2 mb-0 text-ui-body leading-relaxed text-ui-muted">
              {t("about.tagline")}
            </p>
          </div>
        </div>

        <section className="mt-14">
          <h3 className="m-0 text-ui-caption font-medium text-ui-muted">
            {t("about.principlesTitle")}
          </h3>
          <div className="mt-5 flex flex-col gap-7">
            {principles.map((p) => (
              <div key={p.title}>
                <h4 className="m-0 text-ui-body font-semibold">{p.title}</h4>
                <p className="mt-1.5 mb-0 max-w-xl text-ui-body leading-relaxed text-ui-muted">
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 border-t pt-10">
          <h3 className="m-0 text-ui-caption font-medium text-ui-muted">
            {t("about.featuresTitle")}
          </h3>
          <ul className="m-0 mt-5 flex list-none flex-col gap-3 p-0">
            {features.map((f) => (
              <li
                key={f}
                className="flex items-start gap-3 text-ui-body leading-relaxed"
              >
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t pt-8">
          <p className="m-0 text-ui-caption text-ui-muted">{t("about.meta")}</p>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => void openUrl(WEBSITE_URL)}
              className="inline-flex items-center gap-1 text-ui-caption text-ui-muted transition-colors hover:text-foreground"
            >
              {t("about.websiteLink")}
              <ExternalLinkIcon className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => void openUrl(WEBSITE_DESIGN_URL)}
              className="inline-flex items-center gap-1 text-ui-caption text-primary hover:underline"
            >
              {t("about.designLink")}
              <ExternalLinkIcon className="size-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
