import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  isAuthConfigured,
  verifyCredentials,
  verifySessionToken,
} from "./auth";

describe("auth", () => {
  it("env yoksa oturum kapalıdır", async () => {
    const savedUser = process.env.READFLOW_AUTH_USERNAME;
    const savedPass = process.env.READFLOW_AUTH_PASSWORD;
    delete process.env.READFLOW_AUTH_USERNAME;
    delete process.env.READFLOW_AUTH_PASSWORD;
    try {
      expect(isAuthConfigured()).toBe(false);
      expect(await verifyCredentials("x", "y")).toBe(false);
    } finally {
      if (savedUser !== undefined) process.env.READFLOW_AUTH_USERNAME = savedUser;
      if (savedPass !== undefined) process.env.READFLOW_AUTH_PASSWORD = savedPass;
    }
  });

  it("doğru kimlik doğrulanır, yanlış reddedilir", async () => {
    process.env.READFLOW_AUTH_USERNAME = "mfd";
    process.env.READFLOW_AUTH_PASSWORD = "gizli-şifre";
    try {
      expect(isAuthConfigured()).toBe(true);
      expect(await verifyCredentials("mfd", "gizli-şifre")).toBe(true);
      expect(await verifyCredentials("mfd", "yanlış")).toBe(false);
      expect(await verifyCredentials("başka", "gizli-şifre")).toBe(false);
    } finally {
      delete process.env.READFLOW_AUTH_USERNAME;
      delete process.env.READFLOW_AUTH_PASSWORD;
    }
  });

  it("oturum token'ı imzalanır, doğrulanır ve süresi dolunca geçersizleşir", async () => {
    process.env.READFLOW_AUTH_USERNAME = "mfd";
    process.env.READFLOW_AUTH_PASSWORD = "gizli-şifre";
    try {
      const token = await createSessionToken("mfd");
      expect(await verifySessionToken(token)).toBe(true);
      expect(await verifySessionToken(`${token}x`)).toBe(false);
      expect(await verifySessionToken("sahte.token")).toBe(false);

      // Süresi geçmiş token
      const expired = await createSessionToken("mfd");
      const tampered = `${expired.slice(0, expired.lastIndexOf("."))}.${Buffer.from(
        "mfd|1000",
      ).toString("base64url")}.imzasiz`;
      expect(await verifySessionToken(tampered)).toBe(false);
      void expired;
    } finally {
      delete process.env.READFLOW_AUTH_USERNAME;
      delete process.env.READFLOW_AUTH_PASSWORD;
    }
  });
});
