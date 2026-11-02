import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Appearance = "system" | "light" | "dark";
const storageKey = "filspay-appearance";
const systemQuery = "(prefers-color-scheme: dark)";

function readAppearance(): Appearance {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function applyAppearance(appearance: Appearance) {
  document.documentElement.dataset.theme = appearance === "system"
    ? (window.matchMedia(systemQuery).matches ? "dark" : "light")
    : appearance;
}

/** Apply before React renders so the first screen uses the saved appearance. */
export function initializeTheme() {
  applyAppearance(readAppearance());
}

const ThemeContext = createContext<{
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
}>({ appearance: "system", setAppearance: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);

  useEffect(() => {
    applyAppearance(appearance);
    const media = window.matchMedia(systemQuery);
    const updateSystem = () => applyAppearance(appearance);
    const syncStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setAppearance(readAppearance());
    };
    media.addEventListener("change", updateSystem);
    window.addEventListener("storage", syncStorage);
    return () => {
      media.removeEventListener("change", updateSystem);
      window.removeEventListener("storage", syncStorage);
    };
  }, [appearance]);

  function changeAppearance(value: Appearance) {
    applyAppearance(value);
    setAppearance(value);
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      // Appearance still works when browser storage is unavailable.
    }
  }

  return <ThemeContext.Provider value={{ appearance, setAppearance: changeAppearance }}>{children}</ThemeContext.Provider>;
}

export function ThemeSelect() {
  const { appearance, setAppearance } = useContext(ThemeContext);
  return (
    <label className="fp-theme-select">
      <span>Appearance</span>
      <select value={appearance} onChange={(event) => setAppearance(event.target.value as Appearance)}>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
