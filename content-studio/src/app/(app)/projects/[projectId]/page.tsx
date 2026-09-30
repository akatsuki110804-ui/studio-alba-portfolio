import { ScriptEditor } from "@/components/script-editor";
import { Badge } from "@/components/ui/badge";
import { aiProviderInfo } from "@/lib/ai";
import { ScriptAnalysisSchema } from "@/lib/ai/schemas";
import { formatDateTime, unitLabel } from "@/lib/labels";
import { getProjectForPage, getProjectStats } from "@/lib/queries";

export default async function ProjectScriptPage({ params }: PageProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  const { project } = await getProjectForPage(projectId);
  const stats = await getProjectStats(projectId);
  const unit = unitLabel(project.format);
  const parsed = project.analysis ? ScriptAnalysisSchema.safeParse(project.analysis) : null;
  const analysis = parsed?.success ? parsed.data : null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5">
        <ScriptEditor
          projectId={projectId}
          initialScript={project.script}
          shotCount={stats.shots}
          unit={unit}
          isMock={aiProviderInfo().isMock}
        />
      </section>

      <aside className="flex flex-col gap-4">
        <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <h2 className="text-sm font-semibold">解析結果</h2>
          {!analysis ? (
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              まだ解析していません。台本を入力して「AIで解析」を押すと、シーン・{unit}・登場人物・ロケーション・小道具・必要素材がここに整理されます。
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-4 text-sm">
              <p className="text-xs text-fg-subtle">最終解析 {formatDateTime(project.analyzedAt)}</p>
              {analysis.summary && <p className="leading-relaxed text-fg-muted">{analysis.summary}</p>}

              <div>
                <h3 className="mb-1.5 text-xs font-medium text-fg-muted">シーン構成</h3>
                <ol className="flex flex-col gap-1">
                  {analysis.scenes.map((s, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-2.5 py-1.5">
                      <span className="truncate">{s.label}</span>
                      <span className="shrink-0 text-xs text-fg-subtle">
                        {s.shots.length}
                        {unit}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              <TagList title="登場人物" items={analysis.characters.map((c) => c.name)} />
              <TagList title="ロケーション" items={analysis.locations.map((l) => l.name)} />
              <TagList title="小道具" items={analysis.props} />
              <TagList
                title="必要な素材"
                items={[...new Set([...analysis.requiredAssets, ...analysis.scenes.flatMap((s) => s.shots.flatMap((sh) => sh.requiredAssets))])]}
              />
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface p-4 text-sm shadow-sm">
          <h2 className="text-sm font-semibold">制作の流れ</h2>
          <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-fg-muted">
            <li>台本を貼り付けて「AIで解析」</li>
            <li>キャラクター・ロケーションの外見を確認</li>
            <li>{unit}表で「Prompt一括生成」</li>
            <li>Promptをコピーして外部AIツールで生成</li>
            <li>完成素材をアップロード → 完了</li>
          </ol>
        </section>
      </aside>
    </div>
  );
}

function TagList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-medium text-fg-muted">{title}</h3>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge key={item}>{item}</Badge>
        ))}
      </div>
    </div>
  );
}
