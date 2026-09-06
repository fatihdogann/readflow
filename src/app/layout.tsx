import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

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
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-screen bg-[#faf9f7] text-stone-900 antialiased dark:bg-[#171512] dark:text-stone-200">
        <div className="mx-auto flex min-h-screen w-full max-w-6xl">
          <Sidebar />
          <main className="min-w-0 flex-1 px-5 py-8 md:px-10 md:py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
