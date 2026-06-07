import {
  BlocksIcon,
  BotIcon,
  DatabaseIcon,
  FileTextIcon,
  GitBranchIcon,
  GraduationCapIcon,
  ListChecksIcon,
  PencilRulerIcon,
  ShieldCheckIcon,
  WaypointsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { LEARNING_DATA_SCOPES } from "../db/learning-agents";
import { type MessageKey, useTranslation } from "../i18n";

export const APP_DESIGN_DATA_SCOPES_HASH = "design-data-scopes";

type OverviewItem = {
  title: string;
  body: string;
  icon: ReactNode;
};

type MatrixRow = {
  name: string;
  timing: string;
  reads: string;
  output: string;
  writes: string;
};

function InfoCard({ item }: { item: OverviewItem }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-ui-body font-semibold">
        <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          {item.icon}
        </span>
        {item.title}
      </div>
      <p className="mt-2 mb-0 text-ui-body leading-relaxed text-ui-muted">
        {item.body}
      </p>
    </div>
  );
}

function Section({
  title,
  intro,
  id,
  children,
}: {
  title: string;
  intro?: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-16 border-t py-5">
      <h3 className="m-0 text-ui-body font-semibold">{title}</h3>
      {intro && (
        <p className="mt-1 mb-3 max-w-3xl text-ui-body leading-relaxed text-ui-muted">
          {intro}
        </p>
      )}
      {children}
    </section>
  );
}

