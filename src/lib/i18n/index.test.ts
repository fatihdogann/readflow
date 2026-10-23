import { describe, expect, it } from "vitest";
import english from "./en.json";
import { parseLocale, translator } from "./index";

describe("interface language", () => {
  it("accepts English explicitly and falls back safely to Turkish", () => {
    expect(parseLocale("en")).toBe("en");
    for (const value of [undefined, null, "", "fr", "<script>"]) {
      expect(parseLocale(value)).toBe("tr");
    }
  });
  it("translates interface text without changing unknown content", () => {
    expect(translator("tr")("Ayarlar")).toBe("Ayarlar");
    expect(translator("en")("Ayarlar")).toBe("Settings");
    for (const value of ["My document title", "constructor", "toString"]) {
      expect(translator("en")(value)).toBe(value);
    }
  });
  it("preserves all interpolation slots and inserts values literally", () => {
    for (const [source, translation] of Object.entries(english)) {
      const slots = (value: string) => value.match(/\{\d+\}/g)?.sort() ?? [];
      expect(slots(translation), source).toEqual(slots(source));
    }
    expect(translator("en")("{0} klasörünü sil", "$&")).toBe("Delete folder $&");
    expect(translator("tr")("{0} doküman", 3)).toBe("3 doküman");
  });
});
