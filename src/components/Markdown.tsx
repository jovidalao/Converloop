import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// 渲染 LLM 输出的 Markdown。react-markdown 默认不注入原始 HTML,安全。
// components:可选的节点渲染覆盖(如双语阅读把 em 当作译文样式)。
export function Markdown({
  children,
  className,
  components,
}: {
  children: string;
  className?: string;
  components?: Components;
}) {
  return (
    <div className={className ? `markdown ${className}` : "markdown"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
