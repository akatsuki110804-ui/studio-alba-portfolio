"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertProjectAccess } from "@/lib/access";
import { parseInput, runAction } from "@/lib/action";
import { generateCharacters, generateLocations, generateScriptAnalysis, generateShots } from "@/lib/ai";
import { db } from "@/lib/db";
import { UserFacingError } from "@/lib/errors";
import { formatLabel } from "@/lib/labels";
import { getStorage } from "@/lib/storage";

const ModeSchema = z.enum(["replace", "append"]);

function nameKey(name: string) {
  return name.replace(/\s+/g, "").toLowerCase();
}

/** Merge helper: keep user-entered values, fill only empty fields. */
function fillEmpty<T extends Record<string, unknown>>(current: T, incoming: Partial<T>) {
  const patch: Partial<T> = {};
  for (const [k, v] of Object.entries(incoming) as [keyof T, T[keyof T]][]) {
    if (typeof v === "string" && v.trim() && typeof current[k] === "string" && !(current[k] as string).trim()) {
      patch[k] = v;
    }
  }
  return patch;
}

/**
 * Script → characters, locations and shot list in one step.
 * Existing characters/locations are matched by name/alias and never overwritten.
 */
export async function analyzeScript(projectId: string, mode: "replace" | "append") {
  return runAction(async () => {
    await assertProjectAccess(projectId);
    const shotMode = parseInput(ModeSchema, mode);

    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { characters: true, locations: true },
    });
    if (!project.script.trim()) throw new UserFacingError("台本が空です。先に台本を入力してください。");

    const analysis = await generateScriptAnalysis({
      script: project.script,
      project: {
        title: project.title,
        format: formatLabel(project.format),
        platform: project.platform,
        aspectRatio: project.aspectRatio,
        styleGuide: project.styleGuide,
      },
      knownCharacters: project.characters.map((c) => ({ name: c.name, aliases: c.aliases })),
      knownLocations: project.locations.map((l) => ({ name: l.name, aliases: l.aliases })),
    });

    const shotDrafts = generateShots(analysis);
    if (shotDrafts.length === 0) throw new UserFacingError("カットを抽出できませんでした。台本の内容を確認してください。");

    const removedKeys: string[] = [];
    const summary = await db.$transaction(
      async (tx) => {
        // ── Characters ──
        const charIndex = new Map<string, string>(); // name/alias key → id
        for (const c of project.characters) {
          for (const n of [c.name, ...c.aliases]) charIndex.set(nameKey(n), c.id);
        }
        let createdCharacters = 0;
        let order = project.characters.length;
        for (const draft of generateCharacters(analysis)) {
          const existingId = [draft.name, ...draft.aliases].map((n) => charIndex.get(nameKey(n))).find(Boolean);
          const { name, aliases, ...fields } = draft;
          if (existingId) {
            const current = project.characters.find((c) => c.id === existingId)!;
            const mergedAliases = [...new Set([...current.aliases, ...aliases.filter((a) => a !== current.name)])];
            await tx.character.update({
              where: { id: existingId },
              data: { ...fillEmpty(current, fields), aliases: mergedAliases },
            });
          } else {
            const created = await tx.character.create({
              data: { projectId, name, aliases, ...fields, sortOrder: order++ },
            });
            createdCharacters++;
            for (const n of [name, ...aliases]) charIndex.set(nameKey(n), created.id);
          }
        }

        // ── Locations ──
        const locIndex = new Map<string, string>();
        for (const l of project.locations) {
          for (const n of [l.name, ...l.aliases]) locIndex.set(nameKey(n), l.id);
        }
        let createdLocations = 0;
        order = project.locations.length;
        for (const draft of generateLocations(analysis)) {
          const existingId = [draft.name, ...draft.aliases].map((n) => locIndex.get(nameKey(n))).find(Boolean);
          const { name, aliases, ...fields } = draft;
          if (existingId) {
            const current = project.locations.find((l) => l.id === existingId)!;
            const mergedAliases = [...new Set([...current.aliases, ...aliases.filter((a) => a !== current.name)])];
            await tx.location.update({
              where: { id: existingId },
              data: { ...fillEmpty(current, fields), aliases: mergedAliases },
            });
          } else {
            const created = await tx.location.create({
              data: { projectId, name, aliases, ...fields, sortOrder: order++ },
            });
            createdLocations++;
            for (const n of [name, ...aliases]) locIndex.set(nameKey(n), created.id);
          }
        }

        // ── Shots ──
        let startOrder = 0;
        if (shotMode === "replace") {
          const versions = await tx.assetVersion.findMany({
            where: { asset: { shot: { projectId } }, storageKey: { not: null } },
            select: { storageKey: true },
          });
          removedKeys.push(...versions.map((v) => v.storageKey!).filter(Boolean));
          await tx.shot.deleteMany({ where: { projectId } });
        } else {
          const last = await tx.shot.findFirst({ where: { projectId }, orderBy: { order: "desc" }, select: { order: true } });
          startOrder = (last?.order ?? -1) + 1;
        }

        for (const [i, s] of shotDrafts.entries()) {
          const characterIds = [...new Set(s.characters.map((n) => charIndex.get(nameKey(n))).filter((id): id is string => !!id))];
          const locationId = s.location ? (locIndex.get(nameKey(s.location)) ?? null) : null;
          const extras = s.requiredAssets.length > 0 ? `必要素材: ${s.requiredAssets.join("、")}` : "";
          await tx.shot.create({
            data: {
              projectId,
              order: startOrder + i,
              scene: s.scene,
              description: s.description,
              action: s.action,
              dialogue: s.dialogue,
              narration: s.narration,
              emotion: s.emotion,
              timeOfDay: s.timeOfDay,
              props: s.props,
              camera: s.camera,
              composition: s.composition,
              durationSec: s.durationSec > 0 ? s.durationSec : null,
              notes: extras,
              locationId,
              characters: { connect: characterIds.map((id) => ({ id })) },
            },
          });
        }

        await tx.project.update({
          where: { id: projectId },
          data: {
            analysis: analysis as object,
            analyzedAt: new Date(),
            ...(project.status === "PLANNING" ? { status: "IN_PROGRESS" as const } : {}),
          },
        });

        return {
          shots: shotDrafts.length,
          createdCharacters,
          createdLocations,
          totalCharacters: charIndex.size > 0 ? new Set(charIndex.values()).size : 0,
          totalLocations: locIndex.size > 0 ? new Set(locIndex.values()).size : 0,
        };
      },
      { timeout: 60_000 },
    );

    const storage = getStorage();
    await Promise.all(removedKeys.map((k) => storage.delete(k).catch(() => undefined)));

    revalidatePath(`/projects/${projectId}`, "layout");
    revalidatePath("/projects");
    return summary;
  });
}
