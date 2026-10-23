"use client";

import { useT } from "@/lib/i18n/client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const t = useT();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(t(body?.error ?? "Giriş başarısız"));
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError(t("Sunucuya ulaşılamadı"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-400">
        {t("Kullanıcı adı")}<input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          required
          autoFocus
          className="min-h-[44px] rounded-md border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:focus:border-stone-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-400">
        {t("Şifre")}<input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          className="min-h-[44px] rounded-md border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:focus:border-stone-500"
        />
      </label>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="min-h-[44px] rounded-md bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
      >
        {busy ? t("Giriş yapılıyor…") : t("Giriş yap")}
      </button>
    </form>
  );
}
