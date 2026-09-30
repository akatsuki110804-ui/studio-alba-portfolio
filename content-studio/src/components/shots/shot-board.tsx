"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Download, Film, GripVertical, ImageIcon, Mic, Plus, Search, Sparkles } from "lucide-react";
import type { ShotStatus } from "@/generated/prisma/enums";
import { generatePrompts } from "@/app/actions/prompts";
import { createShot, reorderShots, updateShotsStatus } from "@/app/actions/shots";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { CopyButton, EmptyState } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { SHOT_STATUSES } from "@/lib/labels";
import { downloadText, promptsToText, shotsToCsv } from "./export";
import { ShotPanel } from "./shot-panel";
import { StatusSelect } from "./status-select";
import type { EntityOption, ShotRow } from "./types";
import type { UploadTarget } from "@/lib/upload-client";

type Filter = "ALL" | "NEEDS_PROMPT" | ShotStatus;

export function needsPrompt(s: ShotRow) {
  return !s.imagePrompt || !s.videoPrompt || s.imagePrompt.stale || s.videoPrompt.stale;
}

export function latestVisual(s: ShotRow) {
  for (const kind of ["VIDEO", "IMAGE"] as const) {
    const asset = s.assets.find((a) => a.kind === kind && a.versions.length > 0);
    if (asset) return { kind, version: asset.versions[0], count: asset.versions.length };
  }
  return null;
}

