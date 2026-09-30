import type { Metadata } from "next";
import { DeleteProject } from "@/components/delete-project";
import { ProjectForm } from "@/components/project-form";
import { formatDateTime } from "@/lib/labels";
import { getProjectForPage } from "@/lib/queries";

export const metadata: Metadata = { title: "プロジェクト設定" };

export default async function ProjectSettingsPage({ params }: PageProps<"/projects/[projectId]/settings">) {
  const { projectId } = await params;
  const { project } = await getProjectForPage(projectId);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <section className="rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6">
        <h2 className="mb-4 text-sm font-semibold">基本情報</h2>
        <ProjectForm
          projectId={projectId}
          initial={{
            title: project.title,
            description: project.description,
            format: project.format,
            platform: project.platform,
            aspectRatio: project.aspectRatio,
            dueDate: project.dueDate ? project.dueDate.toISOString().slice(0, 10) : "",
            status: project.status,
            styleGuide: project.styleGuide,
          }}
        />
        <p className="mt-4 text-xs text-fg-subtle">
          作成 {formatDateTime(project.createdAt)} · 更新 {formatDateTime(project.updatedAt)}
        </p>
      </section>

      <section className="rounded-xl border border-danger/30 bg-surface p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-danger">危険な操作</h2>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-fg-muted">このプロジェクトと関連データをすべて削除します。</p>
          <DeleteProject projectId={projectId} title={project.title} />
        </div>
      </section>
    </div>
  );
}
