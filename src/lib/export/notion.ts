import type { RemoteExporter, RemoteExportResult, ExportPayload } from "./types";

interface NotionBlock {
  object: "block";
  type: string;
  [key: string]: unknown;
}

/** Basit markdown -> Notion blok dönüşümü (paragraf, başlık, madde). */
function toNotionBlocks(markdown: string, title: string): NotionBlock[] {
  const blocks: NotionBlock[] = [
    {
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: [{ type: "text", text: { content: title } }] },
    },
  ];
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const text = (content: string) => [
      { type: "text", text: { content: content.slice(0, 1900) } },
    ];
    if (line.startsWith("### ")) {
      blocks.push({ object: "block", type: "heading_3", heading_3: { rich_text: text(line.slice(4)) } });
    } else if (line.startsWith("## ")) {
      blocks.push({ object: "block", type: "heading_2", heading_2: { rich_text: text(line.slice(3)) } });
    } else if (line.startsWith("# ")) {
      blocks.push({ object: "block", type: "heading_2", heading_2: { rich_text: text(line.slice(2)) } });
    } else if (/^[-*] /.test(line.trim())) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: text(line.trim().slice(2)) },
      });
    } else {
      blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: text(line.trim()) } });
    }
  }
  return blocks;
}

export class NotionExporter implements RemoteExporter {
  readonly id = "notion" as const;

  isConfigured(): boolean {
    return Boolean(process.env.READFLOW_NOTION_TOKEN?.trim() && process.env.READFLOW_NOTION_DATABASE_ID?.trim());
  }

  missingConfig(): string[] {
    const missing: string[] = [];
    if (!process.env.READFLOW_NOTION_TOKEN?.trim()) missing.push("READFLOW_NOTION_TOKEN");
    if (!process.env.READFLOW_NOTION_DATABASE_ID?.trim()) missing.push("READFLOW_NOTION_DATABASE_ID");
    return missing;
  }

  async export(payload: ExportPayload): Promise<RemoteExportResult> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        message: `Notion entegrasyonu kurulmadı. .env.local içine şunları ekleyin: ${this.missingConfig().join(", ")}`,
      };
    }
    const token = process.env.READFLOW_NOTION_TOKEN!.trim();
    const databaseId = process.env.READFLOW_NOTION_DATABASE_ID!.trim();
    const titleProp = process.env.READFLOW_NOTION_TITLE_PROP?.trim() || "Name";
    const content = payload.output ? payload.output.content : payload.document.original_text;

    // Notion tek istekte en fazla 100 blok kabul eder.
    const allBlocks = toNotionBlocks(content, payload.document.title);
    const blocks = allBlocks.slice(0, 99);
    if (allBlocks.length > blocks.length) {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: "…(içerik 100 blokta kısaltıldı)" } }] },
      });
    }

    const response = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          [titleProp]: { title: [{ text: { content: payload.document.title.slice(0, 200) } }] },
        },
        children: blocks,
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      return { ok: false, message: `Notion hatası (HTTP ${response.status}): ${detail}` };
    }
    const body = (await response.json()) as { url?: string };
    return { ok: true, message: "Notion'a gönderildi.", url: body.url };
  }
}
