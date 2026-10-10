"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { playThemeReveal } from "@/components/themeReveal";

const STORAGE_KEY = "ocos-theme";

type Appearance = "light" | "dark";

function readTheme(): Appearance {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // Private browsing can block storage. Light mode still applies.
  }
  return "light";
}

function applyTheme(theme: Appearance) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The choice still applies for this visit.
  }
}

export function ThemeToggle() {
  const pathname = usePathname();
  const [appearance, setAppearance] = useState<Appearance>("light");
  const pointer = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const stored = readTheme();
    setAppearance(stored);
    document.documentElement.setAttribute("data-theme", stored);
  }, []);

  const next: Appearance = appearance === "dark" ? "light" : "dark";

  function commit(theme: Appearance) {
    setAppearance(theme);
    applyTheme(theme);
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      data-next={next}
      aria-label={`Switch to ${next} theme`}
      onPointerUp={(event) => {
        if (event.pointerType !== "mouse" || event.button !== 0) {
          pointer.current = null;
          return;
        }
        pointer.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={() => {
        const origin = pointer.current;
        pointer.current = null;
        if (pathname === "/" && origin) {
          void playThemeReveal(next, origin).then((result) => {
            if (result !== "busy") {
              commit(next);
            }
          });
          return;
        }
        commit(next);
      }}
    >
      {next}
    </button>
  );
}
