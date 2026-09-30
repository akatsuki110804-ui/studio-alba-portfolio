import type { ReactNode } from "react";
import type { Tone } from "@/lib/labels";
import { cn } from "@/lib/cn";

// Status hues are fixed per tone; they sit on soft tinted backgrounds that work in both themes.
const TONES: Record<Tone, string> = {
  gray: "bg-surface-3 text-fg-muted",
  blue: "bg-[#3b82f6]/12 text-[#2563eb] dark:text-[#7aa7ff]",
  violet: "bg-accent-soft text-accent",
  cyan: "bg-[#0891b2]/12 text-[#0e7490] dark:text-[#5fd0e6]",
  amber: "bg-warning-soft text-warning",
  green: "bg-success-soft text-success",
  red: "bg-danger-soft text-danger",
};

const DOTS: Record<Tone, string> = {
  gray: "bg-fg-subtle",
  blue: "bg-[#3b82f6]",
  violet: "bg-accent",
  cyan: "bg-[#06b6d4]",
  amber: "bg-warning",
  green: "bg-success",
  red: "bg-danger",
};

export function Badge({ tone = "gray", children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone], className)}>
      {dot && <span className={cn("size-1.5 rounded-full", DOTS[tone])} />}
      {children}
    </span>
  );
}

export function toneDot(tone: Tone) {
  return DOTS[tone];
}
