"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentDetail } from "@/lib/documents/service";

export interface UseDocDetailResult {
  detail: DocumentDetail;
  setDetail: (detail: DocumentDetail) => void;
  refresh: () => Promise<void>;
  statusError: boolean;
}

/**
 * Detay durumunu ve canlı iş takibini yönetir:
 * - Aktif iş varken 1.5 sn'de bir polling
 * - Gizli sekmede polling durur (gereksiz yük yok)
 * - Üst üste hatalarda "durum alınamıyor" bilgisine düşer, eski hazır bilgisini süresiz tutmaz
 */
export function useDocDetail(initial: DocumentDetail): UseDocDetailResult {
  const [detail, setDetail] = useState<DocumentDetail>(initial);
  const [statusError, setStatusError] = useState(false);
  const failures = useRef(0);
  const hidden = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/documents/${initial.document.id}`, { cache: "no-store" });
      if (response.ok) {
        setDetail((await response.json()) as DocumentDetail);
        failures.current = 0;
        setStatusError(false);
      } else {
        failures.current += 1;
        if (failures.current >= 3) setStatusError(true);
      }
    } catch {
      failures.current += 1;
      if (failures.current >= 3) setStatusError(true);
    }
  }, [initial.document.id]);

  useEffect(() => {
    const onVisibility = () => {
      hidden.current = document.hidden;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const hasActiveJobs = detail.jobs.some(
    (job) => job.status === "pending" || job.status === "processing",
  );

  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = setInterval(() => {
      if (!hidden.current) void refresh();
    }, 1500);
    return () => clearInterval(timer);
  }, [hasActiveJobs, refresh]);

  return { detail, setDetail, refresh, statusError };
}
