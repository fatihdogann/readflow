/**
 * Tek kullanıcı oturumu: READFLOW_AUTH_USERNAME + READFLOW_AUTH_PASSWORD
 * tanımlıysa site kilitli olur; tanımlı değilse (yerel kullanım) açık çalışır.
 * Oturum: HMAC-SHA256 imzalı cookie (Web Crypto — middleware/edge uyumlu).
 * Secret'lar yalnız environment'tan okunur; kod/örnekte literal yoktur.
 */

const SESSION_COOKIE = "readflow_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 gün

export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.READFLOW_AUTH_USERNAME?.trim() && process.env.READFLOW_AUTH_PASSWORD?.trim(),
  );
}

async function sha256(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  const expectedUser = process.env.READFLOW_AUTH_USERNAME?.trim() ?? "";
  const expectedPass = process.env.READFLOW_AUTH_PASSWORD ?? "";
  if (!expectedUser || !expectedPass) return false;
  const userHash = await sha256(username.trim());
  const passHash = await sha256(password);
  const [expectedUserHash, expectedPassHash] = await Promise.all([
    sha256(expectedUser),
    sha256(expectedPass),
  ]);
  return bytesEqual(userHash, expectedUserHash) && bytesEqual(passHash, expectedPassHash);
}

function sessionSecret(): string {
  // Oturum imza anahtarı: ayrı secret verilmişse o; yoksa paroladan türetilir.
  return process.env.READFLOW_SESSION_SECRET?.trim() || `pw:${process.env.READFLOW_AUTH_PASSWORD ?? ""}`;
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Buffer.from(signature).toString("base64url");
}

export async function createSessionToken(username: string): Promise<string> {
  const payload = `${username}|${Date.now() + SESSION_TTL_MS}`;
  const signature = await hmac(payload);
  return `${Buffer.from(payload).toString("base64url")}.${signature}`;
}

export async function verifySessionToken(token: string): Promise<boolean> {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;
  let payload: string;
  try {
    payload = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return false;
  }
  const expectedSig = await hmac(payload);
  const providedSig = token.slice(dot + 1);
  if (!(bytesEqual(await sha256(expectedSig), await sha256(providedSig)))) return false;
  const pipe = payload.lastIndexOf("|");
  if (pipe === -1) return false;
  const expiry = Number(payload.slice(pipe + 1));
  return Number.isFinite(expiry) && expiry > Date.now();
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

export function sessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}
