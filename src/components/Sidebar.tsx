"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AgentStatusBadge } from "./AgentStatusBadge";
import { ThemeToggle } from "./ThemeToggle";

interface FolderItem {
  id: number;
  name: string;
  document_count: number;
}

export function Sidebar() {
  const pathname = usePathname();
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [newFolder, setNewFolder] = useState("");

  const refreshFolders = useCallback(async () => {
    try {
      const response = await fetch("/api/folders", { cache: "no-store" });
      if (response.ok) {
        const body = (await response.json()) as { folders: FolderItem[] };
        setFolders(body.folders);
      }
    } catch {
      /* yoksay */
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void refreshFolders(), 0);
    return () => clearTimeout(initial);
  }, [refreshFolders]);

  async function createFolder(event: React.FormEvent) {
    event.preventDefault();
    const name = newFolder.trim();
    if (!name) return;
    setNewFolder("");
    await fetch("/api/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await refreshFolders();
  }

  const navItem = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        className={`block rounded-md px-2 py-1.5 text-sm ${
          active
            ? "bg-stone-200/80 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100"
            : "text-stone-600 hover:bg-stone-200/50 dark:text-stone-400 dark:hover:bg-stone-800/50"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <aside className="no-print sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-stone-200 px-3 py-6 dark:border-stone-800 md:flex">
      <Link href="/" className="mb-6 block px-2">
        <div className="text-lg font-semibold tracking-tight">Readflow</div>
        <div className="text-[11px] text-stone-500 dark:text-stone-500">
          oku · düzenle · arşivle
        </div>
      </Link>

      <nav className="flex flex-col gap-0.5">
        {navItem("/", "Yeni")}
        {navItem("/history", "Geçmiş")}
        {navItem("/favorites", "Favoriler")}
      </nav>

      <div className="mt-6 flex flex-col gap-0.5 overflow-y-auto">
        <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-stone-400">
          Klasörler
        </div>
        {folders.map((folder) => (
          <Link
            key={folder.id}
            href={`/history?folder=${folder.id}`}
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-400 dark:hover:bg-stone-800/50"
          >
            <span className="truncate">{folder.name}</span>
            <span className="ml-2 shrink-0 text-[11px] text-stone-400">
              {folder.document_count}
            </span>
          </Link>
        ))}
        <form onSubmit={createFolder} className="mt-1 flex items-center gap-1 px-1">
          <input
            value={newFolder}
            onChange={(event) => setNewFolder(event.target.value)}
            placeholder="yeni klasör…"
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-1 text-xs outline-none placeholder:text-stone-400 focus:border-stone-300 focus:bg-white dark:focus:border-stone-700 dark:focus:bg-stone-900"
          />
          <button
            type="submit"
            className="rounded px-1.5 py-1 text-xs text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
            title="Klasör oluştur"
          >
            ＋
          </button>
        </form>
      </div>

      <div className="mt-auto flex flex-col gap-0.5 border-t border-stone-200 pt-3 dark:border-stone-800">
        <AgentStatusBadge />
        <ThemeToggle />
      </div>
    </aside>
  );
}
