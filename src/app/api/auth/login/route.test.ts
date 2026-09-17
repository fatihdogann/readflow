import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { loginThrottle } from "@/lib/authThrottle";

const login = (password: string, ip = "9.9.9.9") =>
  POST(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ username: "deneme", password }),
    }),
  );

describe("/api/auth/login", () => {
  beforeEach(() => {
    vi.stubEnv("READFLOW_AUTH_USERNAME", "deneme");
    vi.stubEnv("READFLOW_AUTH_PASSWORD", "dogru-parola-123");
    vi.stubEnv("READFLOW_SESSION_SECRET", "test-oturum-anahtari-0123456789abcd");
    loginThrottle.success("9.9.9.9");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    loginThrottle.success("9.9.9.9");
  });

  it("doğru parolada oturum çerezi verir", async () => {
    const response = await login("dogru-parola-123");
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/readflow_session=.+HttpOnly/);
  });

  it("art arda hatalı denemeden sonra 429 döner ve doğru parolayı da kabul etmez", async () => {
    for (let i = 0; i < 8; i++) expect((await login("yanlis")).status).toBe(401);
    const blocked = await login("dogru-parola-123");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();

    // Başka istemci etkilenmez
    expect((await login("dogru-parola-123", "8.8.8.8")).status).toBe(200);
  });
});
