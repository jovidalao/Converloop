// Bilingual reading: convert translated text from ⟦…⟧ markers into span.bi-tr nodes (via mdast hName/hProperties),
// so translations carry the translation style on their own — without colliding with source italics (*…*), which keep rendering as <em>.
//
// Why not use Markdown's *single asterisk* to mark translations: CommonMark's emphasis flanking
// rules are very fragile next to CJK characters/punctuation — if the translated text carries over **bold** from the source, or
// a closing `*` is immediately adjacent to Chinese punctuation with no space, the emphasis breaks, causing part of the translation to render
// at the source text's larger font size (this is the root cause of "incorrect text size"). ⟦ ⟧ is not Markdown syntax and is left as-is
// in text nodes, so it completely bypasses the flanking rules and is CJK-safe.

const OPEN = "⟦"; // ⟦
const CLOSE = "⟧"; // ⟧
const SPAN = /⟦([^⟦⟧]*)⟧/g;

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

// Strip unpaired marker characters so they do not appear bare in the UI.
function pushText(out: MdNode[], raw: string): void {
  const clean = raw.replace(/[⟦⟧]/g, "");
  if (clean) out.push({ type: "text", value: clean });
}

// Split a text node containing ⟦…⟧ into [text, emphasis(translation), text, …]. Returns null if no markers are present.
function splitTranslations(value: string): MdNode[] | null {
  if (!value.includes(OPEN) && !value.includes(CLOSE)) return null;
  const out: MdNode[] = [];
  let last = 0;
  SPAN.lastIndex = 0;
  for (let m = SPAN.exec(value); m !== null; m = SPAN.exec(value)) {
    if (m.index > last) pushText(out, value.slice(last, m.index));
    out.push({
      type: "emphasis",
      data: { hName: "span", hProperties: { className: ["bi-tr"] } },
      children: [{ type: "text", value: m[1] }],
    });
    last = SPAN.lastIndex;
  }
  if (last < value.length) pushText(out, value.slice(last));
  return out;
}

function walk(node: MdNode): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      const parts = splitTranslations(child.value);
      if (parts) {
        next.push(...parts);
        continue;
      }
    }
    walk(child);
    next.push(child);
  }
  node.children = next;
}

// remark transformer: mutates the mdast in place. Source Markdown (bold, lists, etc.) is parsed normally;
// translations are replaced at the text-node level with emphasis nodes.
export function remarkBilingual() {
  return (tree: MdNode): void => walk(tree);
}
