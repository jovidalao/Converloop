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

// React mapping for the allowed drill icon names (the name list itself lives in src/drills/icons.ts
// so the authoring spec can embed it without importing React). Unknown names fall back to the
// dumbbell so imported documents can never break rendering.
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
