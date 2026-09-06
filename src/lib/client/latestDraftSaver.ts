export type DraftSaveState<T> =
  | { phase: "saving"; value: T }
  | { phase: "saved"; value: T }
  | { phase: "error"; value: T; error: unknown };

/**
 * Aynı taslak için paralel istek açmaz. Kayıt sürerken yeni değerler gelirse
 * yalnızca en güncelini saklar ve aktif isteğin hemen ardından kaydeder.
 */
export function createLatestDraftSaver<T>(
  persist: (value: T) => Promise<void>,
  onState: (state: DraftSaveState<T>) => void,
): { save: (value: T) => Promise<void> } {
  let queued: { value: T } | null = null;
  let running: Promise<void> | null = null;

  async function drain(): Promise<void> {
    while (queued) {
      const current = queued;
      queued = null;
      onState({ phase: "saving", value: current.value });
      try {
        await persist(current.value);
      } catch (error) {
        onState({ phase: "error", value: current.value, error });
        queued = null;
        return;
      }
      if (!queued) onState({ phase: "saved", value: current.value });
    }
  }

  return {
    save(value: T): Promise<void> {
      queued = { value };
      if (!running) {
        running = drain().finally(() => {
          running = null;
        });
      }
      return running;
    },
  };
}
