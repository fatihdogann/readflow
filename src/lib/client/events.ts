export const FOLDERS_CHANGED_EVENT = "readflow:folders-changed";

/** Layout içindeki sidebar yeniden mount olmadan klasör sayaçlarını tazeler. */
export function notifyFoldersChanged(): void {
  window.dispatchEvent(new Event(FOLDERS_CHANGED_EVENT));
}
