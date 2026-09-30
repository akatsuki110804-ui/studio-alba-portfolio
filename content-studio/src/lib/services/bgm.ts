import "server-only";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";

/** Replaces the project's BGM, deleting the previous file. */
export async function setProjectBgm(
  projectId: string,
  bgm: { key: string; fileName: string; mimeType: string; size: number } | null,
) {
  const before = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { bgmKey: true, updatedAt: true } });
  await db.project.update({
    where: { id: projectId },
    data: {
      bgmKey: bgm?.key ?? null,
      bgmFileName: bgm?.fileName ?? "",
      bgmMimeType: bgm?.mimeType ?? "",
      bgmSize: bgm?.size ?? 0,
    },
  });
  if (before.bgmKey && before.bgmKey !== bgm?.key) await getStorage().delete(before.bgmKey).catch(() => undefined);
}
