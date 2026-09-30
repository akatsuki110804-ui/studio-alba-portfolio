"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ImagePlus, MapPin, Plus, Sparkles, Trash2, UserRound } from "lucide-react";
import {
  createCharacter,
  createLocation,
  deleteCharacter,
  deleteLocation,
  generateCharacterSheet,
  generateLocationSheet,
  removeReferenceImage,
  updateCharacter,
  updateLocation,
} from "@/app/actions/bible";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { CopyButton, EmptyState } from "@/components/ui/misc";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { uploadFile } from "@/lib/upload-client";

export type BibleKind = "character" | "location";

export type BibleEntry = {
  id: string;
  name: string;
  aliases: string[];
  fields: Record<string, string>;
  promptName: string;
  promptDescription: string;
  imageUrl: string | null;
  shotCount: number;
};

const CONFIG = {
  character: {
    title: "キャラクター",
    icon: UserRound,
    fields: [
      { key: "age", label: "年齢", placeholder: "例：30代前半" },
      { key: "gender", label: "性別", placeholder: "例：男性" },
      { key: "build", label: "身長・体型", placeholder: "例：175cm・細身" },
      { key: "hairStyle", label: "髪型", placeholder: "例：短髪、センター分け" },
      { key: "hairColor", label: "髪色", placeholder: "例：黒" },
      { key: "outfit", label: "服装", placeholder: "例：ネイビーのスーツ、白シャツ" },
      { key: "appearance", label: "外見", placeholder: "例：切れ長の目、日焼けした肌", wide: true },
      { key: "vibe", label: "雰囲気", placeholder: "例：誠実で落ち着いている", wide: true },
      { key: "notes", label: "その他特徴", placeholder: "例：左手に腕時計、眼鏡", wide: true },
    ],
    summaryKeys: ["age", "gender", "hairStyle", "outfit"],
    emptyDescription: "台本を解析すると登場人物が自動で登録されます。手動で追加することもできます。",
  },
  location: {
    title: "ロケーション",
    icon: MapPin,
    fields: [
      { key: "timeOfDay", label: "時間帯", placeholder: "例：朝" },
      { key: "colors", label: "色", placeholder: "例：木目、ベージュ、グリーン" },
      { key: "lighting", label: "光", placeholder: "例：窓からのやわらかい自然光" },
      { key: "mood", label: "雰囲気", placeholder: "例：静かで温かい" },
      { key: "exterior", label: "外観", placeholder: "例：ガラス張りの路面店", wide: true },
      { key: "interior", label: "内装", placeholder: "例：木のカウンター、観葉植物、窓際の2人席", wide: true },
      { key: "props", label: "小道具", placeholder: "例：コーヒーカップ、ノートPC", wide: true },
      { key: "notes", label: "その他", placeholder: "", wide: true },
    ],
    summaryKeys: ["interior", "lighting", "mood"],
    emptyDescription: "台本を解析すると登場する場所が自動で登録されます。手動で追加することもできます。",
  },
} as const;

type Draft = {
  name: string;
  aliases: string;
  fields: Record<string, string>;
  promptName: string;
  promptDescription: string;
};

function toDraft(e?: BibleEntry): Draft {
  return {
    name: e?.name ?? "",
    aliases: e?.aliases.join("、") ?? "",
    fields: { ...(e?.fields ?? {}) },
    promptName: e?.promptName ?? "",
    promptDescription: e?.promptDescription ?? "",
  };
}

