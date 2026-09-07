import { describe, expect, it } from "vitest";
import { rehypeHighlights, type HastNode } from "./rehype-highlights";

/** Basit hast ağacı: <p>metin</p> */
function paragraph(text: string): HastNode {
  return {
    type: "root",
    children: [{ type: "element", tagName: "p", children: [{ type: "text", value: text }] }],
  };
}

function marksOf(node: HastNode): HastNode[] {
  const found: HastNode[] = [];
  const walk = (current: HastNode) => {
    if (current.tagName === "mark") found.push(current);
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return found;
}

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

describe("rehypeHighlights", () => {
  it("alıntıyı <mark> ile sarar ve metni bozmaz", () => {
    const tree = paragraph("bir iki üç dört beş");
    const placed: number[] = [];
    rehypeHighlights([{ id: 7, quote: "iki üç", color: "yellow" }], placed)(tree);

    expect(placed).toEqual([7]);
    const marks = marksOf(tree);
    expect(marks).toHaveLength(1);
    expect(textOf(marks[0])).toBe("iki üç");
    expect(marks[0].properties?.id).toBe("ann-7");
    expect(marks[0].properties?.className).toEqual(["hl", "hl-yellow"]);
    // Görünen metin değişmemeli
    expect(textOf(tree)).toBe("bir iki üç dört beş");
  });

  it("boşluk farkı eşleşmeyi bozmaz", () => {
    const tree = paragraph("satır  başı\n  devam ediyor");
    const placed: number[] = [];
    rehypeHighlights([{ id: 1, quote: "başı devam", color: "green" }], placed)(tree);
    expect(placed).toEqual([1]);
    expect(textOf(tree)).toBe("satır  başı\n  devam ediyor");
  });

  it("bulunamayan alıntı placed'a girmez ve ağaç değişmez", () => {
    const tree = paragraph("kısa metin");
    const placed: number[] = [];
    rehypeHighlights([{ id: 2, quote: "burada yok", color: "yellow" }], placed)(tree);
    expect(placed).toEqual([]);
    expect(marksOf(tree)).toHaveLength(0);
  });

  it("çakışan ikinci vurgu mevcut mark'ın içine girmez", () => {
    const tree = paragraph("alfa beta gama");
    const placed: number[] = [];
    rehypeHighlights(
      [
        { id: 1, quote: "beta", color: "yellow" },
        { id: 2, quote: "beta", color: "green" },
      ],
      placed,
    )(tree);
    expect(placed).toEqual([1]);
    expect(marksOf(tree)).toHaveLength(1);
  });

  it("not varsa title olarak taşınır", () => {
    const tree = paragraph("notlu vurgu burada");
    const placed: number[] = [];
    rehypeHighlights([{ id: 3, quote: "notlu", color: "lavender", note: "aklımda kalsın" }], placed)(tree);
    expect(marksOf(tree)[0].properties?.title).toBe("aklımda kalsın");
  });
});
