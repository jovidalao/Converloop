import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

// Render Markdown from LLM output. react-markdown doesn't inject raw HTML by
// default, so it's safe.
// components: optional node render overrides (e.g. bilingual reading styles <em>
// as the translation).
// remarkPlugins: plugins added on top of GFM (e.g. bilingual reading's ⟦…⟧
// translation markers).
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
