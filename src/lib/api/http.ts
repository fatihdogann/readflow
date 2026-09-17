import { ZodError } from "zod";
import { InputError } from "../types";

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof InputError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  // İstek gövdesi şemaya uymadı: istemci hatası, sunucu hatası değil.
  if (error instanceof ZodError) {
    return Response.json({ error: error.issues[0]?.message ?? "Geçersiz istek" }, { status: 400 });
  }
  console.error("[api] beklenmeyen hata:", error);
  const message = error instanceof Error ? error.message : "Bilinmeyen hata";
  return Response.json({ error: `Beklenmeyen hata: ${message}` }, { status: 500 });
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new InputError("Geçersiz JSON gövdesi");
  }
}
