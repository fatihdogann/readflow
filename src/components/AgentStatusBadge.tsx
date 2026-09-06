"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentRuntimeInfo } from "@/lib/agent/types";

interface AgentStatusResponse {
  workerAlive: boolean;
  lastHeartbeat: string | null;
  agentMode: AgentRuntimeInfo["mode"] | null;
  agentName: string | null;
  message: string | null;
  lastError: string | null;
  counts: { pending: number; processing: number; completed: number; failed: number };
}

interface StatusView {
  label: string;
  color: string;
  detail: string;
}

function toView(status: AgentStatusResponse | null): StatusView {
  if (!status) return { label: "Durum alınıyor…", color: "bg-stone-400", detail: "" };
  if (!status.workerAlive && status.lastHeartbeat) {
    return {
      label: "Worker yanıt vermiyor",
      color: "bg-orange-500",
      detail: "dev:worker çalışıyor mu?",
    };
  }
  if (!status.workerAlive) {
    return { label: "Worker kapalı", color: "bg-stone-400", detail: "pnpm dev:worker ile başlatın" };
  }
  if (status.counts.processing > 0) {
    return {
      label: "İş işleniyor",
      color: "bg-amber-500",
      detail: `${status.counts.processing} iş sürüyor, ${status.counts.pending} kuyrukta`,
    };
  }
  if (status.agentMode === "command" || status.agentMode === "mock") {
    return {
      label: "Agent hazır",
      color: "bg-emerald-600",
      detail: `${status.agentName ?? "agent"} bağlı${status.counts.pending > 0 ? ` · ${status.counts.pending} kuyrukta` : ""}`,
    };
  }
  return {
    label: "Agent bağlı değil",
    color: "bg-red-500",
    detail: status.message ?? "READFLOW_AGENT_CMD ile bağlayın",
  };
}

export function AgentStatusBadge() {
  const [status, setStatus] = useState<AgentStatusResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/status", { cache: "no-store" });
      if (response.ok) setStatus((await response.json()) as AgentStatusResponse);
    } catch {
      /* ağ hatası: sonraki turda tekrar dene */
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);

  const view = toView(status);
  const detail =
    status?.lastError ? `${view.detail} — son hata: ${status.lastError}` : view.detail;

  return (
    <div className="group relative">
      <div
        className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-xs text-stone-600 dark:text-stone-400"
        title={detail}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${view.color}`} />
        <span className="truncate">{view.label}</span>
      </div>
    </div>
  );
}
