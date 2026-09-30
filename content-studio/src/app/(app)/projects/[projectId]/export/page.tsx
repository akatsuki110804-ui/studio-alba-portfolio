import type { Metadata } from "next";
import { EditKitPanel, type ExportShot } from "@/components/edit-kit-panel";
import { db } from "@/lib/db";
import { fileUrl, storagePrefix } from "@/lib/files";
import { unitLabel } from "@/lib/labels";
import { getProjectForPage } from "@/lib/queries";
import { maxUploadBytes, uploadMode } from "@/lib/storage";

export const metadata: Metadata = { title: "編集書き出し" };

function extOf(fileName: string, mime: string) {
  const m = fileName.match(/\.([a-z0-9]{2,5})$/i);
  if (m) return m[1].toLowerCase();
  const fromMime: Record<string, string> = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
  };
  return fromMime[mime] ?? "bin";
}

export default async function ExportPage({ params }: PageProps<"/projects/[projectId]/export">) {
  const { projectId } = await params;
  const { user, project } = await getProjectForPage(projectId);
  const unit = unitLabel(project.format);

  const shots = await db.shot.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
    include: { assets: { include: { versions: { orderBy: { version: "desc" } } } } },
  });

  const rows: ExportShot[] = shots.map((s, i) => {
    const no = String(i + 1).padStart(2, "0");
    // Latest uploaded version of the newest-updated slot of a kind.
    const latestOf = (kind: "VIDEO" | "IMAGE" | "AUDIO") => {
      const candidates = s.assets
        .filter((a) => a.kind === kind)
        .flatMap((a) => a.versions.slice(0, 1))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return candidates[0] ?? null;
    };
    const video = latestOf("VIDEO");
    const image = latestOf("IMAGE");
    const audio = latestOf("AUDIO");
    const pic = video?.storageKey ? { v: video, kind: "VIDEO" as const } : image?.storageKey ? { v: image, kind: "IMAGE" as const } : null;
    const externalOnly = !pic && (video?.externalUrl || image?.externalUrl) ? true : false;

    return {
      id: s.id,
      no: i + 1,
      label: `${unit}${no}`,
      description: s.description,
      dialogue: s.dialogue,
      narration: s.narration,
      notes: s.notes,
      plannedSec: s.durationSec,
      visual: pic
        ? {
            url: fileUrl(pic.v.storageKey)!,
            kitName: `cut${no}_${pic.kind === "VIDEO" ? "video" : "image"}_v${pic.v.version}.${extOf(pic.v.fileName, pic.v.mimeType)}`,
            kind: pic.kind,
            version: pic.v.version,
          }
        : null,
      visualExternalOnly: externalOnly,
      narrationAudio: audio?.storageKey
        ? { url: fileUrl(audio.storageKey)!, kitName: `cut${no}_narration_v${audio.version}.${extOf(audio.fileName, audio.mimeType)}` }
        : null,
    };
  });

  return (
    <EditKitPanel
      projectId={projectId}
      title={project.title}
      aspectRatio={project.aspectRatio}
      unit={unit}
      shots={rows}
      bgm={
        project.bgmKey
          ? {
              url: fileUrl(project.bgmKey)!,
              kitName: `bgm.${extOf(project.bgmFileName, project.bgmMimeType)}`,
              fileName: project.bgmFileName,
            }
          : null
      }
      uploadTarget={{ mode: uploadMode(), prefix: storagePrefix(user.id, projectId), maxBytes: maxUploadBytes() }}
    />
  );
}
