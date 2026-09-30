"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Captions, CheckCircle2, Clapperboard, Download, FolderDown, Music, Trash2, Upload } from "lucide-react";
import { removeBgm } from "@/app/actions/edit-kit";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { buildKitZip, canWriteFolder, prepareTimeline, writeKitToFolder } from "@/lib/edit-kit/package";
import { buildSrt, frameSize, subtitleText, type KitShotInput, type Timeline } from "@/lib/edit-kit/timeline";
import { downloadText } from "@/components/shots/export";
import { uploadProjectBgm, type UploadTarget } from "@/lib/upload-client";

export type ExportShot = {
  id: string;
  no: number;
  label: string;
  description: string;
  dialogue: string;
  narration: string;
  notes: string;
  plannedSec: number | null;
  visual: { url: string; kitName: string; kind: "VIDEO" | "IMAGE"; version: number } | null;
  visualExternalOnly: boolean;
  narrationAudio: { url: string; kitName: string } | null;
};

type Bgm = { url: string; kitName: string; fileName: string } | null;

const FPS_OPTIONS = [24, 25, 30, 60];

const noopSubscribe = () => () => {};

const LENGTH_SOURCE: Record<string, string> = {
  narration: "ナレーションに合わせた",
  planned: "カット表の秒数",
  video: "動画の長さ",
  default: "既定（3秒）",
};

