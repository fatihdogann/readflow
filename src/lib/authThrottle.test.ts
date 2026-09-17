import { describe, expect, it } from "vitest";
import { createLoginThrottle } from "./authThrottle";

describe("giriş denemesi sınırı", () => {
  it("art arda hatalı denemeden sonra kilitler, süre dolunca açar", () => {
    let now = 1_000_000;
    const throttle = createLoginThrottle({ limit: 5, windowMs: 60_000, now: () => now });

    for (let i = 0; i < 5; i++) {
      expect(throttle.check("1.2.3.4").blocked).toBe(false);
      throttle.fail("1.2.3.4");
    }
    const blocked = throttle.check("1.2.3.4");
    expect(blocked.blocked).toBe(true);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // Başka bir istemci etkilenmez
    expect(throttle.check("5.6.7.8").blocked).toBe(false);

    now += 60_001;
    expect(throttle.check("1.2.3.4").blocked).toBe(false);
  });

  it("başarılı girişte sayaç sıfırlanır", () => {
    const throttle = createLoginThrottle({ limit: 3, windowMs: 60_000 });
    throttle.fail("ip");
    throttle.fail("ip");
    throttle.success("ip");
    throttle.fail("ip");
    expect(throttle.check("ip").blocked).toBe(false);
  });

  it("bellekte sınırsız büyümez: süresi geçen kayıtlar temizlenir", () => {
    let now = 0;
    const throttle = createLoginThrottle({ limit: 3, windowMs: 1000, now: () => now });
    for (let i = 0; i < 500; i++) {
      throttle.fail(`ip-${i}`);
      now += 10;
    }
    expect(throttle.size()).toBeLessThan(200);
  });
});
