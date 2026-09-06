import { describe, expect, it } from "vitest";
import { formatAuthorByline } from "./author";

describe("formatAuthorByline", () => {
  it("HTML çıkarımında birleşen çoklu yazar adlarını okunabilir ayırır", () => {
    expect(
      formatAuthorByline("Ali Arda DalseçkinMuhammed Hamza KayrıcıSüreyya Güder Köşgeroğlu"),
    ).toBe("Ali Arda Dalseçkin, Muhammed Hamza Kayrıcı, Süreyya Güder Köşgeroğlu");
  });

  it("zaten ayrılmış yazar satırını değiştirmez", () => {
    expect(formatAuthorByline("Ayşe Yılmaz, Mehmet Demir")).toBe("Ayşe Yılmaz, Mehmet Demir");
  });
});
