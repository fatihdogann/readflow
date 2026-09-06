import { NotionExporter } from "./notion";
import { TelegramExporter } from "./telegram";
import type { RemoteExporter } from "./types";

const exporters: Record<string, RemoteExporter> = {
  notion: new NotionExporter(),
  telegram: new TelegramExporter(),
};

export function getRemoteExporter(id: string): RemoteExporter | null {
  return exporters[id] ?? null;
}

export function listRemoteExporters(): RemoteExporter[] {
  return Object.values(exporters);
}