function fmtSec(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}分${s.toFixed(1)}秒` : `${s.toFixed(1)}秒`;
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** ASCII-only folder name: safest for every filesystem and for Premiere's relink. */
function kitFolderName() {
  return `EditKit_${stamp()}`;
}

/** Download names can carry the project title. */
function downloadBaseName(title: string) {
  return `${title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60)}_編集キット_${stamp()}`;
}

export function EditKitPanel({
  projectId,
  title,
  aspectRatio,
  unit,
  shots,
  bgm,
  uploadTarget,
}: {
  projectId: string;
  title: string;
  aspectRatio: string;
  unit: string;
  shots: ExportShot[];
  bgm: Bgm;
  uploadTarget: UploadTarget;
}) {
  const router = useRouter();
  const toast = useToast();
  const [fps, setFps] = useState(30);
  const [busy, setBusy] = useState<null | "kit" | "srt" | "preview">(null);
  const [progress, setProgress] = useState("");
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [exported, setExported] = useState<null | "folder" | "zip">(null);
  const [bgmProgress, setBgmProgress] = useState<number | null>(null);
  const bgmInput = useRef<HTMLInputElement>(null);
  const { width, height } = frameSize(aspectRatio);
  // Browser-only capability; false during server render to keep hydration stable.
  const folderMode = useSyncExternalStore(noopSubscribe, canWriteFolder, () => false);

  const withVisual = shots.filter((s) => s.visual).length;
  const withNarrationAudio = shots.filter((s) => s.narrationAudio).length;
  const withText = shots.filter((s) => subtitleText(s)).length;

  // Fresh inputs each time: probing writes measured durations into them.
  const kitInputs = (): KitShotInput[] =>
    shots.map((s) => ({
      no: s.no,
      label: s.label,
      dialogue: s.dialogue,
      narration: s.narration,
      notes: s.notes,
      plannedSec: s.plannedSec,
      visual: s.visual ? { url: s.visual.url, kitName: s.visual.kitName, kind: s.visual.kind } : null,
      narrationAudio: s.narrationAudio ? { ...s.narrationAudio } : null,
    }));
  const settings = () => ({ title, fps, width, height, bgm: bgm ? { url: bgm.url, kitName: bgm.kitName } : null, bgmLevel: 0.25 });

  async function run(kind: "kit" | "srt" | "preview") {
    setBusy(kind);
    setExported(null);
    setProgress("準備中…");
    try {
      const s = settings();
      const tl = await prepareTimeline(kitInputs(), s, setProgress);
      setTimeline(tl);
      if (kind === "srt") {
        downloadText(`${downloadBaseName(title)}.srt`, buildSrt(tl), "application/x-subrip;charset=utf-8");
        toast.success("字幕ファイル（SRT）をダウンロードしました");
      } else if (kind === "kit") {
        const folder = kitFolderName();
        if (folderMode) {
          await writeKitToFolder(tl, s, folder, setProgress);
          setExported("folder");
        } else {
          const blob = await buildKitZip(tl, s, folder, setProgress);
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${downloadBaseName(title)}.zip`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          setExported("zip");
        }
        toast.success("編集キットを書き出しました");
      }
    } catch (error) {
      // The user closed the folder picker.
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "書き出しに失敗しました。");
    } finally {
      setBusy(null);
      setProgress("");
    }
  }

  async function onPickBgm(file: File | undefined) {
    if (!file) return;
    setBgmProgress(0);
    const res = await uploadProjectBgm(uploadTarget, projectId, file, setBgmProgress);
    setBgmProgress(null);
    if (!res.ok) toast.error(res.error);
    else {
      toast.success("BGMを登録しました");
      router.refresh();
    }
  }

  if (shots.length === 0) {
    return (
      <EmptyState
        icon={<Clapperboard className="size-5" />}
        title={`${unit}がまだありません`}
        description="台本を解析してカット表を作り、素材をアップロードすると、Premiere Pro 用の編集キットを書き出せます。"
      />
    );
  }

  const clipById = new Map(timeline?.clips.map((c) => [c.shot.no, c]) ?? []);

  return (
    <div className="flex flex-col gap-5">
      {/* Intro + main actions */}
      <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold">Premiere Pro 用の編集キット</h2>
            <p className="mt-1 text-sm leading-relaxed text-fg-muted">
              採用素材（各{unit}の最新版）をカット順に並べたタイムライン、ナレーション、BGM、字幕をまとめて書き出します。
              Premiere Pro で <strong className="font-medium text-fg">timeline.xml</strong> を読み込むだけで、粗編集が済んだ状態から始められます。
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Stat ok={withVisual === shots.length} label={`映像・画像 ${withVisual}/${shots.length}`} />
              <Stat ok={withText === shots.length} label={`字幕テキスト ${withText}/${shots.length}`} />
              <Stat ok={withNarrationAudio > 0} neutral label={`ナレーション音声 ${withNarrationAudio}/${shots.length}`} />
              <Stat ok={!!bgm} neutral label={bgm ? "BGMあり" : "BGMなし"} />
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col lg:items-stretch">
            <Button variant="primary" size="md" onClick={() => void run("kit")} loading={busy === "kit"} disabled={!!busy}>
              {busy !== "kit" && (folderMode ? <FolderDown className="size-4" /> : <Download className="size-4" />)}
              編集キットを書き出す
            </Button>
            <Button onClick={() => void run("srt")} loading={busy === "srt"} disabled={!!busy}>
              {busy !== "srt" && <Captions className="size-4" />}
              字幕（SRT）だけダウンロード
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-fg-muted">フレームレート</span>
            <Select value={fps} onChange={(e) => setFps(Number(e.target.value))} className="h-8 w-28" disabled={!!busy}>
              {FPS_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f} fps
                </option>
              ))}
            </Select>
          </label>
          <span className="text-fg-muted">
            解像度 {width}×{height}（{aspectRatio}）
          </span>
          <span className="text-xs text-fg-subtle">
            {folderMode ? "保存先フォルダを選ぶと、そこに直接書き出します。" : "ZIPファイルでダウンロードします（大きな動画が多いと時間がかかります）。"}
          </span>
        </div>

        {busy && (
          <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-xs text-fg-muted" role="status">
            {progress}
          </p>
        )}

        {exported && (
          <div className="mt-4 rounded-lg border border-success/30 bg-success-soft p-4 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-success">
              <CheckCircle2 className="size-4" />
              書き出しました{exported === "zip" ? "（ZIPを展開してください）" : "（選んだ場所の EditKit_… フォルダ）"}
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-fg">
              <li>Premiere Pro で「ファイル → 読み込み」から <strong>timeline.xml</strong> を選ぶ</li>
              <li>「メディアをリンク」が出たら「検索」→ media フォルダの同名ファイルを1つ選ぶ（残りは自動でつながります）</li>
              <li>字幕は「ファイル → 読み込み」で <strong>subtitles.srt</strong> を読み込み、タイムラインへドラッグ</li>
            </ol>
          </div>
        )}
      </section>

      {/* BGM */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Music className="size-4 text-accent" />
          <h3 className="text-sm font-semibold">BGM</h3>
          <span className="text-xs text-fg-subtle">全体に1曲。約 -12dB に下げて配置します</span>
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
          {bgm && (
            <>
              <span className="max-w-60 truncate text-sm">{bgm.fileName}</span>
              <audio src={bgm.url} controls preload="none" className="h-8 max-w-64" />
            </>
          )}
          {bgmProgress !== null ? (
            <span className="text-xs text-fg-muted">アップロード中… {Math.round(bgmProgress * 100)}%</span>
          ) : (
            <Button size="xs" onClick={() => bgmInput.current?.click()} disabled={!!busy}>
              <Upload className="size-3.5" />
              {bgm ? "差し替える" : "BGMを登録"}
            </Button>
          )}
          {bgm && (
            <Button
              size="xs"
              variant="danger-ghost"
              disabled={!!busy}
              onClick={async () => {
                const res = await removeBgm(projectId);
                if (!res.ok) toast.error(res.error);
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
          <input
            ref={bgmInput}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              void onPickBgm(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </section>

      {/* Per-cut check */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">{unit}ごとの確認</h3>
            <p className="text-xs text-fg-muted">
              ナレーション音声は{unit}の素材欄に音声ファイルをアップロードすると使われます。長さはその音声に自動で合わせます。
            </p>
          </div>
          <Button size="xs" onClick={() => void run("preview")} loading={busy === "preview"} disabled={!!busy}>
            長さを計算して確認
          </Button>
        </div>
        {timeline && (
          <p className="border-b border-border bg-surface-2 px-4 py-2 text-xs text-fg-muted">
            全体の長さ <strong className="text-fg">{fmtSec(timeline.totalSec)}</strong>
            {bgm && " · BGMが全体より短い場合、BGMは途中で終わります"}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface-2 text-left text-xs text-fg-muted">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th className="w-20">No</th>
                <th className="w-40">映像・画像</th>
                <th className="w-32">ナレーション音声</th>
                <th>字幕テキスト</th>
                <th className="w-44">長さ</th>
              </tr>
            </thead>
            <tbody>
              {shots.map((s) => {
                const clip = clipById.get(s.no);
                const text = subtitleText(s);
                return (
                  <tr key={s.id} className="border-t border-border align-top [&>td]:px-3 [&>td]:py-2.5">
                    <td>
                      <Link href={`/projects/${projectId}/shots?shot=${s.id}`} className="font-mono text-xs font-medium text-accent hover:underline">
                        {s.label}
                      </Link>
                    </td>
                    <td className="text-xs">
                      {s.visual ? (
                        <span className="text-fg">
                          {s.visual.kind === "VIDEO" ? "動画" : "画像"} v{s.visual.version}
                        </span>
                      ) : (
                        <Warn>{s.visualExternalOnly ? "URL登録のみ（キットに含まれません）" : "未アップロード"}</Warn>
                      )}
                      {clip && clip.videoShortBySec > 0 && <Warn>動画が {clip.videoShortBySec}秒 足りません</Warn>}
                    </td>
                    <td className="text-xs">{s.narrationAudio ? <span className="text-success">あり</span> : <span className="text-fg-subtle">—</span>}</td>
                    <td className="text-xs leading-relaxed">
                      {text ? <span className="line-clamp-2 whitespace-pre-line">{text}</span> : <span className="text-fg-subtle">（セリフ・ナレーションなし）</span>}
                    </td>
                    <td className="text-xs">
                      {clip ? (
                        <span>
                          <strong className="font-medium">{clip.durationSec.toFixed(1)}秒</strong>
                          <span className="block text-fg-subtle">{LENGTH_SOURCE[clip.lengthSource]}</span>
                        </span>
                      ) : (
                        <span className="text-fg-muted">{s.plannedSec ? `${s.plannedSec}秒（予定）` : "—"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ ok, label, neutral }: { ok: boolean; label: string; neutral?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
        ok ? "bg-success-soft text-success" : neutral ? "bg-surface-3 text-fg-muted" : "bg-warning-soft text-warning",
      )}
    >
      {ok ? <CheckCircle2 className="size-3" /> : !neutral && <AlertTriangle className="size-3" />}
      {label}
    </span>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-warning">
      <AlertTriangle className="size-3 shrink-0" />
      {children}
    </span>
  );
}
