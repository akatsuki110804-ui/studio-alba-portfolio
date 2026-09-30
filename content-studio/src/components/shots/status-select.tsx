"use client";

import type { ShotStatus } from "@/generated/prisma/enums";
import { toneDot } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { SHOT_STATUSES, shotStatusMeta } from "@/lib/labels";

const TONE_TEXT: Record<string, string> = {
  gray: "text-fg-muted",
  violet: "text-accent",
  blue: "text-[#2563eb] dark:text-[#7aa7ff]",
  cyan: "text-[#0e7490] dark:text-[#5fd0e6]",
  amber: "text-warning",
  green: "text-success",
  red: "text-danger",
};

export function StatusSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: ShotStatus;
  onChange: (value: ShotStatus) => void;
  disabled?: boolean;
  className?: string;
}) {
  const meta = shotStatusMeta(value);
  return (
    <div className={cn("relative inline-flex items-center", className)} onClick={(e) => e.stopPropagation()}>
      <span className={cn("pointer-events-none absolute left-2 size-2 rounded-full", toneDot(meta.tone))} />
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ShotStatus)}
        aria-label="ステータス"
        className={cn(
          "h-7 w-full cursor-pointer appearance-none rounded-md border border-transparent bg-surface-2 py-0 pr-6 pl-6 text-xs font-medium hover:border-border-strong focus:border-accent focus:outline-none",
          TONE_TEXT[meta.tone],
        )}
      >
        {SHOT_STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-1.5 size-3 text-fg-subtle" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}
