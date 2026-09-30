"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Wand2 } from "lucide-react";
import { createProject, updateProject, type ProjectFormState } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { PROJECT_FORMATS, PROJECT_STATUSES } from "@/lib/labels";
import { SAMPLE_PROJECT } from "@/lib/sample";
import type { ProjectFormat, ProjectStatus } from "@/generated/prisma/enums";

export type ProjectFormValues = {
  title: string;
  description: string;
  format: ProjectFormat;
  platform: string;
  aspectRatio: string;
  dueDate: string; // yyyy-mm-dd
  status: ProjectStatus;
  styleGuide: string;
};

const ASPECT_RATIOS = ["9:16", "16:9", "1:1", "4:5", "4:3", "21:9"];

const EMPTY: ProjectFormValues = {
  title: "",
  description: "",
  format: "SHORT_VIDEO",
  platform: "",
  aspectRatio: "9:16",
  dueDate: "",
  status: "PLANNING",
  styleGuide: "",
};

export function ProjectForm({ projectId, initial }: { projectId?: string; initial?: ProjectFormValues }) {
  const isEdit = !!projectId;
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<ProjectFormValues>(initial ?? EMPTY);
  const [script, setScript] = useState("");
  const [saving, setSaving] = useState(false);
  const [createState, createAction, creating] = useActionState<ProjectFormState, FormData>(createProject, undefined);

  const set = <K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function onEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    setSaving(true);
    const res = await updateProject(projectId, values);
    setSaving(false);
    if (res.ok) {
      toast.success("プロジェクト設定を保存しました");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  function fillSample() {
    setValues((v) => ({ ...v, title: SAMPLE_PROJECT.title, platform: SAMPLE_PROJECT.platform, styleGuide: SAMPLE_PROJECT.styleGuide }));
    setScript(SAMPLE_PROJECT.script);
  }

  return (
    <form action={isEdit ? undefined : createAction} onSubmit={isEdit ? onEditSubmit : undefined} className="flex flex-col gap-5">
      {!isEdit && createState?.error && (
        <div role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {createState.error}
        </div>
      )}

      <Field label="タイトル" htmlFor="title">
        <Input
          id="title"
          name="title"
          required
          maxLength={120}
          placeholder="例：日本創芸教育 第10話"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="制作形式" htmlFor="format">
          <Select id="format" name="format" value={values.format} onChange={(e) => set("format", e.target.value as ProjectFormat)}>
            {PROJECT_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="SNS / 媒体" htmlFor="platform">
          <Input
            id="platform"
            name="platform"
            placeholder="例：TikTok"
            value={values.platform}
            onChange={(e) => set("platform", e.target.value)}
          />
        </Field>
        <Field label="アスペクト比" htmlFor="aspectRatio">
          <Select id="aspectRatio" name="aspectRatio" value={values.aspectRatio} onChange={(e) => set("aspectRatio", e.target.value)}>
            {ASPECT_RATIOS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="納期" htmlFor="dueDate">
          <Input id="dueDate" name="dueDate" type="date" value={values.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
        </Field>
        <Field label="ステータス" htmlFor="status">
          <Select id="status" name="status" value={values.status} onChange={(e) => set("status", e.target.value as ProjectStatus)}>
            {PROJECT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="説明" htmlFor="description">
        <Textarea
          id="description"
          name="description"
          rows={2}
          placeholder="クライアント、目的、注意点など"
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>

      <Field
        label="映像トーン / スタイル（全Promptに反映）"
        htmlFor="styleGuide"
        hint="例：cinematic, soft natural light, warm film grading。英語で書くと画像・動画AIに伝わりやすくなります。"
      >
        <Textarea
          id="styleGuide"
          name="styleGuide"
          rows={2}
          value={values.styleGuide}
          onChange={(e) => set("styleGuide", e.target.value)}
        />
      </Field>

      {!isEdit && (
        <Field label="台本（あとからでも入力できます）" htmlFor="script">
          <Textarea
            id="script"
            name="script"
            rows={8}
            placeholder={"高橋がカフェに入る。\n近藤が振り返る。\n二人が会話する。"}
            value={script}
            onChange={(e) => setScript(e.target.value)}
            className="font-mono text-[13px]"
          />
        </Field>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        {!isEdit ? (
          <Button variant="ghost" onClick={fillSample}>
            <Wand2 className="size-4" />
            サンプルを入力
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="primary" size="md" loading={isEdit ? saving : creating}>
          {isEdit ? "設定を保存" : "プロジェクトを作成"}
        </Button>
      </div>
    </form>
  );
}
