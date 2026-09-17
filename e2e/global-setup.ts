import fs from "node:fs";
import path from "node:path";
import { request } from "@playwright/test";

/** Testler oturumlu koşar: bir kez giriş yapıp cookie'yi storageState'e yazar. */
export default async function globalSetup(): Promise<void> {
  const baseURL = "http://127.0.0.1:3210";
  const context = await request.newContext({ baseURL });
  const response = await context.post("/api/auth/login", {
    headers: { Origin: baseURL },
    data: { username: "e2e", password: "e2e-parola-123" },
  });
  if (!response.ok()) throw new Error(`e2e girişi başarısız: ${response.status()}`);
  const file = path.resolve(".readflow-e2e/state.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await context.storageState({ path: file });
  await context.dispose();
}