export function AppDesignView() {
  const { t } = useTranslation();

  useEffect(() => {
    if (window.location.hash !== `#${APP_DESIGN_DATA_SCOPES_HASH}`) return;
    requestAnimationFrame(() => {
      document
        .getElementById(APP_DESIGN_DATA_SCOPES_HASH)
        ?.scrollIntoView({ block: "start" });
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    });
  }, []);

  const hotPath: OverviewItem[] = [
    {
      title: t("design.hotPath.conversation.title"),
      body: t("design.hotPath.conversation.body"),
      icon: <BotIcon className="size-4" />,
    },
    {
      title: t("design.hotPath.tutor.title"),
      body: t("design.hotPath.tutor.body"),
      icon: <ListChecksIcon className="size-4" />,
    },
    {
      title: t("design.hotPath.accounting.title"),
      body: t("design.hotPath.accounting.body"),
      icon: <ShieldCheckIcon className="size-4" />,
    },
  ];

  const agentRows: MatrixRow[] = [
    {
      name: "Conversation",
      timing: t("design.agentRow.conversation.timing"),
      reads: t("design.agentRow.conversation.reads"),
      output: t("design.agentRow.conversation.output"),
      writes: "turn.reply",
    },
    {
      name: "Tutor",
      timing: t("design.agentRow.tutor.timing"),
      reads: t("design.agentRow.tutor.reads"),
      output: t("design.agentRow.tutor.output"),
      writes: "mastery_event / mastery_item",
    },
    {
      name: "Profile Maintainer",
      timing: t("design.agentRow.maintainer.timing"),
      reads: t("design.agentRow.maintainer.reads"),
      output: t("design.agentRow.maintainer.output"),
      writes: t("design.agentRow.maintainer.writes"),
    },
    {
      name: "Task / Learning",
      timing: t("design.agentRow.task.timing"),
      reads: t("design.agentRow.task.reads"),
      output: t("design.agentRow.task.output"),
      writes: "learning_project / learning_agent / turn",
    },
    {
      name: "Explain / Reply Suggestion",
      timing: t("design.agentRow.explain.timing"),
      reads: t("design.agentRow.explain.reads"),
      output: t("design.agentRow.explain.output"),
      writes: t("design.agentRow.explain.writes"),
    },
  ];

  const storageItems: OverviewItem[] = [
    {
      title: t("design.storage.sqlite.title"),
      body: t("design.storage.sqlite.body"),
      icon: <DatabaseIcon className="size-4" />,
    },
    {
      title: t("design.storage.md.title"),
      body: t("design.storage.md.body"),
      icon: <FileTextIcon className="size-4" />,
    },
    {
      title: t("design.storage.layers.title"),
      body: t("design.storage.layers.body"),
      icon: <GitBranchIcon className="size-4" />,
    },
  ];

  const customizationItems: OverviewItem[] = [
    {
      title: t("design.customization.tune.title"),
      body: t("design.customization.tune.body"),
      icon: <BlocksIcon className="size-4" />,
    },
    {
      title: t("design.customization.observer.title"),
      body: t("design.customization.observer.body"),
      icon: <WaypointsIcon className="size-4" />,
    },
    {
      title: t("design.customization.lesson.title"),
      body: t("design.customization.lesson.body"),
      icon: <GraduationCapIcon className="size-4" />,
    },
  ];

  const designRules = [
    t("design.checklistRules.r0"),
    t("design.checklistRules.r1"),
    t("design.checklistRules.r2"),
    t("design.checklistRules.r3"),
    t("design.checklistRules.r4"),
  ];

  return (
    <div className="flex h-full max-w-5xl flex-col overflow-y-auto px-6 pt-14 pb-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <PencilRulerIcon className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="mt-0 mb-1 text-ui-title font-semibold">
            {t("design.title")}
          </h2>
          <p className="m-0 max-w-3xl text-ui-body leading-relaxed text-ui-muted">
            {t("design.description")}
          </p>
        </div>
      </div>

      <Section
        title={t("design.hotPathTitle")}
        intro={t("design.hotPathIntro")}
      >
        <div className="grid gap-3 md:grid-cols-3">
          {hotPath.map((item) => (
            <InfoCard key={item.title} item={item} />
          ))}
        </div>
      </Section>

      <Section
        title={t("design.agentMatrixTitle")}
        intro={t("design.agentMatrixIntro")}
      >
        <div className="overflow-x-auto rounded-lg border">
          <div className="grid min-w-[760px] grid-cols-[1.1fr_1fr_1.4fr_1.4fr_1fr] gap-0 bg-muted px-3 py-2 text-ui-caption font-medium text-ui-muted">
            <span>{t("design.colAgent")}</span>
            <span>{t("design.colTiming")}</span>
            <span>{t("design.colReads")}</span>
            <span>{t("design.colOutput")}</span>
            <span>{t("design.colWrites")}</span>
          </div>
          {agentRows.map((row) => (
            <div
              key={row.name}
              className="grid min-w-[760px] grid-cols-[1.1fr_1fr_1.4fr_1.4fr_1fr] gap-0 border-t px-3 py-2 text-ui-caption leading-relaxed"
            >
              <span className="font-medium text-foreground">{row.name}</span>
              <span className="text-ui-muted">{row.timing}</span>
              <span>{row.reads}</span>
              <span>{row.output}</span>
              <span className="font-mono text-ui-muted">{row.writes}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title={t("design.storageTitle")}
        intro={t("design.storageIntro")}
      >
        <div className="grid gap-3 md:grid-cols-3">
          {storageItems.map((item) => (
            <InfoCard key={item.title} item={item} />
          ))}
        </div>
      </Section>

      <Section
        id={APP_DESIGN_DATA_SCOPES_HASH}
        title={t("design.dataScopesTitle")}
        intro={t("design.dataScopesIntro")}
      >
        <p className="mt-0 mb-3 rounded-md bg-muted px-3 py-2 text-ui-caption leading-relaxed text-ui-muted">
          {t("design.dataScopesNote")}
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {LEARNING_DATA_SCOPES.map((scope) => {
            const name = t(`scopeLabel.${scope}.name` as MessageKey);
            const desc = t(`scopeLabel.${scope}.desc` as MessageKey);
            const source = t(
              `design.scopeDetail.${scope}.source` as MessageKey,
            );
            const use = t(`design.scopeDetail.${scope}.use` as MessageKey);
            const caution = t(
              `design.scopeDetail.${scope}.caution` as MessageKey,
            );
            return (
              <div key={scope} className="rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ui-body">{name}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-ui-caption text-ui-muted">
                    {scope}
                  </span>
                </div>
                <p className="mt-1 mb-2 text-ui-body leading-relaxed text-ui-muted">
                  {desc}
                </p>
                <dl className="m-0 grid gap-1 text-ui-caption leading-relaxed">
                  <div>
                    <dt className="inline text-ui-muted">
                      {t("design.scopeSource")}:{" "}
                    </dt>
                    <dd className="inline text-foreground">{source}</dd>
                  </div>
                  <div>
                    <dt className="inline text-ui-muted">
                      {t("design.scopeUse")}:{" "}
                    </dt>
                    <dd className="inline text-foreground">{use}</dd>
                  </div>
                  <div>
                    <dt className="inline text-ui-muted">
                      {t("design.scopeCaution")}:{" "}
                    </dt>
                    <dd className="inline text-foreground">{caution}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title={t("design.customizationTitle")}
        intro={t("design.customizationIntro")}
      >
        <div className="grid gap-3 md:grid-cols-3">
          {customizationItems.map((item) => (
            <InfoCard key={item.title} item={item} />
          ))}
        </div>
      </Section>

      <Section title={t("design.checklistTitle")}>
        <ol className="m-0 grid gap-2 pl-5 text-ui-body leading-relaxed">
          {designRules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
