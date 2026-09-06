import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { MobileNav, Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Readflow",
  description: "Local-first kişisel okuma ve metin işleme alanı",
};

const themeInit = `
try {
  var t = localStorage.getItem("readflow-theme");
  if (t === "dark" || (!t && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.classList.add("dark");
  }
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <body className="min-h-screen bg-[#faf9f7] text-stone-900 antialiased dark:bg-[#171512] dark:text-stone-200">
        {/* Tema başlangıcı: hydrate öncesi çalışır, parlaklık sıçramasını önler */}
        <Script id="theme-init" strategy="beforeInteractive">{themeInit}</Script>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-stone-900 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
        >
          İçeriğe atla
        </a>
        <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col md:flex-row">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileNav />
            <main id="main-content" className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
