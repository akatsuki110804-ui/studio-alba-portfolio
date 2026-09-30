"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function ProjectTabs({
  projectId,
  counts,
  unit,
}: {
  projectId: string;
  counts: { shots: number; characters: number; locations: number };
  unit: string;
}) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const tabs = [
    { href: base, label: "台本", count: null },
    { href: `${base}/characters`, label: "キャラクター", count: counts.characters },
    { href: `${base}/locations`, label: "ロケーション", count: counts.locations },
    { href: `${base}/shots`, label: `${unit}・素材`, count: counts.shots },
    { href: `${base}/export`, label: "編集書き出し", count: null },
    { href: `${base}/settings`, label: "設定", count: null },
  ];

  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="プロジェクト内メニュー">
      {tabs.map((t) => {
        const active = t.href === base ? pathname === base : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-sm whitespace-nowrap transition-colors",
              active ? "border-accent font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
            {t.count !== null && (
              <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-medium text-fg-muted tabular-nums">{t.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
