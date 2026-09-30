"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCharacterAccess, assertLocationAccess, assertProjectAccess } from "@/lib/access";
import { parseInput, runAction } from "@/lib/action";
import { db } from "@/lib/db";
import { UserFacingError } from "@/lib/errors";
import { projectContext, writeCharacterSheet, writeLocationSheet } from "@/lib/services/bible";
import { getStorage } from "@/lib/storage";
import { Prisma } from "@/generated/prisma/client";

const text = (max = 1000) => z.string().trim().max(max).default("");
const aliases = z
  .union([z.array(z.string()), z.string()])
  .default([])
  .transform((v) =>
    [...new Set((Array.isArray(v) ? v : v.split(/[,、，\n]/)).map((s) => s.trim()).filter(Boolean))].slice(0, 20),
  );

const CharacterSchema = z.object({
  name: z.string().trim().min(1, "名前を入力してください。").max(60),
  aliases,
  age: text(60),
  gender: text(60),
  appearance: text(),
  hairStyle: text(200),
  hairColor: text(100),
  outfit: text(),
  build: text(200),
  vibe: text(500),
  notes: text(2000),
  promptName: text(80),
  promptDescription: text(2000),
});

const LocationSchema = z.object({
  name: z.string().trim().min(1, "名前を入力してください。").max(60),
  aliases,
  exterior: text(),
  interior: text(),
  colors: text(300),
  mood: text(500),
  timeOfDay: text(100),
  lighting: text(500),
  props: text(),
  notes: text(2000),
  promptName: text(80),
  promptDescription: text(2000),
});

export type CharacterInput = z.input<typeof CharacterSchema>;
export type LocationInput = z.input<typeof LocationSchema>;

function uniqueNameError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new UserFacingError("同じ名前がこのプロジェクトに既に登録されています。");
  }
  return error;
}

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}`, "layout");
}

// ── Characters ───────────────────────────────────────────────

export async function createCharacter(projectId: string, input: CharacterInput) {
  return runAction(async () => {
    await assertProjectAccess(projectId);
    const data = parseInput(CharacterSchema, input);
    const count = await db.character.count({ where: { projectId } });
    try {
      const created = await db.character.create({ data: { ...data, projectId, sortOrder: count } });
      revalidate(projectId);
      return { id: created.id };
    } catch (error) {
      throw uniqueNameError(error);
    }
  });
}

export async function updateCharacter(characterId: string, input: CharacterInput) {
  return runAction(async () => {
    const { projectId } = await assertCharacterAccess(characterId);
    const data = parseInput(CharacterSchema, input);
    try {
      await db.character.update({ where: { id: characterId }, data });
    } catch (error) {
      throw uniqueNameError(error);
    }
    revalidate(projectId);
  });
}

export async function deleteCharacter(characterId: string) {
  return runAction(async () => {
    const { projectId } = await assertCharacterAccess(characterId);
    const row = await db.character.delete({ where: { id: characterId } });
    if (row.imageKey) await getStorage().delete(row.imageKey).catch(() => undefined);
    revalidate(projectId);
  });
}

export async function generateCharacterSheet(characterId: string) {
  return runAction(async () => {
    const { projectId } = await assertCharacterAccess(characterId);
    const [character, project] = await Promise.all([
      db.character.findUniqueOrThrow({ where: { id: characterId } }),
      db.project.findUniqueOrThrow({ where: { id: projectId } }),
    ]);
    const updated = await writeCharacterSheet(character, projectContext(project));
    revalidate(projectId);
    return { promptName: updated.promptName, promptDescription: updated.promptDescription };
  });
}

// ── Locations ────────────────────────────────────────────────

export async function createLocation(projectId: string, input: LocationInput) {
  return runAction(async () => {
    await assertProjectAccess(projectId);
    const data = parseInput(LocationSchema, input);
    const count = await db.location.count({ where: { projectId } });
    try {
      const created = await db.location.create({ data: { ...data, projectId, sortOrder: count } });
      revalidate(projectId);
      return { id: created.id };
    } catch (error) {
      throw uniqueNameError(error);
    }
  });
}

export async function updateLocation(locationId: string, input: LocationInput) {
  return runAction(async () => {
    const { projectId } = await assertLocationAccess(locationId);
    const data = parseInput(LocationSchema, input);
    try {
      await db.location.update({ where: { id: locationId }, data });
    } catch (error) {
      throw uniqueNameError(error);
    }
    revalidate(projectId);
  });
}

export async function deleteLocation(locationId: string) {
  return runAction(async () => {
    const { projectId } = await assertLocationAccess(locationId);
    const row = await db.location.delete({ where: { id: locationId } });
    if (row.imageKey) await getStorage().delete(row.imageKey).catch(() => undefined);
    revalidate(projectId);
  });
}

export async function generateLocationSheet(locationId: string) {
  return runAction(async () => {
    const { projectId } = await assertLocationAccess(locationId);
    const [location, project] = await Promise.all([
      db.location.findUniqueOrThrow({ where: { id: locationId } }),
      db.project.findUniqueOrThrow({ where: { id: projectId } }),
    ]);
    const updated = await writeLocationSheet(location, projectContext(project));
    revalidate(projectId);
    return { promptName: updated.promptName, promptDescription: updated.promptDescription };
  });
}

export async function removeReferenceImage(kind: "character" | "location", id: string) {
  return runAction(async () => {
    if (kind === "character") {
      const { projectId } = await assertCharacterAccess(id);
      const row = await db.character.findUniqueOrThrow({ where: { id } });
      await db.character.update({ where: { id }, data: { imageKey: null, updatedAt: row.updatedAt } });
      if (row.imageKey) await getStorage().delete(row.imageKey).catch(() => undefined);
      revalidate(projectId);
    } else {
      const { projectId } = await assertLocationAccess(id);
      const row = await db.location.findUniqueOrThrow({ where: { id } });
      await db.location.update({ where: { id }, data: { imageKey: null, updatedAt: row.updatedAt } });
      if (row.imageKey) await getStorage().delete(row.imageKey).catch(() => undefined);
      revalidate(projectId);
    }
  });
}
