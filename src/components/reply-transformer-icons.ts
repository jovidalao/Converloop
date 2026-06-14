// Curated lucide icon set for custom reply-transformer buttons. Shared by the
// editor's icon grid (AgentLibraryView) and the chat button (chat/reply-transformers),
// so a stored icon name resolves to the same glyph in both places.
import {
  BookOpenIcon,
  BrainIcon,
  GraduationCapIcon,
  HighlighterIcon,
  LanguagesIcon,
  LightbulbIcon,
  ListChecksIcon,
  type LucideIcon,
  MessageSquareIcon,
  PencilIcon,
  QuoteIcon,
  ScrollTextIcon,
  SearchIcon,
  SparklesIcon,
  StarIcon,
  Wand2Icon,
  ZapIcon,
} from "lucide-react";

export const REPLY_TRANSFORMER_ICONS: Record<string, LucideIcon> = {
  sparkles: SparklesIcon,
  wand: Wand2Icon,
  book: BookOpenIcon,
  list: ListChecksIcon,
  lightbulb: LightbulbIcon,
  languages: LanguagesIcon,
  pencil: PencilIcon,
  message: MessageSquareIcon,
  quote: QuoteIcon,
  graduation: GraduationCapIcon,
  brain: BrainIcon,
  search: SearchIcon,
  highlighter: HighlighterIcon,
  scroll: ScrollTextIcon,
  star: StarIcon,
  zap: ZapIcon,
};

export const REPLY_TRANSFORMER_ICON_NAMES = Object.keys(
  REPLY_TRANSFORMER_ICONS,
);

export const DEFAULT_REPLY_TRANSFORMER_ICON = "sparkles";

// Resolve a stored icon name to its component; unknown/empty falls back to the default.
export function replyTransformerIcon(
  name: string | null | undefined,
): LucideIcon {
  return (
    (name ? REPLY_TRANSFORMER_ICONS[name] : undefined) ??
    REPLY_TRANSFORMER_ICONS[DEFAULT_REPLY_TRANSFORMER_ICON]
  );
}
