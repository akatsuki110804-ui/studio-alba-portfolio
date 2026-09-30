import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AssetKind } from "@/generated/prisma/enums";
import { assertCharacterAccess, assertLocationAccess, assertProjectAccess, assertShotAccess, assertUser } from "@/lib/access";
import { db } from "@/lib/db";
import { toErrorMessage, UserFacingError } from "@/lib/errors";
import { addAssetVersion, kindFromMime } from "@/lib/services/assets";
import { setProjectBgm } from "@/lib/services/bgm";
import { buildStorageKey, getStorage, maxUploadBytes } from "@/lib/storage";

// Files that could execute script when served from our origin are never accepted.
const BLOCKED_MIME = new Set(["image/svg+xml", "text/html", "application/xhtml+xml", "text/javascript", "application/javascript"]);

const FormSchema = z.discriminatedUnion("purpose", [
  z.object({
    purpose: z.literal("asset"),
    shotId: z.string().min(1),
    assetId: z.string().optional(),
    kind: z.enum(["IMAGE", "VIDEO", "AUDIO", "OTHER"]).optional(),
    note: z.string().max(500).optional(),
  }),
  z.object({ purpose: z.literal("character"), characterId: z.string().min(1) }),
  z.object({ purpose: z.literal("location"), locationId: z.string().min(1) }),
  z.object({ purpose: z.literal("bgm"), projectId: z.string().min(1) }),
]);

function fail(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const user = await assertUser();

    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > maxUploadBytes() + 1024 * 1024) {
      return fail(`ファイルサイズが上限（${Math.round(maxUploadBytes() / 1024 / 1024)}MB）を超えています。`, 413);
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return fail("ファイルが選択されていません。");
    if (file.size > maxUploadBytes()) {
      return fail(`ファイルサイズが上限（${Math.round(maxUploadBytes() / 1024 / 1024)}MB）を超えています。`, 413);
    }

    const mime = file.type || "application/octet-stream";
    if (BLOCKED_MIME.has(mime)) return fail("この形式のファイルはアップロードできません。");

    const fields = Object.fromEntries([...form.entries()].filter(([k, v]) => k !== "file" && typeof v === "string"));
    const parsed = FormSchema.safeParse(fields);
    if (!parsed.success) return fail("リクエストが不正です。");
    const input = parsed.data;

    const storage = getStorage();

    if (input.purpose === "asset") {
      const { projectId } = await assertShotAccess(input.shotId);
      const key = buildStorageKey(user.id, projectId, file.name);
      await storage.put(key, new Uint8Array(await file.arrayBuffer()), mime);
      const kind: AssetKind = input.kind ?? kindFromMime(mime);
      const version = await addAssetVersion({
        shotId: input.shotId,
        assetId: input.assetId || null,
        kind,
        storageKey: key,
        fileName: file.name,
        mimeType: mime,
        size: file.size,
        note: input.note,
      });
      revalidatePath(`/projects/${projectId}`, "layout");
      return Response.json({ ok: true, data: { versionId: version.id, version: version.version } });
    }

    if (input.purpose === "bgm") {
      const { projectId } = await assertProjectAccess(input.projectId);
      if (!mime.startsWith("audio/")) throw new UserFacingError("BGMには音声ファイル（mp3・wav・m4a など）を選択してください。");
      const key = buildStorageKey(user.id, projectId, file.name);
      await storage.put(key, new Uint8Array(await file.arrayBuffer()), mime);
      await setProjectBgm(projectId, { key, fileName: file.name, mimeType: mime, size: file.size });
      revalidatePath(`/projects/${projectId}`, "layout");
      return Response.json({ ok: true, data: { key } });
    }

    if (!mime.startsWith("image/")) throw new UserFacingError("参考画像には画像ファイルを選択してください。");

    if (input.purpose === "character") {
      const { projectId } = await assertCharacterAccess(input.characterId);
      const current = await db.character.findUniqueOrThrow({ where: { id: input.characterId } });
      const key = buildStorageKey(user.id, projectId, file.name);
      await storage.put(key, new Uint8Array(await file.arrayBuffer()), mime);
      // Keep updatedAt: a reference image doesn't change the text prompt, so prompts shouldn't go stale.
      await db.character.update({
        where: { id: current.id },
        data: { imageKey: key, updatedAt: current.updatedAt },
      });
      if (current.imageKey) await storage.delete(current.imageKey).catch(() => undefined);
      revalidatePath(`/projects/${projectId}`, "layout");
      return Response.json({ ok: true, data: { imageKey: key } });
    }

    const { projectId } = await assertLocationAccess(input.locationId);
    const current = await db.location.findUniqueOrThrow({ where: { id: input.locationId } });
    const key = buildStorageKey(user.id, projectId, file.name);
    await storage.put(key, new Uint8Array(await file.arrayBuffer()), mime);
    await db.location.update({
      where: { id: current.id },
      data: { imageKey: key, updatedAt: current.updatedAt },
    });
    if (current.imageKey) await storage.delete(current.imageKey).catch(() => undefined);
    revalidatePath(`/projects/${projectId}`, "layout");
    return Response.json({ ok: true, data: { imageKey: key } });
  } catch (error) {
    const status = error instanceof UserFacingError ? 400 : 500;
    return fail(toErrorMessage(error), status);
  }
}
