import { normalizeText, rawSpanForNormalizedMatch } from "./match";

/** react-markdown'ın ürettiği hast ağacında ihtiyacımız olan asgari şekil. */
export interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export interface HighlightSpec {
  id: number;
  quote: string;
  color: string;
  note?: string;
}

/**
 * Markdown çıktısına vurguları AST düzeyinde ekler.
 *
 * DOM'a sonradan `<mark>` sokmak React'ın yönettiği ağaçla çakışır (bir sonraki
 * render'da düğümler tutarsız kalır). Bunun yerine react-markdown'ın kendi
 * rehype uzantı noktası kullanılır: mark'ları React render eder.
 *
 * `HighlightedArticle` ile aynı sınır: alıntı tek bir metin düğümüne sığmalı.
 * Sığmayanlar `placed` listesine girmez ve panelde "bağlanamadı" görünür.
 */
export function rehypeHighlights(highlights: HighlightSpec[], placed: number[]) {
  return (tree: HastNode): void => {
    for (const highlight of highlights) {
      const normQuote = normalizeText(highlight.quote);
      if (!normQuote) continue;
      if (applyHighlight(tree, highlight, normQuote)) placed.push(highlight.id);
    }
  };
}

/** İlk uygun metin düğümünü bulup üçe böler: önce · <mark> · sonra. */
function applyHighlight(node: HastNode, highlight: HighlightSpec, normQuote: string): boolean {
  const children = node.children;
  if (!children) return false;

  for (let index = 0; index < children.length; index++) {
    const child = children[index];

    if (child.type === "text") {
      const value = child.value ?? "";
      const normStart = normalizeText(value).indexOf(normQuote);
      if (normStart === -1) continue;
      const span = rawSpanForNormalizedMatch(value, normStart, normQuote.length);
      if (!span) continue;

      const replacement: HastNode[] = [];
      if (span.start > 0) replacement.push({ type: "text", value: value.slice(0, span.start) });
      replacement.push({
        type: "element",
        tagName: "mark",
        properties: {
          id: `ann-${highlight.id}`,
          className: ["hl", `hl-${highlight.color}`],
          ...(highlight.note ? { title: highlight.note } : {}),
        },
        children: [{ type: "text", value: value.slice(span.start, span.end) }],
      });
      if (span.end < value.length) replacement.push({ type: "text", value: value.slice(span.end) });

      children.splice(index, 1, ...replacement);
      return true;
    }

    // Zaten vurgulanmış dalın içine ikinci kez girme (çakışan vurgular).
    if (child.tagName === "mark") continue;
    if (applyHighlight(child, highlight, normQuote)) return true;
  }
  return false;
}
