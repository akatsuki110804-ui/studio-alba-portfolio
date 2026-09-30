// Browser-only: measures media, then writes the edit kit to a folder (or a ZIP).
import { Zip, ZipPassThrough } from "fflate";
import { buildPremiereXml, buildSrt, buildTimeline, type KitMedia, type KitSettings, type KitShotInput, type Timeline } from "./timeline";

export type Progress = (message: string) => void;

/** Reads a media file's length via a detached <audio>/<video> element. */
export function probeDuration(url: string, kind: "audio" | "video", timeoutMs = 20_000): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    el.preload = "metadata";
    el.muted = true;
    const done = (value: number | null) => {
      clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => done(null);
    el.src = url;
  });
}

async function probeAll(shots: KitShotInput[], bgm: KitMedia | null, onProgress: Progress) {
  const jobs: { media: KitMedia; kind: "audio" | "video" }[] = [];
  for (const s of shots) {
    if (s.visual?.kind === "VIDEO") jobs.push({ media: s.visual, kind: "video" });
    if (s.narrationAudio) jobs.push({ media: s.narrationAudio, kind: "audio" });
  }
  if (bgm) jobs.push({ media: bgm, kind: "audio" });
  let done = 0;
  for (let i = 0; i < jobs.length; i += 4) {
    await Promise.all(
      jobs.slice(i, i + 4).map(async (j) => {
        j.media.durationSec = await probeDuration(j.media.url, j.kind);
        onProgress(`長さを確認中… ${++done}/${jobs.length}`);
      }),
    );
  }
}

/** Measures media and computes the timeline (used for preview and for the SRT-only download). */
export async function prepareTimeline(shots: KitShotInput[], settings: KitSettings, onProgress: Progress): Promise<Timeline> {
  await probeAll(shots, settings.bgm, onProgress);
  return buildTimeline(shots, settings.fps);
}

const README = (title: string) => `「${title}」編集キット

■ Premiere Pro での読み込み手順
1. Premiere Pro でプロジェクトを開く（新規でOK）
2. ファイル → 読み込み → このフォルダの timeline.xml を選択
   → カット順に並んだシーケンスができます（V1: 映像 / A1: ナレーション / A2: BGM）
3.「メディアをリンク」画面が出たら「検索」を押し、media フォルダ内の同名ファイルを1つ選ぶ
   （「他のファイルも自動で再リンク」にチェックが入っていれば、残りも自動でつながります）
4. 字幕：ファイル → 読み込み → subtitles.srt を選び、タイムラインへドラッグ

■ メモ
- シーケンスのマーカーに、各カットの修正メモが入っています
- カットの長さは、ナレーション音声がある場合はその長さに自動で合わせています
- BGM は約 -12dB に下げて配置しています
`;

type KitFile = { path: string; source: { url: string } | { text: string } };

function kitFiles(timeline: Timeline, settings: KitSettings): KitFile[] {
  const files: KitFile[] = [
    { path: "timeline.xml", source: { text: buildPremiereXml(timeline, settings) } },
    { path: "subtitles.srt", source: { text: buildSrt(timeline) } },
    { path: "README.txt", source: { text: README(settings.title) } },
  ];
  for (const c of timeline.clips) {
    if (c.shot.visual) files.push({ path: `media/${c.shot.visual.kitName}`, source: { url: c.shot.visual.url } });
    if (c.shot.narrationAudio) files.push({ path: `media/${c.shot.narrationAudio.kitName}`, source: { url: c.shot.narrationAudio.url } });
  }
  if (settings.bgm) files.push({ path: `media/${settings.bgm.kitName}`, source: { url: settings.bgm.url } });
  return files;
}

async function fetchBody(url: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`素材の取得に失敗しました（${res.status}）`);
  return res.body;
}

type DirHandle = {
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>;
};

export function canWriteFolder() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** Chrome / Edge: streams every file straight into a folder the user picks (no memory limit). */
export async function writeKitToFolder(timeline: Timeline, settings: KitSettings, folderName: string, onProgress: Progress) {
  const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker;
  const root = await picker({ mode: "readwrite" });
  const kitDir = await root.getDirectoryHandle(folderName, { create: true });
  const mediaDir = await kitDir.getDirectoryHandle("media", { create: true });
  const files = kitFiles(timeline, settings);
  let n = 0;
  for (const f of files) {
    onProgress(`保存中… ${++n}/${files.length}（${f.path}）`);
    const dir = f.path.startsWith("media/") ? mediaDir : kitDir;
    const handle = await dir.getFileHandle(f.path.replace(/^media\//, ""), { create: true });
    const writable = await handle.createWritable();
    if ("text" in f.source) {
      const w = writable.getWriter();
      await w.write(new TextEncoder().encode(f.source.text));
      await w.close();
    } else {
      await (await fetchBody(f.source.url)).pipeTo(writable);
    }
  }
}

/** Other browsers: builds an uncompressed ZIP (media is already compressed). */
export async function buildKitZip(timeline: Timeline, settings: KitSettings, folderName: string, onProgress: Progress): Promise<Blob> {
  const parts: Uint8Array[] = [];
  let failed: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) failed = err;
    else parts.push(chunk);
  });
  const files = kitFiles(timeline, settings);
  let n = 0;
  for (const f of files) {
    onProgress(`まとめています… ${++n}/${files.length}（${f.path}）`);
    const entry = new ZipPassThrough(`${folderName}/${f.path}`);
    zip.add(entry);
    if ("text" in f.source) {
      entry.push(new TextEncoder().encode(f.source.text), true);
    } else {
      const reader = (await fetchBody(f.source.url)).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        entry.push(value);
      }
      entry.push(new Uint8Array(0), true);
    }
    if (failed) throw failed;
  }
  zip.end();
  if (failed) throw failed;
  return new Blob(parts as BlobPart[], { type: "application/zip" });
}
