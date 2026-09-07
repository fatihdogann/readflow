"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

/**
 * Belgeye bağlı "AI'a sor" içeriği. Kabuk RightRail'e aittir.
 *
 * Alıntı, soru metnine gömülmez: API'nin `quote` alanıyla gönderilir ve
 * mesajın yanında kendi bağlam şeridi olarak görünür.
 */
export function ChatPanel({
  documentId,
  pendingQuote,
  onQuoteConsumed,
}: {
  documentId: number;
  pendingQuote: string | null;
  onQuoteConsumed: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/documents/${documentId}/chat`, { cache: "no-store" });
      if (response.ok) setMessages(((await response.json()) as { messages: ChatMessage[] }).messages);
    } catch {
      /* yoksay */
    }
  }, [documentId]);

  // Yanıt bekleyen mesaj varken sık, yokken seyrek yokla.
  const waiting = messages.some(
    (message) => message.role === "user" && (message.status === "queued" || message.status === "processing"),
  );
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), waiting ? 2000 : 15_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh, waiting]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  // Seçim araç çubuğundan gelen alıntı: ayrı bağlam alanına düşer, inputa değil.
  useEffect(() => {
    if (!pendingQuote) return;
    const timer = setTimeout(() => {
      setQuote(pendingQuote);
      onQuoteConsumed();
      inputRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingQuote, onQuoteConsumed]);

  async function send(question: string): Promise<void> {
    const trimmed = question.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed, quote: quote?.slice(0, 2000) || undefined }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Soru gönderilemedi");
        return;
      }
      setInput("");
      setQuote(null);
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div
        ref={listRef}
        className="min-h-[160px] flex-1 overflow-y-auto rounded-md bg-white/60 p-2 dark:bg-stone-900/40"
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
                {message.quote ? (
                  <p className="mb-1.5 border-l-2 border-stone-400 pl-2 text-[11px] italic text-stone-600 dark:border-stone-500 dark:text-stone-400">
                    “{message.quote.slice(0, 240)}
                    {message.quote.length > 240 ? "…" : ""}”
                  </p>
                ) : null}
                {message.role === "assistant" ? (
                  <div className="chat-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{message.content}</div>
                )}
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

      {quote ? (
        <div className="flex items-start gap-1.5 rounded-md border border-stone-200 bg-white/70 px-2 py-1.5 text-[11px] dark:border-stone-700 dark:bg-stone-900/50">
          <span className="min-w-0 flex-1 italic text-stone-600 dark:text-stone-400">
            “{quote.slice(0, 160)}
            {quote.length > 160 ? "…" : ""}”
          </span>
          <button
            type="button"
            onClick={() => setQuote(null)}
            aria-label="Alıntıyı kaldır"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-stone-500 hover:bg-stone-200/70 dark:hover:bg-stone-800"
          >
            <CloseIcon size={12} />
          </button>
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
        className="flex items-end gap-1.5"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder={quote ? "Bu alıntı hakkında sor…" : "Belgeyle ilgili sorunu yaz… (Enter gönderir)"}
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
    </div>
  );
}
