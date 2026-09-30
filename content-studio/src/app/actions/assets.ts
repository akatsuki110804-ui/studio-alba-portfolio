"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAssetVersionAccess, assertShotAccess } from "@/lib/access";
import { parseInput, runAction } from "@/lib/action";
import { db } from "@/lib/db";
import { UserFacingError } from "@/lib/errors";
import { addAssetVersion, kindFromMime } from "@/lib/services/assets";
import { getStorage, isValidProjectKey } from "@/lib/storage";

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

const RegisterSchema = z.object({
  key: z.string().min(1).max(500),
  fileName: z.string().trim().min(1).max(300),
  assetId: z.string().optional(),
});

/**
 * Records a file the browser uploaded directly to storage as a new version.
 * Size and type come from the storage itself, not from the client.
 */
export async function registerUploadedAsset(shotId: string, input: z.input<typeof RegisterSchema>) {
  return runAction(async () => {
    const { user, projectId } = await assertShotAccess(shotId);
    const data = parseInput(RegisterSchema, input);
    if (!isValidProjectKey(data.key, user.id, projectId)) throw new UserFacingError("アップロード先が不正です。");

    const stored = await getStorage().head(data.key);
    if (!stored) throw new UserFacingError("アップロードしたファイルが見つかりません。もう一度お試しください。");

    const already = await db.assetVersion.findFirst({ where: { storageKey: data.key }, select: { version: true } });
    if (already) return { version: already.version };

    const v = await addAssetVersion({
      shotId,
      assetId: data.assetId || null,
      kind: kindFromMime(stored.contentType),
      storageKey: data.key,
      fileName: data.fileName,
      mimeType: stored.contentType,
      size: stored.size,
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
