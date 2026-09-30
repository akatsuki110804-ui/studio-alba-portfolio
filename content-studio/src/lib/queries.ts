import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import type { ShotStatus } from "@/generated/prisma/enums";

/** Loads a project owned by the current user or 404s. Memoized per request (layout + page share it). */
export const getProjectForPage = cache(async (projectId: string) => {
  const user = await requireUser();
  const project = await db.project.findFirst({ where: { id: projectId, ownerId: user.id } });
  if (!project) notFound();
  return { user, project };
});

export const getProjectStats = cache(async (projectId: string) => {
  const [statusRows, characters, locations, shotsWithPrompt, shotsWithAsset, missingSheets] = await Promise.all([
    db.shot.groupBy({ by: ["status"], where: { projectId }, _count: { _all: true } }),
    db.character.count({ where: { projectId } }),
    db.location.count({ where: { projectId } }),
    db.shot.count({ where: { projectId, prompts: { some: {} } } }),
    db.shot.count({ where: { projectId, assets: { some: {} } } }),
    db.character.count({ where: { projectId, promptDescription: "" } }),
  ]);
  const byStatus: Partial<Record<ShotStatus, number>> = {};
  for (const r of statusRows) byStatus[r.status] = r._count._all;
  const shots = Object.values(byStatus).reduce((a, b) => a + (b ?? 0), 0);
  return { byStatus, shots, characters, locations, shotsWithPrompt, shotsWithAsset, missingSheets };
});