export function BibleBoard({ kind, projectId, entries }: { kind: BibleKind; projectId: string; entries: BibleEntry[] }) {
  const cfg = CONFIG[kind];
  const Icon = cfg.icon;
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const editing = editingId && editingId !== "new" ? entries.find((e) => e.id === editingId) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-fg-muted">
          ここで登録した設定は、各{kind === "character" ? "キャラクターが登場する" : "ロケーションを使う"}カットのPromptに
          <strong className="font-medium text-fg">毎回同じ英語描写で</strong>自動挿入されます。
        </p>
        <Button variant="primary" onClick={() => setEditingId("new")}>
          <Plus className="size-4" />
          {cfg.title}を追加
        </Button>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={<Icon className="size-5" />}
          title={`${cfg.title}がまだありません`}
          description={cfg.emptyDescription}
          action={
            <Button variant="primary" onClick={() => setEditingId("new")}>
              <Plus className="size-4" />
              {cfg.title}を追加
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {entries.map((e) => (
            <button
              key={e.id}
              onClick={() => setEditingId(e.id)}
              className="group flex gap-3 rounded-xl border border-border bg-surface p-3 text-left shadow-sm transition-colors hover:border-border-strong"
            >
              <div className="size-20 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                {e.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.imageUrl} alt="" className="size-full object-cover" />
                ) : (
                  <div className="grid size-full place-items-center text-fg-subtle">
                    <Icon className="size-6" />
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold group-hover:text-accent">{e.name}</span>
                  {e.aliases.length > 0 && <span className="truncate text-xs text-fg-subtle">{e.aliases.join("・")}</span>}
                </div>
                <p className="line-clamp-2 text-xs leading-relaxed text-fg-muted">
                  {cfg.summaryKeys.map((k) => e.fields[k]).filter(Boolean).join(" / ") || "設定未入力"}
                </p>
                <div className="mt-auto flex items-center gap-2 pt-1 text-[11px]">
                  {e.promptDescription ? (
                    <span className="text-success">Prompt描写 設定済み</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <AlertTriangle className="size-3" />
                      Prompt描写 未設定（生成時に自動作成）
                    </span>
                  )}
                  <span className="ml-auto text-fg-subtle">{e.shotCount}カット</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {editingId && (
        <BibleEditor
          key={editingId}
          kind={kind}
          projectId={projectId}
          entry={editing}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

function BibleEditor({
  kind,
  projectId,
  entry,
  onClose,
}: {
  kind: BibleKind;
  projectId: string;
  entry?: BibleEntry;
  onClose: () => void;
}) {
  const cfg = CONFIG[kind];
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(entry));
  const [saving, startSave] = useTransition();
  const [generating, startGenerate] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Set when a new entry is saved from inside the editor (e.g. by "AI生成"), so later saves update it.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const setField = (key: string, value: string) => setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: value } }));

  function payload() {
    return { name: draft.name, aliases: draft.aliases, promptName: draft.promptName, promptDescription: draft.promptDescription, ...draft.fields };
  }

  async function save(): Promise<string | null> {
    if (!draft.name.trim()) {
      toast.error("名前を入力してください。");
      return null;
    }
    const existingId = entry?.id ?? createdId;
    if (existingId) {
      const res = kind === "character" ? await updateCharacter(existingId, payload()) : await updateLocation(existingId, payload());
      if (!res.ok) {
        toast.error(res.error);
        return null;
      }
      return existingId;
    }
    const res = kind === "character" ? await createCharacter(projectId, payload()) : await createLocation(projectId, payload());
    if (!res.ok) {
      toast.error(res.error);
      return null;
    }
    setCreatedId(res.data.id);
    return res.data.id;
  }

  function onSave() {
    startSave(async () => {
      const id = await save();
      if (!id) return;
      toast.success("保存しました");
      router.refresh();
      onClose();
    });
  }

  function onGenerate() {
    startGenerate(async () => {
      // Save first so the AI sees the latest Japanese fields.
      const id = await save();
      if (!id) return;
      const res = kind === "character" ? await generateCharacterSheet(id) : await generateLocationSheet(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setDraft((d) => ({ ...d, promptName: res.data.promptName, promptDescription: res.data.promptDescription }));
      toast.success("Prompt用の英語描写を生成しました");
      router.refresh();
    });
  }

  async function onPickImage(file: File | undefined) {
    if (!file || !entry) return;
    setUploading(true);
    const res = await uploadFile(kind === "character" ? { purpose: "character", characterId: entry.id } : { purpose: "location", locationId: entry.id }, file);
    setUploading(false);
    if (!res.ok) toast.error(res.error);
    else router.refresh();
  }

  function onDelete() {
    if (!entry) return;
    startDelete(async () => {
      const res = kind === "character" ? await deleteCharacter(entry.id) : await deleteLocation(entry.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("削除しました");
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={entry ? `${entry.name} の設定` : `${cfg.title}を追加`}
      className="max-w-3xl"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {entry ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-danger">本当に削除しますか？</span>
                <Button variant="danger" size="xs" onClick={onDelete} loading={deleting}>
                  削除する
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setConfirmDelete(false)}>
                  やめる
                </Button>
              </div>
            ) : (
              <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" />
                削除
              </Button>
            )
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              キャンセル
            </Button>
            <Button variant="primary" onClick={onSave} loading={saving}>
              保存
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex shrink-0 flex-col items-center gap-2">
            <button
              type="button"
              disabled={!entry || uploading}
              onClick={() => fileRef.current?.click()}
              className={cn(
                "relative grid size-32 place-items-center overflow-hidden rounded-xl border border-dashed border-border-strong bg-surface-2 text-fg-subtle",
                entry && "hover:border-accent hover:text-accent",
              )}
              title={entry ? "参考画像をアップロード" : "保存後に画像を登録できます"}
            >
              {entry?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={entry.imageUrl} alt="" className="size-full object-cover" />
              ) : (
                <span className="flex flex-col items-center gap-1 text-xs">
                  <ImagePlus className="size-5" />
                  {entry ? "参考画像" : "保存後に登録"}
                </span>
              )}
              {uploading && (
                <span className="absolute inset-0 grid place-items-center bg-surface/70">
                  <Spinner />
                </span>
              )}
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => void onPickImage(e.target.files?.[0])} />
            {entry?.imageUrl && (
              <button
                type="button"
                className="text-xs text-fg-subtle hover:text-danger"
                onClick={async () => {
                  const res = await removeReferenceImage(kind, entry.id);
                  if (!res.ok) toast.error(res.error);
                  else router.refresh();
                }}
              >
                画像を外す
              </button>
            )}
          </div>

          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <Field label="名前" htmlFor="bible-name">
              <Input id="bible-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} autoFocus={!entry} />
            </Field>
            <Field label="別名（読点区切り）" htmlFor="bible-aliases" hint="台本での呼ばれ方。例：高橋さん、高橋部長">
              <Input id="bible-aliases" value={draft.aliases} onChange={(e) => setDraft((d) => ({ ...d, aliases: e.target.value }))} />
            </Field>
            {cfg.fields.map((f) => (
              <Field key={f.key} label={f.label} htmlFor={`bible-${f.key}`} className={"wide" in f && f.wide ? "sm:col-span-2" : undefined}>
                {"wide" in f && f.wide ? (
                  <Textarea id={`bible-${f.key}`} rows={2} placeholder={f.placeholder} value={draft.fields[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} />
                ) : (
                  <Input id={`bible-${f.key}`} placeholder={f.placeholder} value={draft.fields[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} />
                )}
              </Field>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-accent/30 bg-accent-soft/60 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Prompt用の固定描写（英語）</h3>
              <p className="text-xs text-fg-muted">全カットのPromptにこの文章がそのまま入ります。ここを直せば全カットに反映されます。</p>
            </div>
            <div className="flex items-center gap-1">
              <CopyButton text={draft.promptDescription} />
              <Button size="xs" onClick={onGenerate} loading={generating}>
                {!generating && <Sparkles className="size-3.5" />}
                上の設定からAI生成
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
            <Field label="Prompt内の呼び名" htmlFor="bible-pname">
              <Input
                id="bible-pname"
                placeholder={kind === "character" ? "Takahashi" : "Cozy Cafe"}
                value={draft.promptName}
                onChange={(e) => setDraft((d) => ({ ...d, promptName: e.target.value }))}
              />
            </Field>
            <Field label="描写" htmlFor="bible-pdesc">
              <Textarea
                id="bible-pdesc"
                rows={3}
                placeholder={
                  kind === "character"
                    ? "Japanese man in his early 30s, short black hair parted in the center, slim build, navy suit with white shirt, calm sincere expression"
                    : "small cozy cafe with wooden counter, beige walls, green plants, large windows with soft morning light"
                }
                value={draft.promptDescription}
                onChange={(e) => setDraft((d) => ({ ...d, promptDescription: e.target.value }))}
                className="font-mono text-[12.5px]"
              />
            </Field>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