export function ShotBoard({
  projectId,
  projectTitle,
  unit,
  shots,
  characters,
  locations,
  initialShotId,
  uploadTarget,
}: {
  projectId: string;
  projectTitle: string;
  unit: string;
  shots: ShotRow[];
  characters: EntityOption[];
  locations: EntityOption[];
  initialShotId: string | null;
  uploadTarget: UploadTarget;
}) {
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(initialShotId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [generating, startGenerate] = useTransition();
  const [adding, startAdd] = useTransition();
  const [bulkPending, startBulk] = useTransition();

  const charById = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters]);
  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  const ordered = useMemo(() => {
    if (!pendingOrder) return shots;
    const idx = new Map(pendingOrder.map((id, i) => [id, i]));
    return [...shots].sort((a, b) => (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0));
  }, [shots, pendingOrder]);

  const numberOf = useMemo(() => new Map(ordered.map((s, i) => [s.id, i + 1])), [ordered]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ordered.filter((s) => {
      if (filter === "NEEDS_PROMPT" && !needsPrompt(s)) return false;
      if (filter !== "ALL" && filter !== "NEEDS_PROMPT" && s.status !== filter) return false;
      if (!q) return true;
      const hay = [s.scene, s.description, s.action, s.dialogue, s.narration, s.notes, ...s.characterIds.map((id) => charById.get(id)?.name ?? "")]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [ordered, filter, query, charById]);

  const needPromptCount = useMemo(() => shots.filter(needsPrompt).length, [shots]);
  const openShot = openId ? ordered.find((s) => s.id === openId) : undefined;

  // Keep ?shot= in the URL so a shot can be linked / survives reload, without a server round-trip.
  const open = useCallback((id: string | null) => {
    setOpenId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("shot", id);
    else url.searchParams.delete("shot");
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openId && !(e.target as HTMLElement)?.closest("dialog")) open(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, open]);

  function runGenerate(scope: "missing" | "all" | "selected") {
    startGenerate(async () => {
      const res = await generatePrompts(projectId, scope, [...selected]);
      if (!res.ok) toast.error(res.error);
      else if (res.data.generated === 0) toast.info("Promptはすべて最新です");
      else toast.success(`${res.data.generated}${unit}のPromptを生成しました`);
    });
  }

  function addShot() {
    startAdd(async () => {
      const res = await createShot(projectId, null);
      if (!res.ok) toast.error(res.error);
      else open(res.data.id);
    });
  }

  function bulkStatus(status: ShotStatus) {
    const ids = [...selected];
    startBulk(async () => {
      const res = await updateShotsStatus(projectId, ids, status);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(`${ids.length}${unit}のステータスを変更しました`);
        setSelected(new Set());
      }
    });
  }

  function setStatus(id: string, status: ShotStatus) {
    startBulk(async () => {
      const res = await updateShotsStatus(projectId, [id], status);
      if (!res.ok) toast.error(res.error);
    });
  }

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ids = ordered.map((s) => s.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setPendingOrder(ids);
    setDragId(null);
    void reorderShots(projectId, ids).then((res) => {
      if (!res.ok) toast.error(res.error);
      setPendingOrder(null);
    });
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allVisibleSelected = visible.length > 0 && visible.every((s) => selected.has(s.id));
  const dragEnabled = filter === "ALL" && !query.trim();

  if (shots.length === 0) {
    return (
      <EmptyState
        icon={<Film className="size-5" />}
        title={`${unit}がまだありません`}
        description={
          <>
            台本タブで「AIで解析」すると、台本から{unit}表が自動で作られます。
            <br />
            手動で1つずつ追加することもできます。
          </>
        }
        action={
          <>
            <Link
              href={`/projects/${projectId}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent-hover"
            >
              <Sparkles className="size-4" />
              台本から作成
            </Link>
            <Button onClick={addShot} loading={adding}>
              <Plus className="size-4" />
              手動で追加
            </Button>
          </>
        }
      />
    );
  }

  return (
    <div className={cn("flex flex-col gap-3 transition-[padding]", openShot && "xl:pr-[560px]")}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="検索（内容・人物・セリフ）" className="h-8 pl-8" aria-label="検索" />
        </div>
        <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="h-8 w-auto" aria-label="絞り込み">
          <option value="ALL">すべて（{shots.length}）</option>
          <option value="NEEDS_PROMPT">Prompt未作成・要再生成（{needPromptCount}）</option>
          {SHOT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}（{shots.filter((x) => x.status === s.value).length}）
            </option>
          ))}
        </Select>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ExportMenu shots={ordered} characters={characters} locations={locations} unit={unit} title={projectTitle} />
          <Button onClick={addShot} loading={adding}>
            <Plus className="size-4" />
            {unit}追加
          </Button>
          <Button onClick={() => runGenerate("missing")} loading={generating && selected.size === 0} disabled={generating}>
            {!generating && <Sparkles className="size-4" />}
            {needPromptCount > 0 ? `Prompt一括生成（${needPromptCount}）` : "Promptは最新"}
          </Button>
        </div>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm">
          <span className="font-medium">{selected.size}件選択中</span>
          <Select
            value=""
            onChange={(e) => e.target.value && bulkStatus(e.target.value as ShotStatus)}
            disabled={bulkPending}
            className="h-7 w-auto text-xs"
            aria-label="選択した項目のステータスを変更"
          >
            <option value="">ステータスを変更…</option>
            {SHOT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Button size="xs" onClick={() => runGenerate("selected")} loading={generating}>
            <Sparkles className="size-3.5" />
            選択分のPromptを生成
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())} className="ml-auto">
            選択解除
          </Button>
        </div>
      )}

      {generating && (
        <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-muted" role="status">
          <Sparkles className="size-3.5 animate-pulse text-accent" />
          キャラクター・ロケーション設定を反映してPromptを生成しています…（{unit}数によって数十秒かかります）
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState title="条件に一致するカットがありません" description="検索語や絞り込みを変更してください。" />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface shadow-sm md:block">
            <table className="w-full min-w-[1080px] table-fixed border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-surface-2 text-left text-xs text-fg-muted">
                <tr className="[&>th]:border-b [&>th]:border-border [&>th]:px-2 [&>th]:py-2 [&>th]:font-medium">
                  <th className="w-10 pl-3">
                    <input
                      type="checkbox"
                      aria-label="すべて選択"
                      checked={allVisibleSelected}
                      onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((s) => s.id)))}
                      className="accent-[var(--accent)]"
                    />
                  </th>
                  <th className="w-14">No</th>
                  <th className="w-[26%]">内容</th>
                  <th className="w-[10%]">登場人物</th>
                  <th className="w-[8%]">場所</th>
                  <th className="w-[24%]">セリフ・ナレーション</th>
                  <th className="w-20">素材</th>
                  <th className="w-24">Prompt</th>
                  <th className="w-40 pr-3">ステータス</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => {
                  const visual = latestVisual(s);
                  return (
                    <tr
                      key={s.id}
                      onClick={() => open(s.id)}
                      onDragOver={(e) => dragEnabled && dragId && e.preventDefault()}
                      onDrop={() => onDrop(s.id)}
                      className={cn(
                        "cursor-pointer align-top transition-colors [&>td]:border-b [&>td]:border-border [&>td]:px-2 [&>td]:py-2.5",
                        openId === s.id ? "bg-accent-soft/60" : "hover:bg-surface-2/70",
                        dragId === s.id && "opacity-40",
                      )}
                    >
                      <td className="pl-3" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`No.${numberOf.get(s.id)}を選択`} checked={selected.has(s.id)} onChange={() => toggle(s.id)} className="accent-[var(--accent)]" />
                      </td>
                      <td>
                        <div className="flex items-center gap-0.5">
                          {dragEnabled && (
                            <span
                              draggable
                              onDragStart={(e) => {
                                setDragId(s.id);
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              onDragEnd={() => setDragId(null)}
                              onClick={(e) => e.stopPropagation()}
                              className="cursor-grab text-fg-subtle hover:text-fg"
                              title="ドラッグで並び替え"
                            >
                              <GripVertical className="size-3.5" />
                            </span>
                          )}
                          <span className="font-mono text-xs font-medium tabular-nums">{String(numberOf.get(s.id)).padStart(2, "0")}</span>
                        </div>
                      </td>
                      <td>
                        {s.scene && <div className="mb-0.5 truncate text-[11px] font-medium text-accent">{s.scene}</div>}
                        <div className="line-clamp-3 leading-snug">{s.description || <span className="text-fg-subtle">（未入力）</span>}</div>
                        {s.camera && <div className="mt-1 line-clamp-1 text-xs text-fg-subtle">🎥 {s.camera}</div>}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {s.characterIds.map((id) => (
                            <span key={id} className="rounded bg-surface-3 px-1.5 py-0.5 text-xs">
                              {charById.get(id)?.name}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="text-xs">{s.locationId ? locById.get(s.locationId)?.name : <span className="text-fg-subtle">—</span>}</td>
                      <td className="text-xs leading-snug">
                        {s.dialogue && <div className="line-clamp-2">「{s.dialogue}」</div>}
                        {s.narration && <div className="mt-0.5 line-clamp-2 text-fg-muted">N: {s.narration}</div>}
                        {!s.dialogue && !s.narration && <span className="text-fg-subtle">—</span>}
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <VisualThumb shot={s} visual={visual} />
                          {hasNarrationAudio(s) && (
                            <span title="ナレーション音声あり" className="text-fg-muted">
                              <Mic className="size-3.5" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <PromptCell image={s.imagePrompt} video={s.videoPrompt} />
                      </td>
                      <td className="pr-3">
                        <StatusSelect value={s.status} onChange={(v) => setStatus(s.id, v)} className="w-full" />
                        {s.notes && <div className="mt-1 line-clamp-2 text-[11px] text-warning">📝 {s.notes}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="flex flex-col gap-2 md:hidden">
            {visible.map((s) => {
              const visual = latestVisual(s);
              return (
                <li key={s.id}>
                  <button onClick={() => open(s.id)} className="flex w-full gap-3 rounded-xl border border-border bg-surface p-3 text-left shadow-sm">
                    <div className="flex flex-col items-center gap-2">
                      <span className="font-mono text-xs font-semibold">{String(numberOf.get(s.id)).padStart(2, "0")}</span>
                      <VisualThumb shot={s} visual={visual} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      {s.scene && <span className="truncate text-[11px] font-medium text-accent">{s.scene}</span>}
                      <p className="line-clamp-2 text-sm">{s.description || "（未入力）"}</p>
                      <p className="truncate text-xs text-fg-muted">
                        {[s.characterIds.map((id) => charById.get(id)?.name).join("・"), s.locationId && locById.get(s.locationId)?.name]
                          .filter(Boolean)
                          .join(" / ")}
                      </p>
                      <div className="flex items-center gap-2">
                        <StatusSelect value={s.status} onChange={(v) => setStatus(s.id, v)} className="w-36" />
                        {needsPrompt(s) && <span className="text-[11px] text-warning">Prompt要作成</span>}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {openShot && (
        <ShotPanel
          key={openShot.id}
          projectId={projectId}
          shot={openShot}
          number={numberOf.get(openShot.id) ?? 0}
          total={ordered.length}
          unit={unit}
          uploadTarget={uploadTarget}
          characters={characters}
          locations={locations}
          onClose={() => open(null)}
          onNavigate={(dir) => {
            const i = ordered.findIndex((s) => s.id === openShot.id);
            const next = ordered[i + dir];
            if (next) open(next.id);
          }}
          onOpen={open}
        />
      )}
    </div>
  );
}

function hasNarrationAudio(s: ShotRow) {
  return s.assets.some((a) => a.kind === "AUDIO" && a.versions.length > 0);
}

/** Compact: prompts are secondary now — copy buttons plus a stale flag. */
function PromptCell({ image, video }: { image: ShotRow["imagePrompt"]; video: ShotRow["videoPrompt"] }) {
  if (!image && !video) return <span className="text-xs text-fg-subtle">—</span>;
  const stale = image?.stale || video?.stale;
  return (
    <div className="flex flex-col items-start gap-0.5" onClick={(e) => e.stopPropagation()}>
      {image && <CopyButton text={image.content} label="画像" size="xs" />}
      {video && <CopyButton text={video.content} label="動画" size="xs" />}
      {stale && (
        <span className="inline-flex items-center gap-0.5 text-[10.5px] font-medium text-warning" title="キャラクター・ロケーション・カット内容の変更後に作られていません">
          <AlertTriangle className="size-3" />
          要再生成
        </span>
      )}
    </div>
  );
}

function VisualThumb({ shot, visual }: { shot: ShotRow; visual: ReturnType<typeof latestVisual> }) {
  if (!visual) {
    const others = shot.assets.reduce((n, a) => n + a.versions.length, 0);
    return <span className="text-xs text-fg-subtle">{others > 0 ? `${others}件` : "—"}</span>;
  }
  const v = visual.version;
  return (
    <div className="relative size-12 overflow-hidden rounded-md border border-border bg-surface-2" title={`${visual.kind === "VIDEO" ? "動画" : "画像"} 最新 v${v.version}`}>
      {v.url && visual.kind === "IMAGE" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={v.url} alt="" className="size-full object-cover" loading="lazy" />
      ) : v.url && visual.kind === "VIDEO" ? (
        <video src={`${v.url}#t=0.1`} className="size-full object-cover" muted preload="metadata" />
      ) : (
        <div className="grid size-full place-items-center text-fg-subtle">{visual.kind === "VIDEO" ? <Film className="size-4" /> : <ImageIcon className="size-4" />}</div>
      )}
      <span className="absolute right-0.5 bottom-0.5 rounded bg-black/60 px-1 text-[9px] font-semibold text-white">v{v.version}</span>
    </div>
  );
}

function ExportMenu({
  shots,
  characters,
  locations,
  unit,
  title,
}: {
  shots: ShotRow[];
  characters: EntityOption[];
  locations: EntityOption[];
  unit: string;
  title: string;
}) {
  const toast = useToast();
  async function copy(kind: "image" | "video") {
    const text = promptsToText(shots, kind, unit);
    if (!text) {
      toast.info("コピーできるPromptがありません");
      return;
    }
    await navigator.clipboard.writeText(text);
    toast.success(`${kind === "image" ? "画像" : "動画"}Promptをすべてコピーしました`);
  }
  return (
    <details className="relative">
      <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium shadow-sm hover:bg-surface-2">
        <Download className="size-4" />
        書き出し
      </summary>
      <div className="absolute right-0 z-20 mt-1 flex w-56 flex-col rounded-lg border border-border bg-surface p-1 text-sm shadow-panel">
        <button className="rounded-md px-2.5 py-1.5 text-left hover:bg-surface-2" onClick={() => void copy("image")}>
          画像Promptを全件コピー
        </button>
        <button className="rounded-md px-2.5 py-1.5 text-left hover:bg-surface-2" onClick={() => void copy("video")}>
          動画Promptを全件コピー
        </button>
        <button
          className="rounded-md px-2.5 py-1.5 text-left hover:bg-surface-2"
          onClick={() => downloadText(`${title.replace(/[\\/:*?"<>|]/g, "_")}_${unit}表.csv`, shotsToCsv(shots, characters, locations))}
        >
          {unit}表をCSVでダウンロード
        </button>
      </div>
    </details>
  );
}
