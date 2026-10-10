"use client";

import { useLayoutEffect, useState } from "react";

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
  const [appearance, setAppearance] = useState<Appearance>("light");

  useLayoutEffect(() => {
    const stored = readTheme();
    setAppearance(stored);
    document.documentElement.setAttribute("data-theme", stored);
  }, []);

  const next: Appearance = appearance === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      data-next={next}
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        setAppearance(next);
        applyTheme(next);
      }}
    >
      {next}
    </button>
  );
}
