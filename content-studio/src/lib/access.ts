import "server-only";
import { db } from "@/lib/db";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { UserFacingError } from "@/lib/errors";

/** For server actions / route handlers: throws instead of redirecting. */
export async function assertUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UserFacingError("ログインが必要です。再度ログインしてください。");
  return user;
}

/** Ensures the project exists and belongs to the current user. */
export async function assertProjectAccess(projectId: string) {
  const user = await assertUser();
  const project = await db.project.findFirst({
    where: { id: projectId, ownerId: user.id },
    select: { id: true },
  });
  if (!project) throw new UserFacingError("プロジェクトが見つかりません。");
  return { user, projectId: project.id };
}

export async function assertShotAccess(shotId: string) {
  const user = await assertUser();
  const shot = await db.shot.findFirst({
    where: { id: shotId, project: { ownerId: user.id } },
    select: { id: true, projectId: true },
  });
  if (!shot) throw new UserFacingError("カットが見つかりません。");
  return { user, shotId: shot.id, projectId: shot.projectId };
}

export async function assertCharacterAccess(characterId: string) {
  const user = await assertUser();
  const row = await db.character.findFirst({
    where: { id: characterId, project: { ownerId: user.id } },
    select: { id: true, projectId: true },
  });
  if (!row) throw new UserFacingError("キャラクターが見つかりません。");
  return { user, projectId: row.projectId };
}

export async function assertLocationAccess(locationId: string) {
  const user = await assertUser();
  const row = await db.location.findFirst({
    where: { id: locationId, project: { ownerId: user.id } },
    select: { id: true, projectId: true },
  });
  if (!row) throw new UserFacingError("ロケーションが見つかりません。");
  return { user, projectId: row.projectId };
}

export async function assertAssetVersionAccess(versionId: string) {
  const user = await assertUser();
  const row = await db.assetVersion.findFirst({
    where: { id: versionId, asset: { shot: { project: { ownerId: user.id } } } },
    select: { id: true, storageKey: true, asset: { select: { id: true, shotId: true, shot: { select: { projectId: true } } } } },
  });
  if (!row) throw new UserFacingError("素材が見つかりません。");
  return { user, version: row, projectId: row.asset.shot.projectId };
}
