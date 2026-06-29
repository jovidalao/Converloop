import { openUrl } from "@tauri-apps/plugin-opener";
import { BookOpenTextIcon, GlobeIcon, SparklesIcon } from "lucide-react";
import { version } from "../../package.json";
import { useTranslation } from "../i18n";
import { DESIGN_DOC_URL, GITHUB_URL, WEBSITE_URL } from "../lib/links";

export function AboutView() {
  const { t } = useTranslation();

  const identities = [
    {
      title: t("about.identities.chat.title"),
      body: t("about.identities.chat.body"),
    },
    {
      title: t("about.identities.learning.title"),
      body: t("about.identities.learning.body"),
    },
  ];

  const loopSteps = [
    {
      label: t("about.loop.input.label"),
      body: t("about.loop.input.body"),
    },
    {
      label: t("about.loop.conversation.label"),
      body: t("about.loop.conversation.body"),
    },
    {
      label: t("about.loop.tutor.label"),
      body: t("about.loop.tutor.body"),
    },
    {
      label: t("about.loop.memory.label"),
      body: t("about.loop.memory.body"),
    },
  ];

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

  const featureGroups = [
    {
      title: t("about.features.chat.title"),
      body: t("about.features.chat.body"),
    },
    {
      title: t("about.features.memory.title"),
      body: t("about.features.memory.body"),
    },
    {
      title: t("about.features.practice.title"),
      body: t("about.features.practice.body"),
    },
    {
      title: t("about.features.customize.title"),
      body: t("about.features.customize.body"),
    },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full max-w-3xl px-6 pt-12 pb-12">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <span className="inline-flex size-20 shrink-0 items-center justify-center rounded-2xl bg-primary/10 p-2 shadow-sm ring-1 ring-border">
            <img
              src="/icon.svg"
              alt=""
              className="size-16"
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-ui-caption font-medium text-primary">
              {t("about.eyebrow")}
            </p>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h2 className="m-0 text-ui-title font-semibold">Converloop</h2>
              <span className="inline-flex items-center rounded-md border bg-background px-2 py-0.5 font-mono text-ui-caption text-ui-muted">
                v{version}
              </span>
            </div>
            <p className="mt-2 mb-0 text-ui-title font-semibold leading-snug">
              {t("about.mantra")}
            </p>
            <p className="mt-2 mb-0 max-w-2xl text-ui-body leading-relaxed text-ui-muted">
              {t("about.tagline")}
            </p>
          </div>
        </header>

        <section className="mt-12">
          <h3 className="m-0 text-ui-caption font-medium text-ui-muted">
            {t("about.identityTitle")}
          </h3>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {identities.map((identity) => (
              <article key={identity.title} className="rounded-lg border p-4">
                <h4 className="m-0 text-ui-body font-semibold">
                  {identity.title}
                </h4>
                <p className="mt-2 mb-0 text-ui-caption leading-relaxed text-ui-muted">
                  {identity.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h3 className="m-0 text-ui-caption font-medium text-ui-muted">
            {t("about.loopTitle")}
          </h3>
          <ol className="m-0 mt-5 grid list-none gap-3 p-0 sm:grid-cols-2">
            {loopSteps.map((step, index) => (
              <li key={step.label} className="rounded-lg border p-4">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-ui-caption text-primary">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h4 className="m-0 text-ui-body font-semibold">
                    {step.label}
                  </h4>
                </div>
                <p className="mt-2 mb-0 text-ui-caption leading-relaxed text-ui-muted">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

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
          <div className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {featureGroups.map((feature) => (
              <div key={feature.title} className="flex items-start gap-3">
                <span className="mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <SparklesIcon className="size-3.5" />
                </span>
                <div className="min-w-0">
                  <h4 className="m-0 text-ui-body font-semibold">
                    {feature.title}
                  </h4>
                  <p className="mt-1.5 mb-0 text-ui-caption leading-relaxed text-ui-muted">
                    {feature.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-14 border-t pt-8">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => void openUrl(WEBSITE_URL)}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-ui-caption font-medium text-foreground transition-colors hover:bg-accent"
            >
              <GlobeIcon className="size-3.5 text-ui-muted" />
              {t("about.websiteLink")}
            </button>
            <button
              type="button"
              onClick={() => void openUrl(GITHUB_URL)}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-ui-caption font-medium text-foreground transition-colors hover:bg-accent"
            >
              <svg
                viewBox="0 0 16 16"
                className="size-3.5 text-ui-muted"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
              </svg>
              {t("about.githubLink")}
            </button>
            <button
              type="button"
              onClick={() => void openUrl(DESIGN_DOC_URL)}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-ui-caption font-medium text-foreground transition-colors hover:bg-accent"
            >
              <BookOpenTextIcon className="size-3.5 text-ui-muted" />
              {t("about.designLink")}
            </button>
          </div>
          <p className="mt-5 mb-0 text-ui-caption text-ui-muted">
            {t("about.meta")}
          </p>
        </div>
      </div>
    </div>
  );
}
