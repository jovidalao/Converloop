import { useEffect, useRef } from "react";
import type { MentionItem } from "../lib/mentions";

const TYPE_LABEL: Record<MentionItem["type"], string> = {
  vocab: "词汇",
  grammar: "语法",
  collocation: "搭配",
  error_pattern: "错误模式",
  expression_gap: "表达缺口",
};

// `@` 学习上下文菜单:与 SlashMenu 同款悬浮列表(同样的容器/选项类,视觉统一)。键盘导航
// (↑↓ / Enter / Tab / Esc)由 ChatView 在 textarea 上拦截,焦点留在输入框;本组件只渲染 + 处理鼠标。
export function MentionMenu({
  items,
  selected,
  onHover,
  onActivate,
}: {
  items: MentionItem[];
  selected: number;
  onHover: (index: number) => void;
  onActivate: (item: MentionItem) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 选中项变化即滚动到可见,不直接引用 selected
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (items.length === 0) return null;

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="学习上下文"
      className="absolute inset-x-0 bottom-full z-40 mb-1.5 max-h-[40vh] overflow-y-auto rounded-xl border bg-card py-1 shadow-minimal"
    >
      {items.map((item, idx) => {
        const isSelected = idx === selected;
        return (
          // biome-ignore lint/a11y/useFocusableInteractive: option 不单独获焦,焦点留在输入框
          <div
            key={item.key}
            role="option"
            aria-selected={isSelected}
            data-selected={isSelected}
            className="mx-1 flex items-baseline gap-2.5 rounded-md px-2.5 py-1.5 text-ui-body data-[selected=true]:bg-accent"
            onMouseMove={() => onHover(idx)}
            onMouseDown={(e) => {
              // 不让输入框失焦;在 mousedown 即激活(常见自动完成范式)。
              e.preventDefault();
              onActivate(item);
            }}
          >
            <span className="min-w-0 shrink truncate font-medium text-foreground">
              {item.label}
            </span>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-ui-caption text-ui-muted">
              {TYPE_LABEL[item.type] ?? item.type}
            </span>
            <span className="min-w-0 flex-1 truncate text-right text-ui-meta text-ui-subtle">
              {item.insertText}
            </span>
          </div>
        );
      })}
    </div>
  );
}
