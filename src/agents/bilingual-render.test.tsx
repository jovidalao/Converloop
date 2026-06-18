import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../components/Markdown";
import { remarkBilingual } from "../components/remark-bilingual";

// Render bilingual Markdown exactly like ChatView does: ⟦…⟧ → span.bi-tr (via the
// remark plugin's hName/hProperties). Source italics (*…*) stay <em> — no override.
function render(md: string): string {
  return renderToStaticMarkup(
    <Markdown className="bilingual" remarkPlugins={[remarkBilingual]}>
      {md}
    </Markdown>,
  );
}

// Plain text NOT wrapped in a .bi-tr span. In a correct interlinear view this is
// the ORIGINAL only, so it must contain ZERO CJK — any CJK here = a translation
// rendered at the wrong (original) size, i.e. the "text size" bug.
function leakedCJK(html: string): string {
  const outside = html
    .replace(/<span class="bi-tr">[\s\S]*?<\/span>/g, " ")
    .replace(/<[^>]+>/g, "");
  return (outside.match(/[一-鿿　-〿＀-￯]+/g) ?? []).join("");
}
// Raw sentinel chars must never reach the user.
const showsSentinel = (html: string) =>
  html.replace(/<[^>]+>/g, "").match(/[⟦⟧]/) !== null;
// Translation text that landed inside .bi-tr spans, concatenated.
function translated(html: string): string {
  return [...html.matchAll(/<span class="bi-tr">([\s\S]*?)<\/span>/g)]
    .map((m) => m[1])
    .join("|");
}

describe("bilingual ⟦…⟧ rendering is CJK-safe", () => {
  // Each case: full bilingual paragraph the model emits. The plugin must put
  // every translation in .bi-tr, leak no CJK, and show no raw sentinels — even
  // for the shapes that broke the old *…* delimiter.
  const robust: Array<[name: string, md: string]> = [
    ["plain two sentences", "Hello.⟦你好。⟧ How are you?⟦你好吗?⟧"],
    // The screenshot: source already has **bold**; translations stay plain text.
    [
      "bold original + English noun in translation",
      'And yes, **"Stay"** is such a good track — really popular now.⟦确实,"Stay"真的是一首很棒的歌——现在非常流行。⟧ **You might enjoy The Weeknd.**⟦你可能会喜欢The Weeknd——他的风格很相似。⟧',
    ],
    // Old killer #1: no space after the closing delimiter before next sentence.
    ["no space between spans", "First.⟦第一。⟧Second.⟦第二。⟧"],
    // Old killer #2: delimiter abuts CJK full-width punctuation.
    ["abuts CJK punctuation", "Cool!⟦太酷了!⟧ Right?⟦对吧?⟧"],
    ["em-dash inside translation", "Let's go.⟦我们走吧——现在就走。⟧"],
    ["parens & quotes in translation", 'He said "stay".⟦他说"留下"(真的)。⟧'],
    [
      "list structure preserved",
      "- First item.⟦第一项。⟧\n- Second item.⟦第二项。⟧",
    ],
  ];

  it.each(robust)("%s", (_name, md) => {
    const html = render(md);
    expect(leakedCJK(html)).toBe("");
    expect(showsSentinel(html)).toBe(false);
  });

  it("keeps original Markdown bold intact", () => {
    const html = render('Yes, **"Stay"** is great.⟦确实,很棒。⟧');
    expect(html).toContain("<strong>");
    expect(html).toContain('<span class="bi-tr">确实,很棒。</span>');
  });

  // Regression (screenshot bug): source italics must render as <em>, not pick up
  // the translation style. Translations and source emphasis no longer share <em>.
  it("keeps source italics as <em>, not translation style", () => {
    const html = render(
      "the cleanup *that is* much easier.⟦清理工作要容易得多。⟧",
    );
    expect(html).toContain("<em>that is</em>");
    expect(translated(html)).toBe("清理工作要容易得多。");
  });

  it("preserves list structure", () => {
    const html = render("- One.⟦一。⟧\n- Two.⟦二。⟧");
    expect(html).toContain("<li>");
    expect(translated(html)).toBe("一。|二。");
  });

  // Graceful degradation: if the model drops a closing ⟧, no raw sentinel leaks
  // and the text stays readable (just unstyled).
  it("drops orphan sentinels", () => {
    const html = render("Oops.⟦未闭合的译文 and more text");
    expect(showsSentinel(html)).toBe(false);
    expect(html.replace(/<[^>]+>/g, "")).toContain("未闭合的译文");
  });
});
