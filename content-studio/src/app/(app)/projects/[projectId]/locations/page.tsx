import type { Metadata } from "next";
import { BibleBoard } from "@/components/bible-board";
import { db } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { getProjectForPage } from "@/lib/queries";

export const metadata: Metadata = { title: "ロケーション" };

export default async function LocationsPage({ params }: PageProps<"/projects/[projectId]/locations">) {
  const { projectId } = await params;
  await getProjectForPage(projectId);
  const rows = await db.location.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { shots: true } } },
  });

  return (
    <BibleBoard
      kind="location"
      projectId={projectId}
      entries={rows.map((l) => ({
        id: l.id,
        name: l.name,
        aliases: l.aliases,
        fields: {
          exterior: l.exterior,
          interior: l.interior,
          colors: l.colors,
          mood: l.mood,
          timeOfDay: l.timeOfDay,
          lighting: l.lighting,
          props: l.props,
          notes: l.notes,
        },
        promptName: l.promptName,
        promptDescription: l.promptDescription,
        imageUrl: fileUrl(l.imageKey),
        shotCount: l._count.shots,
      }))}
    />
  );
}
