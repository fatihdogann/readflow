"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface AgentStatusResponse {
  workerAlive: boolean;
  lastHeartbeat: string | null;
  agentMode: "command" | "mock" | "none" | null;
  agentName: string | null;
  fallbackAgentName: string | null;
  currentJobId: number | null;
  message: string | null;
  lastError: string | null;
  counts: { pending: number; processing: number; completed: number; failed: number };
  envLock: { locked: boolean; description: string };
  defaultProfileId: number | null;
  profiles: Array<{ id: number; name: string; cli: string; model: string | null; enabled: number }>;
}

interface StatusView {
  label: string;
  color: string;
  detail: string;
}

function toView(status: AgentStatusResponse | null, fetchFailures: number): StatusView {
  // Tekrarlayan hata sonrası eski "hazır" bilgisini süresiz gösterme.
  if (fetchFailures >= 3) {
    return { label: "Durum alınamıyor", color: "bg-orange-500", detail: "Sunucuya erişilemiyor" };
  }
  if (!status) return { label: "Durum alınıyor…", color: "bg-stone-400", detail: "" };
  if (!status.workerAlive && status.lastHeartbeat) {
    return {
      label: "Worker yanıt vermiyor",
      color: "bg-orange-500",
      detail: "pnpm dev:worker çalışıyor mu?",
    };
  }
  if (!status.workerAlive) {
    return { label: "Worker kapalı", color: "bg-stone-400", detail: "pnpm dev:worker ile başlatın" };
  }
  if (status.counts.processing > 0) {
    return {
      label: `${status.agentName ?? "AI"} çalışıyor`,
      color: "bg-amber-500",
      detail: `${status.counts.processing} iş sürüyor${status.counts.pending ? `, ${status.counts.pending} kuyrukta` : ""}`,
    };
  }
  if (status.envLock.locked) {
    return {
      label: status.agentMode === "none" ? "Agent devre dışı" : `Agent hazır (${status.agentName ?? "env"})`,
      color: status.agentMode === "none" ? "bg-red-500" : "bg-emerald-600",
      detail: `${status.envLock.description} · Ayarlar ekranında değiştirilemez`,
    };
  }
  if (status.defaultProfileId && status.profiles.some((p) => p.id === status.defaultProfileId)) {
    const profile = status.profiles.find((p) => p.id === status.defaultProfileId)!;
    return {
      label: "Agent hazır",
      color: "bg-emerald-600",
      detail: `Varsayılan profil: ${profile.name} (${profile.cli})${status.counts.pending > 0 ? ` · ${status.counts.pending} kuyrukta` : ""}`,
    };
  }
  if (status.agentMode === "command" || status.agentMode === "mock") {
    return {
      label: status.agentMode === "mock" ? "Mock agent (geliştirme)" : "Agent hazır",
      color: status.agentMode === "mock" ? "bg-amber-500" : "bg-emerald-600",
      detail: `${status.agentName ?? "agent"} bağlı${status.counts.pending > 0 ? ` · ${status.counts.pending} kuyrukta` : ""}`,
    };
  }
  return {
    label: "Agent bağlı değil",
    color: "bg-red-500",
    detail: status.message ?? "Ayarlar ekranından profil oluştur veya READFLOW_AGENT_CMD ile bağla",
  };
}

export function AgentStatusBadge() {
  const [status, setStatus] = useState<AgentStatusResponse | null>(null);
  const [failures, setFailures] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/status", { cache: "no-store" });
      if (response.ok) {
        setStatus((await response.json()) as AgentStatusResponse);
        setFailures(0);
      } else {
        setFailures((count) => count + 1);
      }
    } catch {
      setFailures((count) => count + 1);
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

  const view = toView(status, failures);
  const detail = status?.lastError ? `${view.detail} — son hata: ${status.lastError}` : view.detail;

  return (
    <Link
      href="/settings"
      className="flex items-center gap-2 rounded-md px-2 py-2 text-xs text-stone-600 hover:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800/60"
      title={`${detail} — Ayarları aç`}
      aria-label={`Yerel AI durumu: ${view.label}. Ayarları aç`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${view.color}`} aria-hidden />
      <span className="truncate">{view.label}</span>
    </Link>
  );
}
