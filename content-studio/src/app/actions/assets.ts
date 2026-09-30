"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAssetVersionAccess, assertShotAccess } from "@/lib/access";
import { parseInput, runAction } from "@/lib/action";
import { db } from "@/lib/db";
import { addAssetVersion } from "@/lib/services/assets";
import { getStorage } from "@/lib/storage";

const ExternalSchema = z.object({
  url: z
    .url("URLの形式が正しくありません。")
    .refine((u) => /^https?:\/\//i.test(u), "http(s) のURLを入力してください。"),
  kind: z.enum(["IMAGE", "VIDEO", "AUDIO", "OTHER"]),
  label: z.string().trim().max(200).default(""),
  note: z.string().trim().max(500).default(""),
});

/** Registers an external link (Google Drive, Dropbox, Frame.io…) as a new version. */
export async function addExternalAssetVersion(shotId: string, input: z.input<typeof ExternalSchema>) {
  return runAction(async () => {
    const { projectId } = await assertShotAccess(shotId);
    const data = parseInput(ExternalSchema, input);
    const v = await addAssetVersion({
      shotId,
      kind: data.kind,
      externalUrl: data.url,
      fileName: data.label || new URL(data.url).hostname,
      mimeType: "",
      size: 0,
      note: data.note,
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    return { version: v.version };
  });
}

export async function deleteAssetVersion(versionId: string) {
  return runAction(async () => {
    const { version, projectId } = await assertAssetVersionAccess(versionId);
    await db.assetVersion.delete({ where: { id: versionId } });
    const remaining = await db.assetVersion.count({ where: { assetId: version.asset.id } });
    if (remaining === 0) await db.asset.delete({ where: { id: version.asset.id } });
    if (version.storageKey) await getStorage().delete(version.storageKey).catch(() => undefined);
    revalidatePath(`/projects/${projectId}`, "layout");
  });
}
