import { Monitor, Moon, Sun } from "lucide-react";
import { type ThemeSetting, useTheme } from "../lib/theme";

const OPTIONS: ReadonlyArray<{ value: ThemeSetting; label: string; Icon: typeof Sun }> = [
  { value: "system", label: "System theme", Icon: Monitor },
  { value: "light", label: "Light theme", Icon: Sun },
  { value: "dark", label: "Dark theme", Icon: Moon },
];

export function ThemeToggle() {
  const { setting, setSetting } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center rounded-button border border-line-soft bg-bg-sunken p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = setting === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={selected}
            aria-label={label}
            title={label}
            onClick={() => setSetting(value)}
            className={`grid size-7 place-items-center rounded-[8px] transition-colors duration-150 ${
              selected ? "bg-surface text-ink" : "text-ink-32 hover:text-ink-64"
            }`}
          >
            <Icon className="size-3.5" strokeWidth={2} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
