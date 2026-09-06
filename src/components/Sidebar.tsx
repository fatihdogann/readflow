"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentStatusBadge } from "./AgentStatusBadge";
import { ThemeToggle } from "./ThemeToggle";
import { NAV_ITEMS } from "./nav-items";

interface FolderItem {
  id: number;
  name: string;
  document_count: number;
}

function useFolders() {
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [newFolder, setNewFolder] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  async function createFolder(event: React.FormEvent): Promise<boolean> {
    event.preventDefault();
    const name = newFolder.trim();
    if (!name) return false;
    setError(null);
    try {
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Klasör oluşturulamadı");
        return false;
      }
      setNewFolder("");
      await refreshFolders();
      return true;
    } catch {
      setError("Sunucuya ulaşılamadı");
      return false;
    }
  }

  return { folders, newFolder, setNewFolder, createFolder, refreshFolders, folderError: error };
}

function NavLinkList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Ana gezinme" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className={`flex min-h-[40px] items-center rounded-md px-2 text-sm ${
              active
                ? "bg-stone-200/80 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100"
                : "text-stone-600 hover:bg-stone-200/50 dark:text-stone-400 dark:hover:bg-stone-800/50"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function FolderSection({ onNavigate, shared }: { onNavigate?: () => void; shared: ReturnType<typeof useFolders> }) {
  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto">
      <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
        Klasörler
      </div>
      {shared.folders.map((folder) => (
        <Link
          key={folder.id}
          href={`/history?folder=${folder.id}`}
          onClick={onNavigate}
          className="flex min-h-[40px] items-center justify-between rounded-md px-2 text-sm text-stone-600 hover:bg-stone-200/50 dark:text-stone-400 dark:hover:bg-stone-800/50"
        >
          <span className="truncate">{folder.name}</span>
          <span className="ml-2 shrink-0 text-[11px] text-stone-500 dark:text-stone-400">
            {folder.document_count}
          </span>
        </Link>
      ))}
      <form
        onSubmit={async (event) => {
          const ok = await shared.createFolder(event);
          if (ok) onNavigate?.();
        }}
        className="mt-1 flex items-center gap-1 px-1"
      >
        <input
          value={shared.newFolder}
          onChange={(event) => shared.setNewFolder(event.target.value)}
          placeholder="yeni klasör…"
          aria-label="Yeni klasör adı"
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-1.5 text-xs outline-none placeholder:text-stone-500 focus:border-stone-300 focus:bg-white dark:placeholder:text-stone-500 dark:focus:border-stone-700 dark:focus:bg-stone-900"
        />
        <button
          type="submit"
          className="min-h-[36px] rounded px-1.5 text-xs text-stone-500 hover:text-stone-700 dark:hover:text-stone-200"
          title="Klasör oluştur"
        >
          ＋
        </button>
      </form>
      {shared.folderError ? <p className="px-2 text-[11px] text-red-600">{shared.folderError}</p> : null}
    </div>
  );
}

export function Sidebar() {
  const shared = useFolders();
  return (
    <aside className="no-print sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-stone-200 px-3 py-6 dark:border-stone-800 md:flex">
      <Link href="/" className="mb-6 block px-2">
        <div className="text-lg font-semibold tracking-tight">Readflow</div>
        <div className="text-[11px] text-stone-500 dark:text-stone-400">oku · düzenle · arşivle</div>
      </Link>
      <NavLinkList />
      <div className="mt-6 flex flex-col gap-0.5">
        <FolderSection shared={shared} />
      </div>
      <div className="mt-auto flex flex-col gap-0.5 border-t border-stone-200 pt-3 dark:border-stone-800">
        <AgentStatusBadge />
        <ThemeToggle />
      </div>
    </aside>
  );
}

/** Dar ekranlar için üst header + çekmece menü. */
export function MobileNav() {
  const shared = useFolders();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("a, button, input")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-stone-200 bg-[#faf9f7]/95 px-4 py-2 backdrop-blur dark:border-stone-800 dark:bg-[#171512]/95 md:hidden">
      <Link href="/" className="text-base font-semibold tracking-tight">
        Readflow
      </Link>
      <div className="flex items-center gap-1">
        <AgentStatusBadge />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-label="Menüyü aç"
          className="flex h-11 w-11 items-center justify-center rounded-md text-lg hover:bg-stone-200/60 dark:hover:bg-stone-800/60"
        >
          ☰
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Gezinme menüsü">
          <button
            type="button"
            aria-label="Menüyü kapat"
            className="absolute inset-0 bg-black/30"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            className="absolute right-0 top-0 flex h-full w-72 flex-col gap-4 overflow-y-auto border-l border-stone-200 bg-[#faf9f7] p-4 dark:border-stone-800 dark:bg-[#171512]"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Menü</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Menüyü kapat"
                className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-stone-200/60 dark:hover:bg-stone-800/60"
              >
                ×
              </button>
            </div>
            <NavLinkList onNavigate={() => setOpen(false)} />
            <FolderSection shared={shared} onNavigate={() => setOpen(false)} />
            <div className="mt-auto flex flex-col gap-0.5 border-t border-stone-200 pt-3 dark:border-stone-800">
              <ThemeToggle />
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
