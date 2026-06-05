import { useEffect, useRef } from "react";
import type { SlashCommand } from "../commands";

interface SlashMenuProps {
  commands: SlashCommand[];
  selected: number;
  onHover: (index: number) => void;
  onActivate: (command: SlashCommand) => void;
}

// 对话栏斜杠命令菜单:输入框正上方的悬浮列表。键盘导航(↑↓ / Enter / Tab / Esc)由 ChatView
// 在 textarea 上拦截处理(activedescendant 范式,焦点留在输入框);本组件只渲染 + 处理鼠标。
export function SlashMenu({
  commands,
  selected,
  onHover,
  onActivate,
}: SlashMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // 让选中行始终可见。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 选中项变化即滚动到可见,不直接引用 selected
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (commands.length === 0) return null;

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="斜杠命令"
      className="absolute inset-x-0 bottom-full z-40 mb-1.5 max-h-[40vh] overflow-y-auto rounded-xl border bg-card py-1 shadow-minimal"
    >
      {commands.map((command, idx) => {
        const isSelected = idx === selected;
        return (
          // biome-ignore lint/a11y/useFocusableInteractive: option 不单独获焦,焦点留在输入框
          <div
            key={command.name}
            role="option"
            aria-selected={isSelected}
            data-selected={isSelected}
            className="mx-1 flex items-baseline gap-2.5 rounded-md px-2.5 py-1.5 text-ui-body data-[selected=true]:bg-accent"
            onMouseMove={() => onHover(idx)}
            onMouseDown={(e) => {
              // 不让输入框失焦;在 mousedown 即激活(常见自动完成范式)。
              e.preventDefault();
              onActivate(command);
            }}
          >
            <span className="shrink-0 font-medium text-foreground">
              /{command.name}
            </span>
            {command.argsHint && (
              <span className="shrink-0 text-ui-meta text-ui-subtle">
                {command.argsHint}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-right text-ui-caption text-ui-muted">
              {command.description}
            </span>
          </div>
        );
      })}
    </div>
  );
}
