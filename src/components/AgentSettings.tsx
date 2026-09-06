"use client";

import { useCallback, useEffect, useState } from "react";
import { mutateJson } from "@/lib/client/api";
import { LockIcon } from "@/components/Icons";

interface CliCapabilities {
  cli: string;
  found: boolean;
  version: string | null;
  nonInteractive: boolean;
  modelFlag: boolean;
  providerFlag: boolean;
  sandboxReadonlyFlag: boolean;
  argvRequired: boolean;
  modelOptions: string[] | null;
  notes: string[];
}

interface Profile {
  id: number;
  name: string;
  cli: string;
  model: string | null;
  provider: string | null;
  transport: "stdin" | "argv";
  timeout_ms: number;
  enabled: 0 | 1;
  config_revision: number;
  last_validated_at: string | null;
  last_validation_ok: 0 | 1 | null;
  last_error: string | null;
}

interface ProfilesResponse {
  envLock: { locked: boolean; reason: string | null; description: string };
  candidates: CliCapabilities[];
  profiles: Profile[];
  defaultProfileId: number | null;
}

const labelClass = "flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-400";
const inputClass =
  "min-h-[40px] rounded-md border border-stone-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:focus:border-stone-500";

export function AgentSettings() {
  const [data, setData] = useState<ProfilesResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: "",
    cli: "claude",
    model: "",
    provider: "",
    transport: "stdin",
    timeoutMs: "120000",
  });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/profiles", { cache: "no-store" });
      if (response.ok) {
        setData((await response.json()) as ProfilesResponse);
        setError(null);
      } else {
        setError(`Profiller yüklenemedi (HTTP ${response.status})`);
      }
    } catch {
      setError("Sunucuya ulaşılamadı");
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    return () => clearTimeout(initial);
  }, [load]);

  async function createProfile(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await mutateJson("/api/agent/profiles", "POST", {
        name: form.name.trim(),
        cli: form.cli,
        model: form.model.trim() || null,
        provider: form.provider.trim() || null,
        transport: form.cli === "jcode" ? "argv" : form.transport,
        timeoutMs: Number(form.timeoutMs) || undefined,
      });
      setForm((prev) => ({ ...prev, name: "", model: "", provider: "" }));
      setNotice("Profil oluşturuldu.");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Profil oluşturulamadı");
    }
  }

  async function setDefault(profileId: number | null): Promise<void> {
    setError(null);
    try {
      await mutateJson("/api/agent/default-profile", "PUT", { profileId });
      await load();
      setNotice(profileId ? "Varsayılan profil güncellendi (yeniden başlatma gerekmez)." : "Varsayılan profil kaldırıldı.");
    } catch (defaultError) {
      setError(defaultError instanceof Error ? defaultError.message : "Kaydedilemedi");
    }
  }

  async function toggleEnabled(profile: Profile): Promise<void> {
    setError(null);
    try {
      await mutateJson(`/api/agent/profiles/${profile.id}`, "PATCH", { enabled: profile.enabled === 0 });
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Güncellenemedi");
    }
  }

  async function remove(profile: Profile): Promise<void> {
    if (!window.confirm(`"${profile.name}" profili silinsin mi? Eski işler kendi kayıtlı yapılandırmasıyla çalışmayı sürdürür.`)) return;
    setError(null);
    try {
      await mutateJson(`/api/agent/profiles/${profile.id}`, "DELETE");
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Silinemedi");
    }
  }

  async function validate(profile: Profile): Promise<void> {
    setValidating(profile.id);
    setError(null);
    setNotice(null);
    try {
      const body = await mutateJson<{ ok: boolean; message: string }>(
        `/api/agent/profiles/${profile.id}/validate`,
        "POST",
      );
      setNotice(body.message);
      await load();
    } catch (validateError) {
      setError(validateError instanceof Error ? validateError.message : "Doğrulama çağrılamadı");
    } finally {
      setValidating(null);
    }
  }

  if (!data) {
    return <p className="text-sm text-stone-500 dark:text-stone-400">{error ?? "Yükleniyor…"}</p>;
  }

  return (
    <div className="flex flex-col gap-10">
      {data.envLock.locked ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" role="note">
          <strong className="inline-flex items-center gap-1.5"><LockIcon size={15} /> Environment tarafından yönetiliyor.</strong> {data.envLock.description}. Bu
          ekrandan profil/varsayılan seçimi şu anda etkisizdir; kilidi açmak için ortam
          değişkenlerini (.env.local) kaldırın.
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" aria-live="polite" className="text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      ) : null}

      <section aria-labelledby="cli-status">
        <h2 id="cli-status" className="mb-2 text-sm font-semibold">
          Kurulu CLI&apos;lar ve yetenekler
        </h2>
        <p className="mb-3 text-xs text-stone-500 dark:text-stone-400">
          &quot;Bulundu&quot; yalnızca CLI&apos;ın kurulu olduğu anlamına gelir; gerçek çalışma doğrulaması
          profil satırındaki <strong>Bağlantıyı doğrula</strong> ile yapılır.
        </p>
        <ul className="grid gap-3 md:grid-cols-3">
          {data.candidates.map((candidate) => (
            <li key={candidate.cli} className="rounded-2xl border border-stone-200 bg-white/65 p-4 text-xs shadow-[0_10px_28px_rgba(28,25,23,0.04)] dark:border-stone-800 dark:bg-stone-900/35 dark:shadow-none">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold capitalize">{candidate.cli}</span>
                {candidate.found ? (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                    bulundu{candidate.version ? ` · ${candidate.version}` : ""}
                  </span>
                ) : (
                  <span className="rounded bg-white px-1.5 py-0.5 font-medium text-stone-600 ring-1 ring-stone-200 dark:bg-stone-900 dark:text-stone-400 dark:ring-stone-700">
                    kurulu değil
                  </span>
                )}
                {candidate.nonInteractive ? (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                    non-interactive ✓
                  </span>
                ) : (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                    non-interactive doğrulanamadı
                  </span>
                )}
                {candidate.modelFlag ? <span className="text-stone-500 dark:text-stone-400">--model ✓</span> : null}
                {candidate.providerFlag ? <span className="text-stone-500 dark:text-stone-400">--provider ✓</span> : null}
                {candidate.sandboxReadonlyFlag ? <span className="text-stone-500 dark:text-stone-400">read-only sandbox ✓</span> : null}
                {candidate.argvRequired ? <span className="text-stone-500 dark:text-stone-400">prompt=argv (zorunlu)</span> : null}
                {candidate.modelOptions ? (
                  <span className="text-stone-500 dark:text-stone-400">model kataloğu: {candidate.modelOptions.length} model</span>
                ) : null}
              </div>
              {candidate.notes.length > 0 ? (
                <p className="mt-3 border-t border-stone-200 pt-2 text-[11px] leading-relaxed text-stone-500 dark:border-stone-800 dark:text-stone-400">{candidate.notes.join(" · ")}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="profiles">
        <h2 id="profiles" className="mb-2 text-sm font-semibold">
          Profiller
        </h2>
        {data.profiles.length === 0 ? (
          <p className="text-xs text-stone-500 dark:text-stone-400">Henüz profil yok — aşağıdan oluştur.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.profiles.map((profile) => (
              <li key={profile.id} className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white/70 p-4 shadow-[0_12px_34px_rgba(28,25,23,0.045)] dark:border-stone-800 dark:bg-stone-900/35 dark:shadow-none">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-sm font-semibold">{profile.name}</span>
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                    {profile.cli}
                  </span>
                  {profile.model ? <span className="text-stone-500 dark:text-stone-400">model: {profile.model}</span> : null}
                  {profile.provider ? <span className="text-stone-500 dark:text-stone-400">provider: {profile.provider}</span> : null}
                  <span className="text-stone-500 dark:text-stone-400">transport: {profile.transport}</span>
                  <span className="text-stone-500 dark:text-stone-400">rev: {profile.config_revision}</span>
                  {data.defaultProfileId === profile.id ? (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                      varsayılan
                    </span>
                  ) : null}
                  {profile.last_validated_at ? (
                    <span className={profile.last_validation_ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                      {profile.last_validation_ok ? "son doğrulama: başarılı" : "son doğrulama: başarısız"}
                      {profile.last_error ? ` — ${profile.last_error.slice(0, 80)}` : ""}
                    </span>
                  ) : (
                    <span className="text-stone-500 dark:text-stone-400">henüz doğrulanmadı</span>
                  )}
                </div>
                {data.defaultProfileId === profile.id && !profile.last_validated_at ? (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/35 dark:text-amber-300">
                    Bu varsayılan profil henüz doğrulanmadı. İlk işten önce bağlantıyı doğrulaman önerilir.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void validate(profile)}
                    disabled={validating === profile.id}
                    className="min-h-[36px] rounded-md border border-stone-300 px-3 text-xs hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:hover:bg-stone-800"
                  >
                    {validating === profile.id ? "Doğrulanıyor…" : "Bağlantıyı doğrula"}
                  </button>
                  {data.defaultProfileId !== profile.id ? (
                    <button
                      type="button"
                      onClick={() => void setDefault(profile.id)}
                      disabled={profile.enabled === 0}
                      className="min-h-[36px] rounded-md border border-stone-300 px-3 text-xs hover:bg-stone-100 disabled:opacity-40 dark:border-stone-700 dark:hover:bg-stone-800"
                    >
                      Varsayılan yap
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void setDefault(null)}
                      className="min-h-[36px] rounded-md border border-stone-300 px-3 text-xs hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
                    >
                      Varsayılanı kaldır
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void toggleEnabled(profile)}
                    className="min-h-[36px] rounded-md border border-stone-300 px-3 text-xs hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
                  >
                    {profile.enabled ? "Devre dışı bırak" : "Etkinleştir"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(profile)}
                    className="min-h-[36px] rounded-md px-3 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                  >
                    Sil
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="new-profile">
        <h2 id="new-profile" className="mb-2 text-sm font-semibold">
          Yeni profil
        </h2>
        <form onSubmit={createProfile} className="grid grid-cols-1 gap-4 rounded-2xl border border-stone-200 bg-white/70 p-4 shadow-[0_12px_34px_rgba(28,25,23,0.045)] dark:border-stone-800 dark:bg-stone-900/35 dark:shadow-none sm:grid-cols-2 sm:p-5">
          <label className={labelClass}>
            Görünen ad
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              required
              maxLength={80}
              placeholder="ör. Codex okuma"
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            CLI
            <select
              value={form.cli}
              onChange={(event) => setForm((prev) => ({ ...prev, cli: event.target.value }))}
              className={inputClass}
            >
              {data.candidates.map((candidate) => (
                <option key={candidate.cli} value={candidate.cli} disabled={!candidate.found}>
                  {candidate.cli}
                  {candidate.found ? "" : " (kurulu değil)"}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Model / profil kimliği
            {(() => {
              const caps = data.candidates.find((candidate) => candidate.cli === form.cli);
              if (caps?.modelOptions && caps.modelOptions.length > 0) {                return (
                  <select
                    value={form.model}
                    onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
                    className={inputClass}
                  >
                    <option value="">Seç…</option>
                    {caps.modelOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                );
              }
              if (caps?.modelFlag) {
                return (
                  <input
                    value={form.model}
                    onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
                    maxLength={160}
                    placeholder="model kimliği"
                    className={inputClass}
                  />
                );
              }
              return (
                <span className="text-[11px] text-stone-500 dark:text-stone-400">
                  Bu CLI&apos;ın help çıktısında model bayrağı doğrulanmadı — alan devre dışı
                </span>
              );
            })()}
          </label>
          {form.cli === "jcode" ? (
            <label className={labelClass}>
              Provider
              <input
                value={form.provider}
                onChange={(event) => setForm((prev) => ({ ...prev, provider: event.target.value }))}
                maxLength={120}
                placeholder="ör. claude"
                className={inputClass}
              />
            </label>
          ) : null}
          <label className={labelClass}>
            Prompt aktarımı
            <select
              value={form.cli === "jcode" ? "argv" : form.transport}
              onChange={(event) => setForm((prev) => ({ ...prev, transport: event.target.value }))}
              disabled={form.cli === "jcode"}
              className={inputClass}
            >
              <option value="stdin">stdin (önerilen)</option>
              <option value="argv">argv</option>
            </select>
            {form.cli === "jcode" ? (
              <span className="text-[11px] text-stone-500 dark:text-stone-400">
                jcode mesajı argüman olarak ister — argv zorunlu.
              </span>
            ) : null}
          </label>
          <label className={labelClass}>
            Zaman aşımı (ms)
            <input
              type="number"
              min={5000}
              max={600000}
              step={1000}
              value={form.timeoutMs}
              onChange={(event) => setForm((prev) => ({ ...prev, timeoutMs: event.target.value }))}
              className={inputClass}
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={data.envLock.locked}
              className="min-h-[40px] rounded-md bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
            >
              Profil oluştur
            </button>
            {form.cli === "codex" ? (
              <span className="ml-3 text-[11px] text-stone-500 dark:text-stone-400">
                Not: codex salt-okunur sandbox ile çalıştırılır; prompt stdin&apos;den verilir.
              </span>
            ) : null}
          </div>
        </form>
      </section>

      <TelegramSection />
    </div>
  );
}

interface TelegramStatus {
  status: "kurulmadı" | "yapılandırıldı" | "doğrulandı" | "hata";
  configured: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean;
  lastTestMessage: string | null;
  missing: string[];
}

function TelegramSection() {
  const [info, setInfo] = useState<TelegramStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/export/telegram-status", { cache: "no-store" });
      if (response.ok) setInfo((await response.json()) as TelegramStatus);
    } catch {
      /* yoksay */
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    return () => clearTimeout(initial);
  }, [load]);

  async function sendTest(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const body = await mutateJson<{ ok: boolean; message: string }>(
        "/api/export/telegram-status",
        "POST",
      );
      setMessage(body.message);
      await load();
    } catch (testError) {
      setMessage(testError instanceof Error ? testError.message : "Test gönderilemedi");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const statusColor =
    info?.status === "doğrulandı"
      ? "bg-emerald-600"
      : info?.status === "hata"
        ? "bg-red-500"
        : info?.status === "yapılandırıldı"
          ? "bg-amber-500"
          : "bg-stone-400";

  return (
    <section aria-labelledby="telegram-setup" className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
      <h2 id="telegram-setup" className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className={`h-2 w-2 rounded-full ${statusColor}`} aria-hidden />
        Telegram
        <span className="text-xs font-normal text-stone-500 dark:text-stone-400">
          durum: {info?.status ?? "yükleniyor…"}
        </span>
      </h2>

      {!info?.configured ? (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Kurulmadı. Gerekli ortam değişkenleri:{" "}
          <code>
            {info?.missing.join(", ") || "READFLOW_TELEGRAM_BOT_TOKEN, READFLOW_TELEGRAM_CHAT_ID"}
          </code>{" "}
          (Coolify environment / .env.local — token arayüze veya Git&apos;e girmez).
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void sendTest()}
            disabled={busy}
            className="min-h-[40px] rounded-md bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            {busy ? "Gönderiliyor…" : "Test mesajı gönder"}
          </button>
          <span className="text-xs text-stone-500 dark:text-stone-400" role="status" aria-live="polite">
            {message ??
              (info.lastTestAt
                ? `son test: ${info.lastTestAt.slice(0, 16).replace("T", " ")} — ${info.lastTestOk ? "başarılı" : `başarısız: ${info.lastTestMessage ?? ""}`}`
                : "henüz test edilmedi — env mevcut olması çalışıyor anlamına gelmez")}
          </span>
        </div>
      )}

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setGuideOpen((value) => !value)}
          aria-expanded={guideOpen}
          className="min-h-[36px] text-xs text-stone-600 underline underline-offset-2 dark:text-stone-400"
        >
          Kurulum rehberi
        </button>
        {guideOpen ? (
          <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-xs leading-relaxed text-stone-600 dark:text-stone-400">
            <li>
              Telegram&apos;da <strong>@BotFather</strong> ile <code>/newbot</code> ile bot oluştur;
              verilen token&apos;i <code>READFLOW_TELEGRAM_BOT_TOKEN</code> olarak ortama ekle.
            </li>
            <li>
              Yeni botunla <strong>/start</strong> gönder (bot sana yazmadan mesaj atamaz).
            </li>
            <li>
              Tarayıcıda <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> aç;
              yanıttaki <code>message.chat.id</code> değerini{" "}
              <code>READFLOW_TELEGRAM_CHAT_ID</code> olarak ekle.
            </li>
            <li>
              Web sürecini yeniden başlat, sonra <strong>Test mesajı gönder</strong>&apos;e bas.
            </li>
            <li>
              Not: Bot&apos;ta webhook kuruluysa <code>getUpdates</code> çalışmaz; Readflow
              webhook&apos;u silmez — kendi kurulumunda bilinçli yönet.
            </li>
          </ol>
        ) : null}
      </div>
    </section>
  );
}
