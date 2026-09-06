import { describe, expect, it } from "vitest";
import { createLatestDraftSaver, type DraftSaveState } from "./latestDraftSaver";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("createLatestDraftSaver", () => {
  it("kayıt sürerken gelen en yeni taslağı ilk isteğin ardından ayrıca kaydeder", async () => {
    const first = deferred();
    const persisted: string[] = [];
    const states: DraftSaveState<string>[] = [];
    const saver = createLatestDraftSaver<string>(
      async (value) => {
        persisted.push(value);
        if (persisted.length === 1) await first.promise;
      },
      (state) => states.push(state),
    );

    const draining = saver.save("ilk");
    void saver.save("arada");
    void saver.save("en yeni");
    expect(persisted).toEqual(["ilk"]);

    first.resolve();
    await draining;

    expect(persisted).toEqual(["ilk", "en yeni"]);
    expect(states.at(-1)).toMatchObject({ phase: "saved", value: "en yeni" });
  });

  it("hata veren son taslağı kaydedilmiş saymaz ve yeniden denenmesine izin verir", async () => {
    let fail = true;
    const persisted: string[] = [];
    const states: DraftSaveState<string>[] = [];
    const saver = createLatestDraftSaver<string>(
      async (value) => {
        persisted.push(value);
        if (fail) throw new Error("disk kapalı");
      },
      (state) => states.push(state),
    );

    await saver.save("taslak");
    expect(states.at(-1)?.phase).toBe("error");

    fail = false;
    await saver.save("taslak");
    expect(persisted).toEqual(["taslak", "taslak"]);
    expect(states.at(-1)).toMatchObject({ phase: "saved", value: "taslak" });
  });
});
