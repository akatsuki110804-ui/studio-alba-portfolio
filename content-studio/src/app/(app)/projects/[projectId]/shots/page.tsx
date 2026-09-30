import type { Metadata } from "next";
import { ShotBoard } from "@/components/shots/shot-board";
import type { PromptInfo, ShotRow } from "@/components/shots/types";
import { db } from "@/lib/db";
import { fileUrl, storagePrefix } from "@/lib/files";
import { unitLabel } from "@/lib/labels";
import { DEFAULT_TARGET } from "@/lib/prompts/compose";
import { isPromptStale } from "@/lib/prompts/stale";
import { getProjectForPage } from "@/lib/queries";
import { maxUploadBytes, uploadMode } from "@/lib/storage";

export const metadata: Metadata = { title: "カット・Prompt・素材" };

const HISTORY_PER_KIND = 10;

export default async function ShotsPage({ params, searchParams }: PageProps<"/projects/[projectId]/shots">) {
  const { projectId } = await params;
  const { shot: initialShotId } = await searchParams;
  const { user, project } = await getProjectForPage(projectId);

  const [shots, characters, locations] = await Promise.all([
    db.shot.findMany({
      where: { projectId },
      orderBy: { order: "asc" },
      include: {
        characters: { select: { id: true, updatedAt: true } },
        location: { select: { id: true, updatedAt: true } },
        prompts: { where: { target: DEFAULT_TARGET }, orderBy: { version: "desc" } },
        assets: { orderBy: { createdAt: "asc" }, include: { versions: { orderBy: { version: "desc" } } } },
      },
    }),
    db.character.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    db.location.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
  ]);

  const rows: ShotRow[] = shots.map((s) => {
    const sources = {
      shotContentUpdatedAt: s.contentUpdatedAt,
      projectPromptContextUpdatedAt: project.promptContextUpdatedAt,
      entityUpdatedAts: [...s.characters.map((c) => c.updatedAt), ...(s.location ? [s.location.updatedAt] : [])],
    };
    const toInfo = (p: (typeof s.prompts)[number]): PromptInfo => ({
      id: p.id,
      kind: p.kind,
      content: p.content,
      version: p.version,
      source: p.source,
      createdAt: p.createdAt.toISOString(),
      stale: isPromptStale(p.createdAt, sources),
    });
    const images = s.prompts.filter((p) => p.kind === "IMAGE");
    const videos = s.prompts.filter((p) => p.kind === "VIDEO");
    return {
      id: s.id,
      order: s.order,
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
      notes: s.notes,
      status: s.status,
      locationId: s.locationId,
      characterIds: s.characters.map((c) => c.id),
      imagePrompt: images[0] ? toInfo(images[0]) : null,
      videoPrompt: videos[0] ? toInfo(videos[0]) : null,
      promptHistory: [...images.slice(0, HISTORY_PER_KIND), ...videos.slice(0, HISTORY_PER_KIND)].map(toInfo),
      assets: s.assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        label: a.label,
        versions: a.versions.map((v) => ({
          id: v.id,
          version: v.version,
          url: fileUrl(v.storageKey),
          externalUrl: v.externalUrl,
          fileName: v.fileName,
          mimeType: v.mimeType,
          size: v.size,
          note: v.note,
          createdAt: v.createdAt.toISOString(),
        })),
      })),
    };
  });

  return (
    <ShotBoard
      projectId={projectId}
      projectTitle={project.title}
      unit={unitLabel(project.format)}
      shots={rows}
      characters={characters.map((c) => ({ id: c.id, name: c.name, imageUrl: fileUrl(c.imageKey), hasSheet: !!c.promptDescription }))}
      locations={locations.map((l) => ({ id: l.id, name: l.name, imageUrl: fileUrl(l.imageKey), hasSheet: !!l.promptDescription }))}
      initialShotId={typeof initialShotId === "string" ? initialShotId : null}
      uploadTarget={{ mode: uploadMode(), prefix: storagePrefix(user.id, projectId), maxBytes: maxUploadBytes() }}
    />
  );
}
