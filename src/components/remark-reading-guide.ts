import { readingGuideSegments } from "../reading-guide";

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

function classNames(node: MdNode): string[] {
  const raw = node.data?.hProperties?.className;
  if (Array.isArray(raw))
    return raw.filter((v): v is string => typeof v === "string");
  return typeof raw === "string" ? raw.split(/\s+/).filter(Boolean) : [];
}

function shouldSkip(node: MdNode): boolean {
  return (
    ["code", "inlineCode", "link"].includes(node.type) ||
    classNames(node).includes("bi-tr")
  );
}

function textNode(value: string): MdNode {
  return { type: "text", value };
}

function elementNode(
  type: string,
  hName: string,
  children: MdNode[],
  className?: string,
): MdNode {
  return {
    type,
    data: {
      hName,
      ...(className ? { hProperties: { className: [className] } } : {}),
    },
    children,
  };
}

function rubyNode(text: string, reading: string): MdNode {
  return elementNode(
    "readingRuby",
    "ruby",
    [
      elementNode("readingRb", "rb", [textNode(text)]),
      elementNode("readingRt", "rt", [textNode(reading)]),
    ],
    "reading-ruby",
  );
}

function splitReadingText(
  value: string,
  targetLanguage: string,
): MdNode[] | null {
  const segments = readingGuideSegments(value, targetLanguage);
  if (!segments.some((seg) => seg.reading)) return null;
  return segments.map((seg) =>
    seg.reading ? rubyNode(seg.text, seg.reading) : textNode(seg.text),
  );
}

function walk(node: MdNode, targetLanguage: string): void {
  if (!node.children || shouldSkip(node)) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (shouldSkip(child)) {
      next.push(child);
      continue;
    }
    if (child.type === "text" && typeof child.value === "string") {
      const parts = splitReadingText(child.value, targetLanguage);
      if (parts) {
        next.push(...parts);
        continue;
      }
    }
    walk(child, targetLanguage);
    next.push(child);
  }
  node.children = next;
}

export function remarkReadingGuide(targetLanguage: string) {
  return () =>
    (tree: MdNode): void =>
      walk(tree, targetLanguage);
}
