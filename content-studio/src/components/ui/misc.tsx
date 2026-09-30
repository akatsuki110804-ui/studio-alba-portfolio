"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "./toast";

export function CopyButton({
  text,
  label = "コピー",
  className,
  iconOnly,
  size = "sm",
}: {
  text: string;
  label?: string;
  className?: string;
  iconOnly?: boolean;
  size?: "xs" | "sm";
}) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("コピーできませんでした。ブラウザの権限を確認してください。");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      disabled={!text}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-md font-medium transition-colors disabled:opacity-40",
        size === "xs" ? "h-6 px-1.5 text-xs" : "h-7 px-2 text-xs",
        copied ? "bg-success-soft text-success" : "text-fg-muted hover:bg-surface-3 hover:text-fg",
        className,
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {!iconOnly && (copied ? "コピー済み" : label)}
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent">{icon}</div>}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <div className="mt-1.5 max-w-md text-sm leading-relaxed text-fg-muted">{description}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-success transition-[width]" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
