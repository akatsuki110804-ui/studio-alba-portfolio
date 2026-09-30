import type { Metadata } from "next";
import { BibleBoard } from "@/components/bible-board";
import { db } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { getProjectForPage } from "@/lib/queries";

export const metadata: Metadata = { title: "キャラクター" };

export default async function CharactersPage({ params }: PageProps<"/projects/[projectId]/characters">) {
  const { projectId } = await params;
  await getProjectForPage(projectId);
  const rows = await db.character.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { shots: true } } },
  });

  return (
    <BibleBoard
      kind="character"
      projectId={projectId}
      entries={rows.map((c) => ({
        id: c.id,
        name: c.name,
        aliases: c.aliases,
        fields: {
          age: c.age,
          gender: c.gender,
          appearance: c.appearance,
          hairStyle: c.hairStyle,
          hairColor: c.hairColor,
          outfit: c.outfit,
          build: c.build,
          vibe: c.vibe,
          notes: c.notes,
        },
        promptName: c.promptName,
        promptDescription: c.promptDescription,
        imageUrl: fileUrl(c.imageKey),
        shotCount: c._count.shots,
      }))}
    />
  );
}
