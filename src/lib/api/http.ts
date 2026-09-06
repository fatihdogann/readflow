import { InputError } from "../types";

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof InputError) {
    return Response.json({ error: error.message }, { status: 400 });
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
