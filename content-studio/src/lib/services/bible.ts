import "server-only";
import type { Character, Location, Project } from "@/generated/prisma/client";
import { generateEntityDescription, type ProjectContext } from "@/lib/ai";
import { db } from "@/lib/db";
import { formatLabel } from "@/lib/labels";

export const CHARACTER_FIELD_LABELS = {
  age: "年齢",
  gender: "性別",
  appearance: "外見",
  hairStyle: "髪型",
  hairColor: "髪色",
  outfit: "服装",
  build: "身長・体型",
  vibe: "雰囲気",
  notes: "その他特徴",
} as const satisfies Partial<Record<keyof Character, string>>;

export const LOCATION_FIELD_LABELS = {
  exterior: "外観",
  interior: "内装",
  colors: "色",
  mood: "雰囲気",
  timeOfDay: "時間帯",
  lighting: "光",
  props: "小道具",
  notes: "その他",
} as const satisfies Partial<Record<keyof Location, string>>;

export function projectContext(p: Pick<Project, "title" | "format" | "platform" | "aspectRatio" | "styleGuide">): ProjectContext {
  return {
    title: p.title,
    format: formatLabel(p.format),
    platform: p.platform,
    aspectRatio: p.aspectRatio,
    styleGuide: p.styleGuide,
  };
}

function labeledFields<T extends Record<string, unknown>>(row: T, labels: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [key, label] of Object.entries(labels)) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) out[label] = v.trim();
  }
  return out;
}

export async function writeCharacterSheet(character: Character, project: ProjectContext) {
  const sheet = await generateEntityDescription({
    kind: "character",
    name: character.name,
    fields: labeledFields(character, CHARACTER_FIELD_LABELS),
    project,
  });
  return db.character.update({
    where: { id: character.id },
    data: {
      promptName: character.promptName.trim() || sheet.promptName,
      promptDescription: sheet.promptDescription,
    },
  });
}

export async function writeLocationSheet(location: Location, project: ProjectContext) {
  const sheet = await generateEntityDescription({
    kind: "location",
    name: location.name,
    fields: labeledFields(location, LOCATION_FIELD_LABELS),
    project,
  });
  return db.location.update({
    where: { id: location.id },
    data: {
      promptName: location.promptName.trim() || sheet.promptName,
      promptDescription: sheet.promptDescription,
    },
  });
}

/** Fills in missing English sheets for the given entities (used before prompt generation). */
export async function ensureSheets(project: Project, characterIds: string[], locationIds: string[]) {
  const ctx = projectContext(project);
  const [chars, locs] = await Promise.all([
    db.character.findMany({ where: { projectId: project.id, id: { in: characterIds }, promptDescription: "" } }),
    db.location.findMany({ where: { projectId: project.id, id: { in: locationIds }, promptDescription: "" } }),
  ]);
  // Small concurrency — these are short calls.
  const jobs = [...chars.map((c) => () => writeCharacterSheet(c, ctx)), ...locs.map((l) => () => writeLocationSheet(l, ctx))];
  for (let i = 0; i < jobs.length; i += 4) {
    await Promise.all(jobs.slice(i, i + 4).map((job) => job()));
  }
}
