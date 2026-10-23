"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import type { translator } from "@/lib/i18n";
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

function toView(status: AgentStatusResponse | null, fetchFailures: number, t: ReturnType<typeof translator>): StatusView {
  // Tekrarlayan hata sonrası eski "hazır" bilgisini süresiz gösterme.
  if (fetchFailures >= 3) {
    return { label: t("Durum alınamıyor"), color: "bg-orange-500", detail: t("Sunucuya erişilemiyor") };
  }
  if (!status) return { label: t("Durum alınıyor…"), color: "bg-stone-400", detail: "" };
  if (!status.workerAlive && status.lastHeartbeat) {
    return {
      label: t("Worker yanıt vermiyor"),
      color: "bg-orange-500",
      detail: t("pnpm dev:worker çalışıyor mu?"),
    };
  }
  if (!status.workerAlive) {
    return { label: t("Worker kapalı"), color: "bg-stone-400", detail: t("pnpm dev:worker ile başlatın") };
  }
  if (status.counts.processing > 0) {
    return {
      label: t("{0} çalışıyor", status.agentName ?? "AI"),
      color: "bg-amber-500",
      detail: t("{0} iş sürüyor{1}", status.counts.processing, status.counts.pending ? t(", {0} kuyrukta", status.counts.pending) : ""),
    };
  }
  if (status.envLock.locked) {
    return {
      label: status.agentMode === "none" ? t("Agent devre dışı") : t("Agent hazır ({0})", status.agentName ?? "env"),
      color: status.agentMode === "none" ? "bg-red-500" : "bg-emerald-600",
      detail: t("{0} · Ayarlar ekranında değiştirilemez", status.envLock.description),
    };
  }
  if (status.defaultProfileId && status.profiles.some((p) => p.id === status.defaultProfileId)) {
    const profile = status.profiles.find((p) => p.id === status.defaultProfileId)!;
    return {
      label: t("Agent hazır"),
      color: "bg-emerald-600",
      detail: t("Varsayılan profil: {0} ({1}){2}", profile.name, profile.cli, status.counts.pending > 0 ? t(" · {0} kuyrukta", status.counts.pending) : ""),
    };
  }
  if (status.agentMode === "command" || status.agentMode === "mock") {
    return {
      label: status.agentMode === "mock" ? t("Mock agent (geliştirme)") : t("Agent hazır"),
      color: status.agentMode === "mock" ? "bg-amber-500" : "bg-emerald-600",
      detail: t("{0} bağlı{1}", status.agentName ?? "agent", status.counts.pending > 0 ? t(" · {0} kuyrukta", status.counts.pending) : ""),
    };
  }
  return {
    label: t("Agent bağlı değil"),
    color: "bg-red-500",
    detail: status.message ?? t("Ayarlar ekranından profil oluştur veya READFLOW_AGENT_CMD ile bağla"),
  };
}

export function AgentStatusBadge() {
  const t = useT();
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

  const view = toView(status, failures, t);
  const detail = status?.lastError ? t("{0} — son hata: {1}", view.detail, status.lastError) : view.detail;

  return (
    <Link
      href="/settings"
      className="flex items-center gap-2 rounded-md px-2 py-2 text-xs text-stone-600 hover:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800/60"
      title={t("{0} — Ayarları aç", detail)}
      aria-label={t("Yerel AI durumu: {0}. Ayarları aç", view.label)}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${view.color}`} aria-hidden />
      <span className="truncate">{t(view.label)}</span>
    </Link>
  );
}
