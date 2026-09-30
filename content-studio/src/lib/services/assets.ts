import "server-only";
import type { AssetKind } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { UserFacingError } from "@/lib/errors";
import { advanceShotStatus } from "./status";

export function kindFromMime(mime: string): AssetKind {
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.startsWith("audio/")) return "AUDIO";
  return "OTHER";
}

/**
 * Adds a new version to an asset slot of a shot. Without assetId, the version goes to
 * the shot's first slot of that kind (created on demand) — so "upload image" always
 * produces image v1, v2, v3… with no extra clicks.
 */
export async function addAssetVersion(input: {
  shotId: string;
  kind: AssetKind;
  assetId?: string | null;
  storageKey?: string | null;
  externalUrl?: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  note?: string;
}) {
  const version = await db.$transaction(async (tx) => {
    let asset = input.assetId
      ? await tx.asset.findFirst({ where: { id: input.assetId, shotId: input.shotId } })
      : await tx.asset.findFirst({ where: { shotId: input.shotId, kind: input.kind }, orderBy: { createdAt: "asc" } });

    if (input.assetId && !asset) throw new UserFacingError("素材スロットが見つかりません。");
    if (!asset) {
      asset = await tx.asset.create({ data: { shotId: input.shotId, kind: input.kind } });
    }

    const latest = await tx.assetVersion.findFirst({
      where: { assetId: asset.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    const created = await tx.assetVersion.create({
      data: {
        assetId: asset.id,
        version: (latest?.version ?? 0) + 1,
        storageKey: input.storageKey ?? null,
        externalUrl: input.externalUrl ?? null,
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: input.size,
        note: input.note ?? "",
      },
    });
    await tx.asset.update({ where: { id: asset.id }, data: { updatedAt: new Date() } });
    return created;
  });

  const kind = input.assetId
    ? ((await db.asset.findUnique({ where: { id: input.assetId }, select: { kind: true } }))?.kind ?? input.kind)
    : input.kind;
  if (kind === "IMAGE") await advanceShotStatus([input.shotId], "IMAGE_DONE");
  if (kind === "VIDEO") await advanceShotStatus([input.shotId], "VIDEO_DONE");

  return version;
}
