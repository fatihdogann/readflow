"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const initial = setTimeout(() => {
      setDark(document.documentElement.classList.contains("dark"));
    }, 0);
    return () => clearTimeout(initial);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("readflow-theme", next ? "dark" : "light");
    } catch {
      /* localStorage kapı olabilir */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-stone-600 hover:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800/60"
      title="Açık / koyu tema"
    >
      <span aria-hidden>{dark ? "☾" : "☀"}</span>
      <span>{dark ? "Koyu tema" : "Açık tema"}</span>
    </button>
  );
}
