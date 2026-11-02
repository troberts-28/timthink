import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonTone = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const TONES: Record<ButtonTone, string> = {
  primary: "bg-accent text-on-accent hover:brightness-[0.96] active:brightness-[0.92]",
  secondary: "border border-line bg-surface text-ink hover:border-ink-32",
  ghost: "text-ink-64 hover:bg-bg-sunken hover:text-ink",
  danger: "border border-bad text-bad-ink hover:bg-bad-soft",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-meta",
  md: "h-8 gap-1.5 px-3 text-meta",
  lg: "h-9 gap-2 px-4 text-ui",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
  icon?: ReactNode;
}

export function Button({ tone = "secondary", size = "md", icon, className = "", children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex flex-none items-center justify-center rounded-button font-semibold whitespace-nowrap transition-[filter,border-color,background-color,color] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${TONES[tone]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
