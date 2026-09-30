"use client";

import { useState, useTransition } from "react";
import { deleteProject } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

export function DeleteProject({ projectId, title }: { projectId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();

  return (
    <>
      <Button variant="danger-ghost" onClick={() => setOpen(true)}>
        プロジェクトを削除
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="プロジェクトを削除しますか？"
        description="カット・Prompt・キャラクター・ロケーション・アップロードした素材がすべて削除され、元に戻せません。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              キャンセル
            </Button>
            <Button
              variant="danger"
              disabled={confirm !== title}
              loading={pending}
              onClick={() =>
                start(async () => {
                  const res = await deleteProject(projectId);
                  // On success the action redirects; we only get here on failure.
                  if (res && !res.ok) toast.error(res.error);
                })
              }
            >
              削除する
            </Button>
          </>
        }
      >
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-muted">
            確認のため、プロジェクト名「<strong className="text-fg">{title}</strong>」を入力してください。
          </span>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
      </Dialog>
    </>
  );
}
