import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Clapperboard, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ProgressBar } from "@/components/ui/misc";
import { requireUser } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";
import { daysUntil, formatDate, formatDateTime, formatLabel, progressPercent, projectStatusMeta, unitLabel } from "@/lib/labels";
import type { ShotStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "プロジェクト" };

export default async function ProjectsPage() {
  const user = await requireUser();
  const projects = await db.project.findMany({
    where: { ownerId: user.id },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      format: true,
      platform: true,
      status: true,
      dueDate: true,
      updatedAt: true,
      _count: { select: { characters: true } },
    },
  });

  const counts = await db.shot.groupBy({
    by: ["projectId", "status"],
    where: { projectId: { in: projects.map((p) => p.id) } },
    _count: { _all: true },
  });
  const countsByProject = new Map<string, Partial<Record<ShotStatus, number>>>();
  for (const row of counts) {
    const entry = countsByProject.get(row.projectId) ?? {};
    entry[row.status] = row._count._all;
    countsByProject.set(row.projectId, entry);
  }

  const active = projects.filter((p) => p.status !== "ARCHIVED");
  const archived = projects.filter((p) => p.status === "ARCHIVED");

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">プロジェクト</h1>
          <p className="mt-1 text-sm text-fg-muted">案件ごとに台本・カット・Prompt・素材をまとめて管理します。</p>
        </div>
        <Link
          href="/projects/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg shadow-sm hover:bg-accent-hover"
        >
          <Plus className="size-4" />
          新しいプロジェクト
        </Link>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={<Clapperboard className="size-5" />}
          title="まだプロジェクトがありません"
          description={
            <>
              案件を1つ作って台本を貼り付けるだけで、AIがカット割り・登場人物・ロケーションを整理します。
              <br />
              APIキーがなくてもデモモードで全工程を試せます。
            </>
          }
          action={
            <Link
              href="/projects/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg hover:bg-accent-hover"
            >
              <Plus className="size-4" />
              最初のプロジェクトを作成
            </Link>
          }
        />
      ) : (
        <>
          <ProjectGrid projects={active} countsByProject={countsByProject} />
          {archived.length > 0 && (
            <details className="mt-10">
              <summary className="cursor-pointer text-sm font-medium text-fg-muted">アーカイブ（{archived.length}）</summary>
              <div className="mt-4">
                <ProjectGrid projects={archived} countsByProject={countsByProject} />
              </div>
            </details>
          )}
        </>
      )}
    </main>
  );
}

type ProjectCard = {
  id: string;
  title: string;
  format: Parameters<typeof formatLabel>[0];
  platform: string;
  status: Parameters<typeof projectStatusMeta>[0];
  dueDate: Date | null;
  updatedAt: Date;
};

function ProjectGrid({
  projects,
  countsByProject,
}: {
  projects: ProjectCard[];
  countsByProject: Map<string, Partial<Record<ShotStatus, number>>>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => {
        const counts = countsByProject.get(p.id) ?? {};
        const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
        const pct = progressPercent(counts);
        const status = projectStatusMeta(p.status);
        const days = daysUntil(p.dueDate);
        const dueTone =
          days === null || p.status === "DELIVERED" || p.status === "ARCHIVED"
            ? "text-fg-subtle"
            : days < 0
              ? "text-danger font-medium"
              : days <= 3
                ? "text-warning font-medium"
                : "text-fg-subtle";
        return (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            className="group flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-border-strong"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="line-clamp-2 text-sm font-semibold group-hover:text-accent">{p.title}</h2>
              <Badge tone={status.tone} dot>
                {status.label}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
              <span>{formatLabel(p.format)}</span>
              {p.platform && <span>· {p.platform}</span>}
            </div>
            <div className="mt-auto flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-fg-muted">
                  完了 {counts.DONE ?? 0} / {total} {unitLabel(p.format)}
                </span>
                <span className="font-medium tabular-nums">{pct}%</span>
              </div>
              <ProgressBar value={pct} />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className={cn("inline-flex items-center gap-1", dueTone)}>
                <CalendarDays className="size-3.5" />
                {p.dueDate
                  ? `${formatDate(p.dueDate)}${days !== null && days < 0 && p.status !== "DELIVERED" ? `（${-days}日超過）` : days !== null && days <= 7 && days >= 0 && p.status !== "DELIVERED" ? `（あと${days}日）` : ""}`
                  : "納期未設定"}
              </span>
              <span className="text-fg-subtle">更新 {formatDateTime(p.updatedAt)}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
