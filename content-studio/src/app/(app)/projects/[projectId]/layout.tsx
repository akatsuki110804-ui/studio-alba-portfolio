import Link from "next/link";
import { ArrowRight, CalendarDays, ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/misc";
import { ProjectTabs } from "@/components/project-tabs";
import { cn } from "@/lib/cn";
import { daysUntil, formatDate, formatLabel, progressPercent, projectStatusMeta, SHOT_STATUSES, unitLabel } from "@/lib/labels";
import { toneDot } from "@/components/ui/badge";
import { getProjectForPage, getProjectStats } from "@/lib/queries";

// AI calls (analysis / prompt generation) run inside server actions on these routes.
export const maxDuration = 300;

export default async function ProjectLayout({ children, params }: LayoutProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  const { project } = await getProjectForPage(projectId);
  const stats = await getProjectStats(projectId);
  const pct = progressPercent(stats.byStatus);
  const status = projectStatusMeta(project.status);
  const unit = unitLabel(project.format);
  const days = daysUntil(project.dueDate);
  const next = nextStep(projectId, project.script, project.analyzedAt, stats, unit);

  return (
    <div>
      <div className="border-b border-border bg-surface">
        <div className="mx-auto max-w-[1600px] px-4 pt-4">
          <Link href="/projects" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg">
            <ChevronLeft className="size-3.5" />
            プロジェクト
          </Link>
          <div className="mt-1 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-semibold">{project.title}</h1>
                <Badge tone={status.tone} dot>
                  {status.label}
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                <span>{formatLabel(project.format)}</span>
                {project.platform && <span>{project.platform}</span>}
                <span>{project.aspectRatio}</span>
                {project.dueDate && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1",
                      days !== null && days < 0 && project.status !== "DELIVERED" && "font-medium text-danger",
                    )}
                  >
                    <CalendarDays className="size-3.5" />
                    納期 {formatDate(project.dueDate)}
                  </span>
                )}
              </div>
            </div>

            <div className="flex w-full flex-col gap-1.5 lg:w-80">
              <div className="flex items-center justify-between text-xs">
                <span className="text-fg-muted">
                  進捗 完了 {stats.byStatus.DONE ?? 0} / {stats.shots} {unit}
                </span>
                <span className="font-semibold tabular-nums">{pct}%</span>
              </div>
              <ProgressBar value={pct} />
              {stats.shots > 0 && (
                <div className="flex h-1.5 overflow-hidden rounded-full" aria-hidden="true" title="ステータス内訳">
                  {SHOT_STATUSES.map((s) => {
                    const n = stats.byStatus[s.value] ?? 0;
                    if (!n) return null;
                    return <div key={s.value} className={toneDot(s.tone)} style={{ width: `${(n / stats.shots) * 100}%` }} />;
                  })}
                </div>
              )}
            </div>
          </div>

          {next && (
            <Link
              href={next.href}
              className="mt-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-fg hover:border-accent/60"
            >
              <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-fg">次にやること</span>
              <span className="min-w-0 flex-1 truncate">{next.label}</span>
              <ArrowRight className="size-4 shrink-0 text-accent" />
            </Link>
          )}

          <div className="mt-3">
            <ProjectTabs projectId={projectId} counts={stats} unit={unit} />
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-[1600px] px-4 py-6">{children}</div>
    </div>
  );
}

function nextStep(
  projectId: string,
  script: string,
  analyzedAt: Date | null,
  stats: Awaited<ReturnType<typeof getProjectStats>>,
  unit: string,
): { label: string; href: string } | null {
  const base = `/projects/${projectId}`;
  if (!script.trim() && stats.shots === 0) return { label: "台本を貼り付けましょう", href: base };
  if (!analyzedAt && stats.shots === 0) return { label: `「AIで解析」で台本から${unit}表を作りましょう`, href: base };
  if (stats.shots === 0) return { label: `${unit}を追加しましょう`, href: `${base}/shots` };
  if ((stats.byStatus.DONE ?? 0) === stats.shots) return null;
  if (stats.characters > 0 && stats.missingSheets === stats.characters && stats.shotsWithPrompt === 0) {
    return { label: "キャラクターの外見を確認しましょう（Promptに毎回反映されます）", href: `${base}/characters` };
  }
  if (stats.shotsWithPrompt < stats.shots) {
    return { label: `Promptを一括生成しましょう（未作成 ${stats.shots - stats.shotsWithPrompt} ${unit}）`, href: `${base}/shots` };
  }
  if (stats.shotsWithAsset < stats.shots) {
    return { label: `生成した素材をアップロードしましょう（未登録 ${stats.shots - stats.shotsWithAsset} ${unit}）`, href: `${base}/shots` };
  }
  if ((stats.byStatus.DONE ?? 0) < stats.shots) {
    return { label: `確認が済んだ${unit}を「完了」にしましょう`, href: `${base}/shots` };
  }
  return null;
}
