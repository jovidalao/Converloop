import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

// 渲染 LLM 输出的 Markdown。react-markdown 默认不注入原始 HTML,安全。
// components:可选的节点渲染覆盖(如双语阅读把 em 当作译文样式)。
// remarkPlugins:在 GFM 之外追加的插件(如双语阅读的 ⟦…⟧ 译文标记)。
export function Markdown({
  children,
  className,
  components,
  remarkPlugins,
}: {
  children: string;
  className?: string;
  components?: Components;
  remarkPlugins?: Options["remarkPlugins"];
}) {
  return (
    <div className={className ? `markdown ${className}` : "markdown"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, ...(remarkPlugins ?? [])]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
