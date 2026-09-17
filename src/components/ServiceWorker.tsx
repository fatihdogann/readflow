"use client";

import { useEffect } from "react";

/**
 * Çevrimdışı okuma için service worker kaydı. Yalnızca production'da: dev
 * sunucusunda önbellek, yeniden derlenen sayfalarla çakışır.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const register = () => void navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
