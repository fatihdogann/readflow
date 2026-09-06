"use client";

export interface ApiError extends Error {
  status: number;
  body: unknown;
}

/** Ortak JSON mutasyon yardımcı: hata mesajını ve durum kodunu koruyarak fırlatır. */
export async function mutateJson<T>(
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const wrapped = new Error("Sunucuya ulaşılamadı — taslağın korundu") as ApiError;
    wrapped.status = 0;
    wrapped.body = null;
    throw wrapped;
  }
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `İstek başarısız (HTTP ${response.status})`;
    const wrapped = new Error(message) as ApiError;
    wrapped.status = response.status;
    wrapped.body = parsed;
    throw wrapped;
  }
  return parsed as T;
}
