import {
  BookOpenCheckIcon,
  BrainIcon,
  DumbbellIcon,
  EarIcon,
  HeadphonesIcon,
  LanguagesIcon,
  MessageCircleIcon,
  MicIcon,
  PenLineIcon,
  SparklesIcon,
  TargetIcon,
  TimerIcon,
  ZapIcon,
} from "lucide-react";
import type { ComponentType } from "react";

// Allowed drill icon names (drill@1 frontmatter `icon`). A small curated lucide subset — unknown
// names fall back to the dumbbell so imported documents can never break rendering.
const DRILL_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  zap: ZapIcon,
  headphones: HeadphonesIcon,
  mic: MicIcon,
  target: TargetIcon,
  dumbbell: DumbbellIcon,
  languages: LanguagesIcon,
  ear: EarIcon,
  brain: BrainIcon,
  timer: TimerIcon,
  sparkles: SparklesIcon,
  "pen-line": PenLineIcon,
  "message-circle": MessageCircleIcon,
  "book-open-check": BookOpenCheckIcon,
};

export function DrillIcon({
  name,
  className,
}: {
  name?: string;
  className?: string;
}) {
  const Icon = (name && DRILL_ICONS[name]) || DumbbellIcon;
  return <Icon className={className} />;
}

export const DRILL_ICON_NAMES = Object.keys(DRILL_ICONS);
