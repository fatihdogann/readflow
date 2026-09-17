// Node-only başlangıç denetimleri ayrı dosyada: Edge derlemesine process.exit girmez.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
