"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import type { ShotStatus } from "@/generated/prisma/enums";
import { createShot, deleteShot, moveShot, updateShot, updateShotsStatus, type ShotPatch } from "@/app/actions/shots";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { AssetsBlock } from "./assets-block";
import { PromptBlock } from "./prompt-block";
import { StatusSelect } from "./status-select";
import type { EntityOption, ShotRow } from "./types";
import type { UploadTarget } from "@/lib/upload-client";

export function ShotPanel({
  projectId,
  shot,
  number,
  total,
  unit,
  uploadTarget,
  characters,
  locations,
  onClose,
  onNavigate,
  onOpen,
}: {
  projectId: string;
  shot: ShotRow;
  number: number;
  total: number;
  unit: string;
  uploadTarget: UploadTarget;
  characters: EntityOption[];
  locations: EntityOption[];
  onClose: () => void;
  onNavigate: (dir: -1 | 1) => void;
  onOpen: (id: string | null) => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save(patch: ShotPatch) {
    setSaving(true);
    const res = await updateShot(shot.id, patch);
    setSaving(false);
    if (!res.ok) toast.error(res.error);
  }

  function setStatus(status: ShotStatus) {
    start(async () => {
      const res = await updateShotsStatus(projectId, [shot.id], status);
      if (!res.ok) toast.error(res.error);
    });
  }

  function toggleCharacter(id: string) {
    const next = shot.characterIds.includes(id) ? shot.characterIds.filter((c) => c !== id) : [...shot.characterIds, id];
    void save({ characterIds: next });
  }

  const label = `${unit} ${String(number).padStart(2, "0")}`;

  return (
    <aside
      className="animate-panel-in fixed inset-0 z-40 flex flex-col border-border bg-surface shadow-panel xl:inset-auto xl:top-12 xl:right-0 xl:bottom-0 xl:w-[560px] xl:border-l"
      aria-label={`${label} の詳細`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center">
          <button onClick={() => onNavigate(-1)} disabled={number <= 1} className="rounded p-1 text-fg-muted hover:bg-surface-2 disabled:opacity-30" aria-label="前へ">
            <ChevronLeft className="size-4" />
          </button>
          <button onClick={() => onNavigate(1)} disabled={number >= total} className="rounded p-1 text-fg-muted hover:bg-surface-2 disabled:opacity-30" aria-label="次へ">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <h2 className="font-mono text-sm font-semibold">{label}</h2>
        <span className="text-xs text-fg-subtle">/ {total}</span>
        <span className="text-xs text-fg-subtle" aria-live="polite">
          {saving ? "保存中…" : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <StatusSelect value={shot.status} onChange={setStatus} disabled={pending} className="w-40" />
          <button onClick={onClose} className="rounded p-1 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="閉じる">
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Content */}
        <section className="flex flex-col gap-3 border-b border-border p-4">
          <div className="grid grid-cols-[1fr_96px] gap-3">
            <TextField label="シーン" value={shot.scene} onSave={(v) => save({ scene: v })} />
            <Field label="秒数">
              <Input
                type="number"
                min={0}
                step={0.5}
                defaultValue={shot.durationSec ?? ""}
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v !== shot.durationSec) void save({ durationSec: v });
                }}
              />
            </Field>
          </div>
          <TextField label="内容" value={shot.description} multiline rows={3} onSave={(v) => save({ description: v })} />

          <Field label="登場人物" hint={characters.length === 0 ? "キャラクタータブで登録すると選べます" : "選んだキャラクターの設定がPromptに自動で入ります"}>
            <div className="flex flex-wrap gap-1.5">
              {characters.map((c) => {
                const on = shot.characterIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCharacter(c.id)}
                    aria-pressed={on}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors",
                      on ? "border-accent bg-accent-soft font-medium text-accent" : "border-border text-fg-muted hover:border-border-strong",
                    )}
                  >
                    {c.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.imageUrl} alt="" className="size-4 rounded-full object-cover" />
                    ) : null}
                    {c.name}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="場所">
            <Select value={shot.locationId ?? ""} onChange={(e) => void save({ locationId: e.target.value || null })}>
              <option value="">（なし）</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>

          <TextField label="アクション" value={shot.action} multiline rows={2} onSave={(v) => save({ action: v })} />
          <TextField label="セリフ" value={shot.dialogue} multiline rows={2} onSave={(v) => save({ dialogue: v })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="感情" value={shot.emotion} onSave={(v) => save({ emotion: v })} />
            <TextField label="時間帯" value={shot.timeOfDay} onSave={(v) => save({ timeOfDay: v })} />
            <TextField label="カメラ（サイズ・動き）" value={shot.camera} onSave={(v) => save({ camera: v })} />
            <TextField label="構図" value={shot.composition} onSave={(v) => save({ composition: v })} />
          </div>
          <TextField label="小道具" value={shot.props} onSave={(v) => save({ props: v })} />
        </section>

        {/* Prompts */}
        <section className="flex flex-col gap-4 border-b border-border p-4">
          {/* Keyed by prompt id so the editor resets when a new version arrives. */}
          <PromptBlock key={shot.imagePrompt?.id ?? "image"} projectId={projectId} shot={shot} kind="IMAGE" />
          <PromptBlock key={shot.videoPrompt?.id ?? "video"} projectId={projectId} shot={shot} kind="VIDEO" />
        </section>

        {/* Assets */}
        <section className="border-b border-border p-4">
          <AssetsBlock shot={shot} uploadTarget={uploadTarget} />
        </section>

        {/* Notes */}
        <section className="border-b border-border p-4">
          <TextField
            label="メモ・修正指示"
            value={shot.notes}
            multiline
            rows={3}
            placeholder="例：クライアント修正「表情をもう少し柔らかく」"
            onSave={(v) => save({ notes: v })}
          />
        </section>

        {/* Actions */}
        <section className="flex flex-wrap items-center gap-2 p-4">
          <Button
            size="xs"
            onClick={() =>
              start(async () => {
                const res = await moveShot(shot.id, "up");
                if (!res.ok) toast.error(res.error);
              })
            }
            disabled={pending || number <= 1}
          >
            <ArrowUp className="size-3.5" />
            上へ
          </Button>
          <Button
            size="xs"
            onClick={() =>
              start(async () => {
                const res = await moveShot(shot.id, "down");
                if (!res.ok) toast.error(res.error);
              })
            }
            disabled={pending || number >= total}
          >
            <ArrowDown className="size-3.5" />
            下へ
          </Button>
          <Button
            size="xs"
            onClick={() =>
              start(async () => {
                const res = await createShot(projectId, shot.id);
                if (!res.ok) toast.error(res.error);
                else onOpen(res.data.id);
              })
            }
            disabled={pending}
          >
            <Plus className="size-3.5" />
            この下に{unit}を追加
          </Button>
          <Button size="xs" variant="danger-ghost" className="ml-auto" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-3.5" />
            削除
          </Button>
        </section>
      </div>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`${label} を削除しますか？`}
        description="Prompt履歴とアップロードした素材も削除されます。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              キャンセル
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const res = await deleteShot(shot.id);
                  if (!res.ok) toast.error(res.error);
                  else {
                    setConfirmDelete(false);
                    onOpen(null);
                  }
                })
              }
            >
              削除する
            </Button>
          </>
        }
      />
    </aside>
  );
}

/** Text input that saves on blur when the value changed. */
function TextField({
  label,
  value,
  onSave,
  multiline,
  rows = 2,
  placeholder,
}: {
  label: string;
  value: string;
  onSave: (value: string) => void | Promise<void>;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft.trim() !== value.trim()) void onSave(draft);
  };
  return (
    <Field label={label}>
      {multiline ? (
        <Textarea rows={rows} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
      ) : (
        <Input value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
      )}
    </Field>
  );
}
