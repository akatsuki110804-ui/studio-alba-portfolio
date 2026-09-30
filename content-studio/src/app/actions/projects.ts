"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertProjectAccess, assertUser } from "@/lib/access";
import { parseInput, runAction } from "@/lib/action";
import { db } from "@/lib/db";
import { toErrorMessage } from "@/lib/errors";
import { getStorage } from "@/lib/storage";

const FORMATS = ["SHORT_VIDEO", "YOUTUBE", "SNS_POST", "WEB_AD", "PRODUCT_PR", "IMAGE_AD", "MANGA", "OTHER"] as const;
const STATUSES = ["PLANNING", "IN_PROGRESS", "REVIEW", "DELIVERED", "ARCHIVED"] as const;

const ProjectFields = z.object({
  title: z.string().trim().min(1, "タイトルを入力してください。").max(120, "タイトルは120文字以内にしてください。"),
  description: z.string().trim().max(2000).default(""),
  format: z.enum(FORMATS).default("SHORT_VIDEO"),
  platform: z.string().trim().max(80).default(""),
  aspectRatio: z.string().trim().max(20).default("9:16"),
  dueDate: z
    .string()
    .trim()
    .default("")
    .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), "納期の日付が正しくありません。")
    .transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null)),
  status: z.enum(STATUSES).default("PLANNING"),
  styleGuide: z.string().trim().max(2000).default(""),
});

export type ProjectFormState = { error?: string } | undefined;

export async function createProject(_prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  let projectId: string;
  try {
    const user = await assertUser();
    const data = parseInput(ProjectFields, Object.fromEntries(formData));
    const script = String(formData.get("script") ?? "").slice(0, 100_000);
    const project = await db.project.create({ data: { ...data, script, ownerId: user.id } });
    projectId = project.id;
  } catch (error) {
    return { error: toErrorMessage(error) };
  }
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}

export async function updateProject(projectId: string, input: z.input<typeof ProjectFields>) {
  return runAction(async () => {
    await assertProjectAccess(projectId);
    const data = parseInput(ProjectFields, input);
    const before = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { styleGuide: true, aspectRatio: true },
    });
    const promptContextChanged = before.styleGuide !== data.styleGuide || before.aspectRatio !== data.aspectRatio;
    await db.project.update({
      where: { id: projectId },
      data: { ...data, ...(promptContextChanged ? { promptContextUpdatedAt: new Date() } : {}) },
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    revalidatePath("/projects");
  });
}

export async function updateProjectStatus(projectId: string, status: (typeof STATUSES)[number]) {
  return runAction(async () => {
    await assertProjectAccess(projectId);
    await db.project.update({ where: { id: projectId }, data: { status: parseInput(z.enum(STATUSES), status) } });
    revalidatePath(`/projects/${projectId}`, "layout");
    revalidatePath("/projects");
  });
}

export async function saveScript(projectId: string, script: string) {
  return runAction(async () => {
    await assertProjectAccess(projectId);
    const value = parseInput(z.string().max(100_000, "台本は10万文字以内にしてください。"), script);
    await db.project.update({ where: { id: projectId }, data: { script: value } });
    revalidatePath(`/projects/${projectId}`);
  });
}

export async function deleteProject(projectId: string) {
  const result = await runAction(async () => {
    await assertProjectAccess(projectId);
    // Collect stored files first; DB rows cascade.
    const [chars, locs, versions] = await Promise.all([
      db.character.findMany({ where: { projectId, imageKey: { not: null } }, select: { imageKey: true } }),
      db.location.findMany({ where: { projectId, imageKey: { not: null } }, select: { imageKey: true } }),
      db.assetVersion.findMany({
        where: { asset: { shot: { projectId } }, storageKey: { not: null } },
        select: { storageKey: true },
      }),
    ]);
    const { bgmKey } = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { bgmKey: true } });
    await db.project.delete({ where: { id: projectId } });
    const keys = [bgmKey, ...chars.map((c) => c.imageKey), ...locs.map((l) => l.imageKey), ...versions.map((v) => v.storageKey)];
    const storage = getStorage();
    await Promise.all(keys.filter((k): k is string => !!k).map((k) => storage.delete(k).catch(() => undefined)));
  });
  if (!result.ok) return result;
  revalidatePath("/projects");
  redirect("/projects");
}
