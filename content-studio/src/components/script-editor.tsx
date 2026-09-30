"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Wand2 } from "lucide-react";
import { analyzeScript } from "@/app/actions/analysis";
import { saveScript } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { SAMPLE_PROJECT } from "@/lib/sample";

type SaveState = "saved" | "dirty" | "saving";

export function ScriptEditor({
  projectId,
  initialScript,
  shotCount,
  unit,
  isMock,
}: {
  projectId: string;
  initialScript: string;
  shotCount: number;
  unit: string;
  isMock: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [script, setScript] = useState(initialScript);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [analyzing, startAnalyze] = useTransition();
  const lastSaved = useRef(initialScript);

  async function persist(value = script) {
    if (value === lastSaved.current) {
      setSaveState("saved");
      return true;
    }
    setSaveState("saving");
    const res = await saveScript(projectId, value);
    if (!res.ok) {
      setSaveState("dirty");
      toast.error(res.error);
      return false;
    }
    lastSaved.current = value;
    setSaveState("saved");
    return true;
  }

  // Autosave after typing pauses.
  useEffect(() => {
    if (script === lastSaved.current) return;
    const t = setTimeout(() => void persist(script), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script]);

  // Warn before leaving with unsaved text.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (script !== lastSaved.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [script]);

  function requestAnalyze() {
    if (!script.trim()) {
      toast.error("台本を入力してください。");
      return;
    }
    if (shotCount > 0) setConfirmOpen(true);
    else runAnalyze("replace");
  }

  function runAnalyze(mode: "replace" | "append") {
    setConfirmOpen(false);
    startAnalyze(async () => {
      if (!(await persist())) return;
      const res = await analyzeScript(projectId, mode);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const d = res.data;
      toast.success(
        `${d.shots}${unit}を作成しました（新規キャラクター ${d.createdCharacters}・新規ロケーション ${d.createdLocations}）`,
      );
      router.push(`/projects/${projectId}/shots`);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">台本</h2>
          <p className="text-xs text-fg-muted">
            台本や企画メモをそのまま貼り付けてください。「# シーン名」で区切るとシーン分けの精度が上がります。
          </p>
        </div>
        <span className="text-xs text-fg-subtle" aria-live="polite">
          {saveState === "saving" ? "保存中…" : saveState === "dirty" ? "未保存" : "保存済み"} · {script.length.toLocaleString()}文字
        </span>
      </div>

      <Textarea
        value={script}
        onChange={(e) => {
          setScript(e.target.value);
          setSaveState("dirty");
        }}
        onBlur={() => void persist()}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            void persist();
          }
        }}
        rows={18}
        spellCheck={false}
        placeholder={"# カフェ・朝\n高橋がカフェに入る。\n近藤が振り返る。\n高橋「久しぶり」\n二人が会話する。"}
        className="min-h-[360px] font-mono text-[13px] leading-6"
        disabled={analyzing}
        aria-label="台本"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {script.trim() === "" ? (
          <Button
            variant="ghost"
            onClick={() => {
              setScript(SAMPLE_PROJECT.script);
              setSaveState("dirty");
            }}
          >
            <Wand2 className="size-4" />
            サンプル台本を入れて試す
          </Button>
        ) : (
          <p className="text-xs text-fg-subtle">
            {isMock
              ? "デモモード：ルールベースで解析します。APIキーを設定するとClaudeが解析します。"
              : "解析には通常10〜60秒かかります。"}
          </p>
        )}
        <Button variant="primary" size="md" onClick={requestAnalyze} loading={analyzing} disabled={!script.trim()}>
          {!analyzing && <Sparkles className="size-4" />}
          {analyzing ? "解析中…" : `AIで解析して${unit}を作成`}
        </Button>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`既存の${unit}をどうしますか？`}
        description={`このプロジェクトには既に${shotCount}${unit}あります。キャラクター・ロケーションは上書きされず、新しいものだけ追加されます。`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={() => runAnalyze("append")}>末尾に追加</Button>
            <Button variant="danger" onClick={() => runAnalyze("replace")}>
              置き換える
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          「置き換える」を選ぶと、既存の{unit}とそのPrompt・アップロード済み素材は削除されます。
        </p>
      </Dialog>
    </div>
  );
}
