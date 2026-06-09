import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

// Links in LLM output must open in the system browser: a plain <a href> click
// would navigate the webview itself away from the app. Non-http(s) schemes are
// ignored.
export function ExternalLink({
  href,
  children,
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href && /^https?:\/\//i.test(href)) void openUrl(href);
      }}
    >
      {children}
    </a>
  );
}

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
        components={{ a: ExternalLink, ...components }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
