import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemeSetting = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

const STORAGE_KEY = "timthink-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

interface ThemeContextValue {
  setting: ThemeSetting;
  effective: EffectiveTheme;
  setSetting: (setting: ThemeSetting) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredSetting(): ThemeSetting {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function storeSetting(setting: ThemeSetting): void {
  try {
    if (setting === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, setting);
  } catch {}
}

function applyThemeAttribute(setting: ThemeSetting): void {
  const root = document.documentElement;
  if (setting === "system") delete root.dataset.theme;
  else root.dataset.theme = setting;
}

function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => setPrefersDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return prefersDark;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [setting, setSettingState] = useState<ThemeSetting>(readStoredSetting);
  const prefersDark = useSystemPrefersDark();
  const effective: EffectiveTheme = setting === "system" ? (prefersDark ? "dark" : "light") : setting;

  const setSetting = useCallback((next: ThemeSetting) => {
    applyThemeAttribute(next);
    storeSetting(next);
    setSettingState(next);
  }, []);

  const value = useMemo(() => ({ setting, effective, setSetting }), [setting, effective, setSetting]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
