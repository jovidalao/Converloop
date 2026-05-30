import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 渲染 LLM 输出的 Markdown。react-markdown 默认不注入原始 HTML,安全。
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
