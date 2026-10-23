import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import "./globals.css";
import { MobileNav, Sidebar } from "@/components/Sidebar";
import { ServiceWorker } from "@/components/ServiceWorker";
import { LanguageProvider } from "@/lib/i18n/client";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getLocale());
  return {
  title: "Readflow",
  description: t("Local-first kişisel okuma ve metin işleme alanı"),
  applicationName: "Readflow",
  // Ana ekrana eklenince tam ekran açılsın, başlık "Readflow" görünsün.
  appleWebApp: { capable: true, title: "Readflow", statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#171512" },
  ],
  // Ana ekran uygulamasında çentik altı alan da boyansın.
  viewportFit: "cover",
};

const themeInit = `
try {
  var t = localStorage.getItem("readflow-theme");
  if (t === "dark" || (!t && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.classList.add("dark");
  }
} catch (e) {}
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = translator(locale);
  // CSP nonce proxy.ts'te üretilir; satır içi tema script'i bununla çalışır.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-screen bg-[#faf9f7] text-stone-900 antialiased dark:bg-[#171512] dark:text-stone-200">
        <LanguageProvider locale={locale}>
        {/* Tema başlangıcı: hydrate öncesi çalışır, parlaklık sıçramasını önler */}
        <Script id="theme-init" strategy="beforeInteractive" nonce={nonce}>{themeInit}</Script>
        <ServiceWorker />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-stone-900 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
        >
          {t("İçeriğe atla")}
        </a>
        <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col md:flex-row">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileNav />
            <main id="main-content" className="app-content min-w-0 flex-1 px-4 pt-5 md:px-8 md:py-8 lg:px-10">
              {children}
            </main>
          </div>
        </div>
        </LanguageProvider>
      </body>
    </html>
  );
}
