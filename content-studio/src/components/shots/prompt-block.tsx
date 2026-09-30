"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, History, Sparkles } from "lucide-react";
import { generatePrompts, savePrompt } from "@/app/actions/prompts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { CopyButton } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/labels";
import type { ShotRow } from "./types";

export function PromptBlock({ projectId, shot, kind }: { projectId: string; shot: ShotRow; kind: "IMAGE" | "VIDEO" }) {
  const toast = useToast();
  const prompt = kind === "IMAGE" ? shot.imagePrompt : shot.videoPrompt;
  const [draft, setDraft] = useState(prompt?.content ?? "");
  const [showHistory, setShowHistory] = useState(false);
  const [generating, startGenerate] = useTransition();
  const [saving, startSave] = useTransition();
  const history = shot.promptHistory.filter((p) => p.kind === kind);
  const dirty = draft.trim() !== (prompt?.content ?? "").trim();
  const title = kind === "IMAGE" ? "画像生成Prompt" : "動画生成Prompt";

  function regenerate() {
    startGenerate(async () => {
      const res = await generatePrompts(projectId, "selected", [shot.id]);
      if (!res.ok) toast.error(res.error);
      else toast.success("Promptを再生成しました");
    });
  }

  function save() {
    startSave(async () => {
      const res = await savePrompt(shot.id, kind, draft);
      if (!res.ok) toast.error(res.error);
      else toast.success("手動編集を新しいバージョンとして保存しました");
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {prompt && (
          <span className="text-[11px] text-fg-subtle">
            v{prompt.version} · {prompt.source === "AI" ? "AI生成" : "手動編集"} · {formatDateTime(prompt.createdAt)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {history.length > 1 && (
            <Button size="xs" variant="ghost" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
              <History className="size-3.5" />
              履歴
            </Button>
          )}
          <Button size="xs" variant="ghost" onClick={regenerate} loading={generating}>
            {!generating && <Sparkles className="size-3.5" />}
            {prompt ? "再生成" : "生成"}
          </Button>
        </div>
      </div>

      {prompt?.stale && (
        <div className="flex items-start gap-1.5 rounded-md bg-warning-soft px-2.5 py-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          このPromptの作成後に、カット内容・キャラクター・ロケーション・映像トーンが変更されています。
        </div>
      )}

      {prompt || draft ? (
        <>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={kind === "IMAGE" ? 7 : 5}
            className="font-mono text-[12.5px] leading-relaxed"
            aria-label={title}
          />
          <div className="flex items-center gap-2">
            <CopyButton text={draft} label="Promptをコピー" className="h-8 bg-accent-soft px-3 text-accent hover:bg-accent-soft hover:text-accent" />
            {dirty && (
              <>
                <Button size="xs" variant="primary" onClick={save} loading={saving}>
                  編集を保存
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setDraft(prompt?.content ?? "")}>
                  元に戻す
                </Button>
              </>
            )}
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={regenerate}
          disabled={generating}
          className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-center text-xs text-fg-muted hover:border-accent hover:text-accent"
        >
          {generating ? "生成中…" : "まだPromptがありません。クリックしてキャラクター・ロケーション設定込みで生成"}
        </button>
      )}

      {showHistory && (
        <ol className="flex flex-col gap-1.5 rounded-lg bg-surface-2 p-2">
          {history.map((h) => (
            <li key={h.id} className="rounded-md bg-surface p-2">
              <div className="mb-1 flex items-center gap-2 text-[11px] text-fg-subtle">
                <span className="font-medium text-fg">v{h.version}</span>
                {h.source === "AI" ? "AI生成" : "手動編集"} · {formatDateTime(h.createdAt)}
                <div className="ml-auto flex gap-1">
                  <CopyButton text={h.content} size="xs" iconOnly />
                  <button type="button" className="rounded px-1.5 text-[11px] hover:bg-surface-3" onClick={() => setDraft(h.content)}>
                    この版を編集欄へ
                  </button>
                </div>
              </div>
              <p className="line-clamp-3 font-mono text-[11px] text-fg-muted">{h.content}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
