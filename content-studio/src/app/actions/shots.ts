"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertProjectAccess, assertShotAccess } from "@/lib/access";
import { parseInput, runAction } from "@/lib/action";
import { db } from "@/lib/db";
import { UserFacingError } from "@/lib/errors";
import { getStorage } from "@/lib/storage";

const SHOT_STATUSES = ["TODO", "PROMPT_READY", "IMAGE_DONE", "VIDEO_DONE", "REVISING", "DONE"] as const;

const text = (max = 2000) => z.string().trim().max(max);

const ShotPatchSchema = z
  .object({
    scene: text(120),
    description: text(),
    action: text(),
    dialogue: text(),
    narration: text(5000),
    emotion: text(300),
    timeOfDay: text(100),
    props: text(1000),
    camera: text(300),
    composition: text(500),
    durationSec: z.number().min(0).max(3600).nullable(),
    notes: text(5000),
    locationId: z.string().nullable(),
    characterIds: z.array(z.string()).max(50),
  })
  .partial();

export type ShotPatch = z.input<typeof ShotPatchSchema>;

// Fields that change what the prompt should say. `notes` (revision memo) intentionally excluded.
const PROMPT_FIELDS = new Set([
  "scene", "description", "action", "dialogue", "emotion", "timeOfDay", "props", "camera", "composition",
  "durationSec", "locationId", "characterIds",
]);

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function createShot(projectId: string, afterShotId?: string | null) {
  return runAction(async () => {
    await assertProjectAccess(projectId);
    const shot = await db.$transaction(async (tx) => {
      let order: number;
      if (afterShotId) {
        const after = await tx.shot.findFirst({ where: { id: afterShotId, projectId }, select: { order: true, scene: true, locationId: true } });
        if (!after) throw new UserFacingError("カットが見つかりません。");
        order = after.order + 1;
        await tx.shot.updateMany({ where: { projectId, order: { gte: order } }, data: { order: { increment: 1 } } });
        return tx.shot.create({ data: { projectId, order, scene: after.scene, locationId: after.locationId } });
      }
      const last = await tx.shot.findFirst({ where: { projectId }, orderBy: { order: "desc" }, select: { order: true, scene: true, locationId: true } });
      order = (last?.order ?? -1) + 1;
      return tx.shot.create({ data: { projectId, order, scene: last?.scene ?? "", locationId: last?.locationId ?? null } });
    });
    revalidate(projectId);
    return { id: shot.id };
  });
}

export async function updateShot(shotId: string, patch: ShotPatch) {
  return runAction(async () => {
    const { projectId } = await assertShotAccess(shotId);
    const { characterIds, locationId, ...fields } = parseInput(ShotPatchSchema, patch);

    if (locationId) {
      const ok = await db.location.count({ where: { id: locationId, projectId } });
      if (!ok) throw new UserFacingError("ロケーションが見つかりません。");
    }
    if (characterIds && characterIds.length > 0) {
      const ok = await db.character.count({ where: { id: { in: characterIds }, projectId } });
      if (ok !== new Set(characterIds).size) throw new UserFacingError("キャラクターが見つかりません。");
    }

    const touchesPrompt = Object.keys(patch).some((k) => PROMPT_FIELDS.has(k));
    await db.shot.update({
      where: { id: shotId },
      data: {
        ...fields,
        ...(locationId !== undefined ? { location: locationId ? { connect: { id: locationId } } : { disconnect: true } } : {}),
        ...(characterIds ? { characters: { set: characterIds.map((id) => ({ id })) } } : {}),
        ...(touchesPrompt ? { contentUpdatedAt: new Date() } : {}),
      },
    });
    revalidate(projectId);
  });
}

export async function updateShotsStatus(projectId: string, shotIds: string[], status: (typeof SHOT_STATUSES)[number]) {
  return runAction(async () => {
    await assertProjectAccess(projectId);
    const value = parseInput(z.enum(SHOT_STATUSES), status);
    const ids = parseInput(z.array(z.string()).min(1).max(1000), shotIds);
    await db.shot.updateMany({ where: { id: { in: ids }, projectId }, data: { status: value } });
    revalidate(projectId);
  });
}

export async function deleteShot(shotId: string) {
  return runAction(async () => {
    const { projectId } = await assertShotAccess(shotId);
    const versions = await db.assetVersion.findMany({
      where: { asset: { shotId }, storageKey: { not: null } },
      select: { storageKey: true },
    });
    await db.$transaction(async (tx) => {
      const removed = await tx.shot.delete({ where: { id: shotId } });
      await tx.shot.updateMany({ where: { projectId, order: { gt: removed.order } }, data: { order: { decrement: 1 } } });
    });
    const storage = getStorage();
    await Promise.all(versions.map((v) => storage.delete(v.storageKey!).catch(() => undefined)));
    revalidate(projectId);
  });
}

export async function moveShot(shotId: string, direction: "up" | "down") {
  return runAction(async () => {
    const { projectId } = await assertShotAccess(shotId);
    await db.$transaction(async (tx) => {
      const shot = await tx.shot.findUniqueOrThrow({ where: { id: shotId }, select: { id: true, order: true } });
      const neighbor = await tx.shot.findFirst({
        where: { projectId, order: direction === "up" ? { lt: shot.order } : { gt: shot.order } },
        orderBy: { order: direction === "up" ? "desc" : "asc" },
        select: { id: true, order: true },
      });
      if (!neighbor) return;
      await tx.shot.update({ where: { id: shot.id }, data: { order: neighbor.order } });
      await tx.shot.update({ where: { id: neighbor.id }, data: { order: shot.order } });
    });
    revalidate(projectId);
  });
}

/** Persists a full ordering (used by drag & drop). */
export async function reorderShots(projectId: string, orderedIds: string[]) {
  return runAction(async () => {
    await assertProjectAccess(projectId);
    const ids = parseInput(z.array(z.string()).max(2000), orderedIds);
    const existing = await db.shot.findMany({ where: { projectId }, select: { id: true } });
    if (existing.length !== ids.length || !existing.every((s) => ids.includes(s.id))) {
      throw new UserFacingError("並び順が最新ではありません。ページを再読み込みしてください。");
    }
    await db.$transaction(ids.map((id, order) => db.shot.update({ where: { id }, data: { order } })));
    revalidate(projectId);
  });
}
