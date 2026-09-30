import { cn } from "@/lib/cn";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="grid size-6 place-items-center rounded-md bg-accent text-[11px] font-bold text-accent-fg">CS</span>
      Content Studio
    </span>
  );
}
