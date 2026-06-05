// 双语阅读:把译文从 ⟦…⟧ 标记转成 mdast emphasis 节点,渲染时复用 em → .bi-tr 样式。
//
// 为什么不用 Markdown 的 *单星号* 来标记译文:CommonMark 的 emphasis flanking
// 规则在 CJK 字符/标点旁边非常脆弱——译文里若出现源文带过来的 **加粗**,或者
// 关闭的 `*` 紧贴中文标点又没有空格,emphasis 就会断裂,导致部分译文以原文的
// 大字号渲染(就是「文字大小不准确」的根因)。⟦ ⟧ 不是 Markdown 语法,会原样
// 留在文本节点里,因此完全绕开 flanking 规则,CJK 安全。

const OPEN = "⟦"; // ⟦
const CLOSE = "⟧"; // ⟧
const SPAN = /⟦([^⟦⟧]*)⟧/g;

type MdNode = { type: string; value?: string; children?: MdNode[] };

// 去掉落单的(未配对的)标记字符,避免它们裸露在界面上。
function pushText(out: MdNode[], raw: string): void {
  const clean = raw.replace(/[⟦⟧]/g, "");
  if (clean) out.push({ type: "text", value: clean });
}

// 把一个含 ⟦…⟧ 的文本节点拆成 [text, emphasis(译文), text, …]。无标记则返回 null。
function splitTranslations(value: string): MdNode[] | null {
  if (!value.includes(OPEN) && !value.includes(CLOSE)) return null;
  const out: MdNode[] = [];
  let last = 0;
  SPAN.lastIndex = 0;
  for (let m = SPAN.exec(value); m !== null; m = SPAN.exec(value)) {
    if (m.index > last) pushText(out, value.slice(last, m.index));
    out.push({ type: "emphasis", children: [{ type: "text", value: m[1] }] });
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

// remark transformer:就地改写 mdast。原文的 Markdown(加粗、列表等)照常解析,
// 译文则在文本节点层面被替换为 emphasis 节点。
export function remarkBilingual() {
  return (tree: MdNode): void => walk(tree);
}
