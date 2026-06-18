import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";
import { remarkBilingual } from "./remark-bilingual";
import { remarkReadingGuide } from "./remark-reading-guide";

function render(md: string, language: string, bilingual = false): string {
  return renderToStaticMarkup(
    <Markdown
      className={bilingual ? "bilingual" : undefined}
      remarkPlugins={
        bilingual
          ? [remarkBilingual, remarkReadingGuide(language)]
          : [remarkReadingGuide(language)]
      }
    >
      {md}
    </Markdown>,
  );
}

describe("reading guide rendering", () => {
  it("renders Chinese text with pinyin ruby", () => {
    const html = render("我想去中国。", "Chinese");
    expect(html).toContain("<ruby");
    expect(html).toContain("<rt>");
    expect(html).toContain("zhōng guó");
  });

  it("renders known Japanese words with furigana ruby", () => {
    const html = render("今日は日本語を勉強します。", "Japanese");
    expect(html).toContain("<rt>きょう</rt>");
    expect(html).toContain("<rt>にほんご</rt>");
    expect(html).toContain("<rt>べんきょう</rt>");
  });

  it("does not guess unknown Japanese kanji readings", () => {
    const html = render("未知語です。", "Japanese");
    expect(html).not.toContain("<rt>");
  });

  it("does not annotate bilingual translation spans", () => {
    const html = render("中国。⟦翻译中国。⟧", "Chinese", true);
    const rtCount = [...html.matchAll(/<rt>/g)].length;
    expect(rtCount).toBe(1);
    expect(html).toContain('<span class="bi-tr">翻译中国。</span>');
  });
});
