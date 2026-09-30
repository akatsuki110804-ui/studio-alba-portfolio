import "server-only";
import type { ShotStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

// Automatic status advancement: only moves forward from "earlier" statuses,
// never overrides REVISING / DONE that the user set deliberately.
const ADVANCE_FROM: Record<"PROMPT_READY" | "IMAGE_DONE" | "VIDEO_DONE", ShotStatus[]> = {
  PROMPT_READY: ["TODO"],
  IMAGE_DONE: ["TODO", "PROMPT_READY"],
  VIDEO_DONE: ["TODO", "PROMPT_READY", "IMAGE_DONE"],
};

export async function advanceShotStatus(shotIds: string[], to: keyof typeof ADVANCE_FROM) {
  if (shotIds.length === 0) return;
  await db.shot.updateMany({
    where: { id: { in: shotIds }, status: { in: ADVANCE_FROM[to] } },
    data: { status: to },
  });
}
