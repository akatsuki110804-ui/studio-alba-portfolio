"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertProjectAccess, assertShotAccess } from "@/lib/access";
import { parseInput, runAction } from "@/lib/action";
import { generateShotPrompts, type ShotPromptInput } from "@/lib/ai";
import { db } from "@/lib/db";
import { UserFacingError } from "@/lib/errors";
import { DEFAULT_TARGET } from "@/lib/prompts/compose";
import { isPromptStale } from "@/lib/prompts/stale";
import { ensureSheets, projectContext } from "@/lib/services/bible";
import { advanceShotStatus } from "@/lib/services/status";

const ScopeSchema = z.enum(["missing", "all", "selected"]);

/**
 * Generates image + video prompts.
 *  - missing:  shots with no prompt yet, or whose prompt is stale
 *  - all:      every shot
 *  - selected: the given shot ids
 */
export async function generatePrompts(projectId: string, scope: "missing" | "all" | "selected", shotIds: string[] = []) {
  return runAction(async () => {
    await assertProjectAccess(projectId);
    const mode = parseInput(ScopeSchema, scope);
    const target = DEFAULT_TARGET;

    const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    const shots = await db.shot.findMany({
      where: { projectId, ...(mode === "selected" ? { id: { in: shotIds } } : {}) },
      orderBy: { order: "asc" },
      include: {
        characters: { select: { id: true, updatedAt: true } },
        location: { select: { id: true, updatedAt: true } },
        prompts: { where: { target }, orderBy: { version: "desc" } },
      },
    });

    const todo = shots.filter((s) => {
      if (mode !== "missing") return true;
      const latestImage = s.prompts.find((p) => p.kind === "IMAGE");
      const latestVideo = s.prompts.find((p) => p.kind === "VIDEO");
      if (!latestImage || !latestVideo) return true;
      const sources = {
        shotContentUpdatedAt: s.contentUpdatedAt,
        projectPromptContextUpdatedAt: project.promptContextUpdatedAt,
        entityUpdatedAts: [...s.characters.map((c) => c.updatedAt), ...(s.location ? [s.location.updatedAt] : [])],
      };
      return isPromptStale(latestImage.createdAt, sources) || isPromptStale(latestVideo.createdAt, sources);
    });

    if (todo.length === 0) {
      if (shots.length === 0) throw new UserFacingError("カットがありません。先にカットを作成してください。");
      return { generated: 0 };
    }
    if (todo.length > 200) throw new UserFacingError("一度に生成できるのは200カットまでです。");

    // Make sure every referenced character/location has its fixed English sheet.
    const charIds = [...new Set(todo.flatMap((s) => s.characters.map((c) => c.id)))];
    const locIds = [...new Set(todo.flatMap((s) => (s.location ? [s.location.id] : [])))];
    await ensureSheets(project, charIds, locIds);

    const [characters, locations] = await Promise.all([
      db.character.findMany({ where: { id: { in: charIds } } }),
      db.location.findMany({ where: { id: { in: locIds } } }),
    ]);
    const charById = new Map(characters.map((c) => [c.id, c]));
    const locById = new Map(locations.map((l) => [l.id, l]));

    const inputs: ShotPromptInput[] = todo.map((s) => ({
      ref: s.id,
      scene: s.scene,
      description: s.description,
      action: s.action,
      dialogue: s.dialogue,
      emotion: s.emotion,
      timeOfDay: s.timeOfDay,
      props: s.props,
      camera: s.camera,
      composition: s.composition,
      durationSec: s.durationSec,
      characters: s.characters
        .map((c) => charById.get(c.id))
        .filter((c) => !!c)
        .map((c) => ({ name: c.name, promptName: c.promptName, promptDescription: c.promptDescription })),
      location: s.location && locById.get(s.location.id)
        ? (() => {
            const l = locById.get(s.location!.id)!;
            return { name: l.name, promptName: l.promptName, promptDescription: l.promptDescription };
          })()
        : null,
    }));

    const results = await generateShotPrompts(projectContext(project), inputs, target);

    await db.$transaction(async (tx) => {
      for (const r of results) {
        const shot = todo.find((s) => s.id === r.ref);
        if (!shot) continue;
        const nextImage = (shot.prompts.find((p) => p.kind === "IMAGE")?.version ?? 0) + 1;
        const nextVideo = (shot.prompts.find((p) => p.kind === "VIDEO")?.version ?? 0) + 1;
        await tx.prompt.createMany({
          data: [
            { shotId: shot.id, kind: "IMAGE", target, content: r.image, version: nextImage, source: "AI" },
            { shotId: shot.id, kind: "VIDEO", target, content: r.video, version: nextVideo, source: "AI" },
          ],
        });
      }
    }, { timeout: 60_000 });

    await advanceShotStatus(results.map((r) => r.ref), "PROMPT_READY");
    revalidatePath(`/projects/${projectId}`, "layout");
    return { generated: results.length };
  });
}

/** Saves a manual edit as a new prompt version. */
export async function savePrompt(shotId: string, kind: "IMAGE" | "VIDEO", content: string) {
  return runAction(async () => {
    const { projectId } = await assertShotAccess(shotId);
    const k = parseInput(z.enum(["IMAGE", "VIDEO"]), kind);
    const value = parseInput(z.string().trim().min(1, "Promptが空です。").max(10_000), content);
    const target = DEFAULT_TARGET;
    const latest = await db.prompt.findFirst({
      where: { shotId, kind: k, target },
      orderBy: { version: "desc" },
      select: { version: true, content: true },
    });
    if (latest?.content === value) return;
    await db.prompt.create({
      data: { shotId, kind: k, target, content: value, version: (latest?.version ?? 0) + 1, source: "MANUAL" },
    });
    await advanceShotStatus([shotId], "PROMPT_READY");
    revalidatePath(`/projects/${projectId}`, "layout");
  });
}
