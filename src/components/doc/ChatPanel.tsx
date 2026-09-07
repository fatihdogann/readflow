"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mutateJson } from "@/lib/client/api";
import { CloseIcon } from "@/components/Icons";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  status: "ready" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  quote: string;
  job_id: number | null;
  created_at: string;
}

const SUGGESTIONS = [
  "Ana iddiayı açıkla",
  "Bu paragraftaki en önemli veriler neler?",
  "Metindeki karşı görüşler veya riskler neler?",
];

/** Belgeye bağlı "AI'a sor" paneli: masaüstünde yardımcı sütun, mobilde alt sayfa. */
export function ChatPanel({
  documentId,
  open,
  onClose,
  pendingQuote,
  onQuoteConsumed,
}: {
  documentId: number;
  open: boolean;
  onClose: () => void;
  pendingQuote: string | null;
  onQuoteConsumed: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/documents/${documentId}/chat`, { cache: "no-store" });
      if (response.ok) setMessages(((await response.json()) as { messages: ChatMessage[] }).messages);
    } catch {
      /* yoksay */
    }
  }, [documentId]);

  useEffect(() => {
    if (!open) return;
    const media = window.matchMedia("(max-width: 1023px)");
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 2000);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && media.matches) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [open, onClose, refresh]);

  // Seçim araç çubuğundan gelen alıntı: inputa bağlam olarak eklenir
  useEffect(() => {
    if (!pendingQuote || !open) return;
    const timer = setTimeout(() => {
      setInput((prev) =>
        prev ? `${prev}\n\n"${pendingQuote}" hakkında: ` : `"${pendingQuote}" hakkında ne anlatıyor?`,
      );
      onQuoteConsumed();
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingQuote, open, onQuoteConsumed]);

  async function send(question: string): Promise<void> {
    const trimmed = question.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Soru gönderilemedi");
        return;
      }
      setInput("");
      await refresh();
    } catch {
      setError("Sunucuya ulaşılamadı");
    } finally {
      setSending(false);
    }
  }

  async function retry(jobId: number): Promise<void> {
    try {
      await mutateJson(`/api/jobs/${jobId}/retry`, "POST");
      await refresh();
    } catch {
      setError("Yeniden deneme başlatılamadı");
    }
  }

  if (!open) return null;

  const body = (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
          AI&apos;a sor
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Sohbet panelini kapat"
          className="flex h-9 w-9 items-center justify-center rounded hover:bg-stone-200/60 dark:hover:bg-stone-800"
        >
          <CloseIcon size={16} />
        </button>
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto rounded-md bg-white/60 p-2 dark:bg-stone-900/40"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col gap-1.5 p-1">
            <p className="text-xs text-stone-500 dark:text-stone-400">Başlangıç önerileri:</p>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void send(suggestion)}
                className="min-h-[40px] rounded-md border border-stone-200 px-2.5 py-2 text-left text-xs hover:bg-stone-100 dark:border-stone-800 dark:hover:bg-stone-800"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((message) => (
              <li
                key={message.id}
                className={`rounded-lg px-2.5 py-2 text-xs leading-relaxed ${
                  message.role === "user"
                    ? "ml-6 bg-stone-200/80 dark:bg-stone-700/70"
                    : "mr-4 border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
                }`}
              >
                <div className="whitespace-pre-wrap">{message.content}</div>
                {message.role === "user" && message.status !== "completed" ? (
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-stone-500 dark:text-stone-400">
                    <span>
                      {message.status === "queued" ? "Sırada — Mac worker bekleniyor olabilir" : ""}
                      {message.status === "processing" ? "Yanıt hazırlanıyor…" : ""}
                      {message.status === "failed" ? "Hata" : ""}
                      {message.status === "cancelled" ? "İptal edildi" : ""}
                    </span>
                    {message.status === "failed" && message.job_id ? (
                      <button
                        type="button"
                        className="underline underline-offset-2"
                        onClick={() => void retry(message.job_id!)}
                      >
                        Yeniden dene
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
        className="flex items-end gap-1.5"
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="Belgeyle ilgili sorunu yaz… (Enter gönderir)"
          aria-label="Soru"
          className="w-full flex-1 resize-none rounded-md border border-stone-300 bg-white px-2.5 py-2 text-xs outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:focus:border-stone-500"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="min-h-[40px] rounded-md bg-stone-900 px-3 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
        >
          {sending ? "…" : "Gönder"}
        </button>
      </form>
    </>
  );

  if (isMobile) {
    return (
      <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="AI'a sor">
        <button type="button" aria-label="Kapat" className="absolute inset-0 bg-black/30" onClick={onClose} />
        <div
          ref={panelRef}
          className="absolute bottom-0 left-0 right-0 flex h-[75vh] flex-col rounded-t-xl border border-stone-200 bg-[#faf9f7] p-4 dark:border-stone-800 dark:bg-[#171512]"
        >
          {body}
        </div>
      </div>
    );
  }

  return (
    <aside
      ref={panelRef}
      className="no-print sticky top-6 flex h-fit max-h-[calc(100vh-3rem)] min-h-[420px] w-80 shrink-0 flex-col gap-2 rounded-lg border border-stone-200 bg-stone-100/60 p-3 dark:border-stone-800 dark:bg-stone-900/40"
      aria-label="AI'a sor paneli"
    >
      {body}
    </aside>
  );
}
