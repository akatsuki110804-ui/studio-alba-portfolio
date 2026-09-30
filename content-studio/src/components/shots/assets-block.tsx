"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileIcon, Link2, Trash2, Upload } from "lucide-react";
import { addExternalAssetVersion, deleteAssetVersion } from "@/app/actions/assets";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { ASSET_KINDS, assetKindLabel, formatBytes, formatDateTime } from "@/lib/labels";
import { uploadShotAsset, type UploadTarget } from "@/lib/upload-client";
import type { AssetRow, AssetVersionRow, ShotRow } from "./types";

type Kind = AssetRow["kind"];

export function AssetsBlock({ shot, uploadTarget }: { shot: ShotRow; uploadTarget: UploadTarget }) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [targetAssetId, setTargetAssetId] = useState<string | null>(null);

  async function upload(files: FileList | File[] | null, assetId: string | null = targetAssetId) {
    const list = files ? [...files] : [];
    if (list.length === 0) return;
    let uploaded = 0;
    for (const file of list) {
      setProgress(0);
      const res = await uploadShotAsset(uploadTarget, shot.id, assetId, file, setProgress);
      if (!res.ok) {
        toast.error(`${file.name}: ${res.error}`);
        break;
      }
      uploaded++;
    }
    setProgress(null);
    setTargetAssetId(null);
    if (uploaded > 0) {
      toast.success(`${uploaded}件の素材をアップロードしました`);
      router.refresh();
    }
  }

  const total = shot.assets.reduce((n, a) => n + a.versions.length, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">素材</h3>
        <span className="text-[11px] text-fg-subtle">{total > 0 ? `${total}ファイル` : ""}</span>
        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setLinkOpen((v) => !v)}>
          <Link2 className="size-3.5" />
          URLで登録
        </Button>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void upload(e.dataTransfer.files, null);
        }}
        onClick={() => {
          setTargetAssetId(null);
          inputRef.current?.click();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-4 text-center text-xs transition-colors",
          dragOver ? "border-accent bg-accent-soft text-accent" : "border-border-strong text-fg-muted hover:border-accent hover:text-accent",
        )}
      >
        {progress !== null ? (
          <>
            <span>アップロード中… {Math.round(progress * 100)}%</span>
            <div className="h-1 w-40 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />
            </div>
          </>
        ) : (
          <>
            <Upload className="size-4" />
            <span>画像・動画・ナレーション音声をドロップ、またはクリックして選択</span>
            <span className="text-fg-subtle">同じ種類は自動で v1 → v2 → v3 と版が増えます</span>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,video/*,audio/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          void upload(e.target.files);
          e.target.value = "";
        }}
      />

      {linkOpen && <ExternalLinkForm shotId={shot.id} onDone={() => setLinkOpen(false)} />}

      {shot.assets.map((asset) => (
        <AssetGroup
          key={asset.id}
          asset={asset}
          onUploadVersion={() => {
            setTargetAssetId(asset.id);
            inputRef.current?.click();
          }}
        />
      ))}
    </div>
  );
}

function AssetGroup({ asset, onUploadVersion }: { asset: AssetRow; onUploadVersion: () => void }) {
  // null = follow the latest version (so a fresh upload is shown immediately)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const latest = asset.versions[0];
  const current = asset.versions.find((v) => v.id === selectedId) ?? latest;
  if (!latest) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5">
        <span className="text-xs font-semibold">{asset.label || assetKindLabel(asset.kind)}</span>
        <span className="text-[11px] text-fg-subtle">{asset.versions.length}バージョン</span>
        <Button size="xs" variant="ghost" className="ml-auto" onClick={onUploadVersion}>
          <Upload className="size-3.5" />
          新しい版を追加
        </Button>
      </div>
      <Preview kind={asset.kind} version={current} isLatest={current.id === latest.id} />
      <ul className="divide-y divide-border border-t border-border">
        {asset.versions.map((v) => (
          <VersionRow key={v.id} version={v} isLatest={v.id === latest.id} active={v.id === current.id} onSelect={() => setSelectedId(v.id)} />
        ))}
      </ul>
    </div>
  );
}

function Preview({ kind, version, isLatest }: { kind: Kind; version: AssetVersionRow; isLatest: boolean }) {
  const media = version.url;
  return (
    <div className="relative bg-surface-3">
      {media && kind === "IMAGE" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media} alt={version.fileName} className="max-h-72 w-full object-contain" />
      ) : media && kind === "VIDEO" ? (
        <video key={media} src={media} controls playsInline preload="metadata" className="max-h-72 w-full bg-black" />
      ) : media && kind === "AUDIO" ? (
        <div className="p-3">
          <audio key={media} src={media} controls className="w-full" />
        </div>
      ) : (
        <a
          href={version.externalUrl ?? media ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 p-4 text-sm text-accent hover:underline"
        >
          {version.externalUrl ? <ExternalLink className="size-4" /> : <FileIcon className="size-4" />}
          <span className="truncate">{version.externalUrl ?? version.fileName}</span>
        </a>
      )}
      <span
        className={cn(
          "absolute top-2 left-2 rounded px-1.5 py-0.5 text-[11px] font-semibold",
          isLatest ? "bg-success text-white" : "bg-black/60 text-white",
        )}
      >
        v{version.version}
        {isLatest ? " 最新版" : " 旧版"}
      </span>
    </div>
  );
}

function VersionRow({ version, isLatest, active, onSelect }: { version: AssetVersionRow; isLatest: boolean; active: boolean; onSelect: () => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const href = version.externalUrl ?? version.url;

  return (
    <li className={cn("flex items-center gap-2 px-3 py-1.5 text-xs", active && "bg-accent-soft/50")}>
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className={cn("w-8 shrink-0 font-mono font-semibold", isLatest ? "text-success" : "text-fg-muted")}>v{version.version}</span>
        <span className="truncate">{version.fileName}</span>
        {version.note && <span className="truncate text-fg-subtle">— {version.note}</span>}
      </button>
      <span className="hidden shrink-0 text-fg-subtle sm:inline">
        {version.size > 0 ? `${formatBytes(version.size)} · ` : ""}
        {formatDateTime(version.createdAt)}
      </span>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" download={version.externalUrl ? undefined : version.fileName} className="rounded p-1 text-fg-muted hover:bg-surface-3" title="開く / ダウンロード">
          <ExternalLink className="size-3.5" />
        </a>
      )}
      {confirm ? (
        <Button
          size="xs"
          variant="danger"
          loading={pending}
          onClick={() =>
            start(async () => {
              const res = await deleteAssetVersion(version.id);
              if (!res.ok) toast.error(res.error);
            })
          }
          onBlur={() => setConfirm(false)}
        >
          削除
        </Button>
      ) : (
        <button onClick={() => setConfirm(true)} className="rounded p-1 text-fg-subtle hover:bg-danger-soft hover:text-danger" title="このバージョンを削除">
          <Trash2 className="size-3.5" />
        </button>
      )}
    </li>
  );
}

function ExternalLinkForm({ shotId, onDone }: { shotId: string; onDone: () => void }) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<Kind>("VIDEO");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await addExternalAssetVersion(shotId, { url, kind, note });
          if (!res.ok) toast.error(res.error);
          else {
            toast.success(`v${res.data.version} としてURLを登録しました`);
            onDone();
          }
        });
      }}
    >
      <p className="text-xs text-fg-muted">Google Drive・Dropbox などに置いた大きなファイルはURLで版管理できます。</p>
      <div className="flex gap-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="h-8 w-24 text-xs" aria-label="種類">
          {ASSET_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
        <Input type="url" required placeholder="https://drive.google.com/…" value={url} onChange={(e) => setUrl(e.target.value)} className="h-8 text-xs" />
      </div>
      <Input placeholder="メモ（任意）例：クライアント修正反映版" value={note} onChange={(e) => setNote(e.target.value)} className="h-8 text-xs" />
      <div className="flex justify-end gap-2">
        <Button size="xs" variant="ghost" onClick={onDone}>
          キャンセル
        </Button>
        <Button size="xs" variant="primary" type="submit" loading={pending}>
          登録
        </Button>
      </div>
    </form>
  );
}
