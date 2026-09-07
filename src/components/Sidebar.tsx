"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentStatusBadge } from "./AgentStatusBadge";
import { ThemeToggle } from "./ThemeToggle";
import { NAV_ITEMS } from "./nav-items";
import { AddDocumentIcon, CloseIcon, FolderIcon, HeartIcon, HighlightIcon, HistoryIcon, MenuIcon, PlusIcon, SettingsIcon } from "./Icons";
import { FOLDERS_CHANGED_EVENT, notifyFoldersChanged } from "@/lib/client/events";

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
    const onFoldersChanged = () => void refreshFolders();
    window.addEventListener(FOLDERS_CHANGED_EVENT, onFoldersChanged);
    return () => {
      clearTimeout(initial);
      window.removeEventListener(FOLDERS_CHANGED_EVENT, onFoldersChanged);
    };
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
      notifyFoldersChanged();
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
  const icons = {
    "/": AddDocumentIcon,
    "/history": HistoryIcon,
    "/favorites": HeartIcon,
    "/highlights": HighlightIcon,
    "/settings": SettingsIcon,
  } as const;
  return (
    <nav aria-label="Ana gezinme" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href;
        const NavIcon = icons[item.href as keyof typeof icons];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className={`flex min-h-[42px] items-center gap-3 rounded-xl px-3 text-sm transition ${
              active
                ? "bg-white font-medium text-stone-950 shadow-[0_5px_18px_rgba(28,25,23,0.07)] ring-1 ring-stone-200/70 dark:bg-stone-800 dark:text-stone-50 dark:shadow-none dark:ring-stone-700"
                : "text-stone-600 hover:bg-stone-200/55 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-800/60 dark:hover:text-stone-100"
            }`}
          >
            {NavIcon ? <NavIcon size={17} /> : null}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function FolderSection({ onNavigate, shared }: { onNavigate?: () => void; shared: ReturnType<typeof useFolders> }) {
  return (
    <div className="flex flex-col gap-1 overflow-y-auto">
      <div className="mb-1 px-3 text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500 dark:text-stone-400">
        Klasörler
      </div>
      {shared.folders.map((folder) => (
        <Link
          key={folder.id}
          href={`/history?folder=${folder.id}`}
          onClick={onNavigate}
          className="flex min-h-[40px] items-center gap-2.5 rounded-xl px-3 text-sm text-stone-600 transition hover:bg-stone-200/55 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-800/60 dark:hover:text-stone-100"
        >
          <FolderIcon size={15} className="shrink-0 text-stone-400" />
          <span className="truncate">{folder.name}</span>
          <span className="ml-auto min-w-5 shrink-0 rounded-full bg-stone-200/80 px-1.5 py-0.5 text-center text-[10px] tabular-nums text-stone-600 dark:bg-stone-800 dark:text-stone-400">
            {folder.document_count}
          </span>
        </Link>
      ))}
      <form
        onSubmit={async (event) => {
          const ok = await shared.createFolder(event);
          if (ok) onNavigate?.();
        }}
        className="mt-1 flex items-center gap-1 px-2"
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
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-200/60 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          title="Klasör oluştur"
        >
          <PlusIcon size={16} />
        </button>
      </form>
      {shared.folderError ? <p className="px-2 text-[11px] text-red-600">{shared.folderError}</p> : null}
    </div>
  );
}

export function Sidebar() {
  const shared = useFolders();
  return (
    <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-stone-200 bg-stone-100/35 px-3 py-5 dark:border-stone-800 dark:bg-stone-950/15 md:flex">
      <Link href="/" className="mb-7 flex items-center gap-3 rounded-xl px-2 py-1.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-stone-900 font-serif text-sm font-semibold text-white shadow-[0_6px_18px_rgba(28,25,23,0.18)] dark:bg-stone-100 dark:text-stone-900 dark:shadow-none">R</span>
        <span>
          <span className="block text-lg font-semibold tracking-[-0.025em]">Readflow</span>
          <span className="block text-[11px] text-stone-500 dark:text-stone-400">oku · düzenle · arşivle</span>
        </span>
      </Link>
      <NavLinkList />
      <div className="mt-7 flex flex-col gap-0.5">
        <FolderSection shared={shared} />
      </div>
      <div className="mt-auto flex flex-col gap-0.5 border-t border-stone-200 pt-3 dark:border-stone-800">
        <AgentStatusBadge />
        <ThemeToggle />
        <LogoutButton />
      </div>
    </aside>
  );
}

function LogoutButton() {
  const [enabled, setEnabled] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const initial = setTimeout(async () => {
      try {
        const response = await fetch("/api/auth/status", { cache: "no-store" });
        if (response.ok) {
          const body = (await response.json()) as { authEnabled: boolean };
          setEnabled(body.authEnabled);
        }
      } catch {
        /* yoksay */
      }
    }, 0);
    return () => clearTimeout(initial);
  }, []);
  if (!enabled) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
      }}
      className="flex min-h-[40px] items-center gap-2 rounded-md px-2 text-left text-xs text-stone-600 hover:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800/60"
    >
      Çıkış yap
    </button>
  );
}

/** Dar ekranlar için üst header + çekmece menü. */
export function MobileNav() {
  const shared = useFolders();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("a, button, input")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open]);

  return (
    <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-stone-200 bg-[#faf9f7]/95 px-4 py-2.5 backdrop-blur dark:border-stone-800 dark:bg-[#171512]/95 md:hidden">
      <Link href="/" className="flex items-center gap-2.5 text-base font-semibold tracking-tight">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-stone-900 font-serif text-xs text-white dark:bg-stone-100 dark:text-stone-900">R</span>
        Readflow
      </Link>
      <div className="flex items-center gap-1">
        <AgentStatusBadge />
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-label="Menüyü aç"
          className="flex h-11 w-11 items-center justify-center rounded-md text-lg hover:bg-stone-200/60 dark:hover:bg-stone-800/60"
        >
          <MenuIcon size={20} />
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
                <CloseIcon size={20} />
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
