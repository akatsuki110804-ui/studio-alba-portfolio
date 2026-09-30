"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertProjectAccess } from "@/lib/access";
import { parseInput, runAction } from "@/lib/action";
import { UserFacingError } from "@/lib/errors";
import { setProjectBgm } from "@/lib/services/bgm";
import { getStorage, isValidProjectKey } from "@/lib/storage";

const RegisterSchema = z.object({
  key: z.string().min(1).max(500),
  fileName: z.string().trim().min(1).max(300),
});

/** Records a BGM file the browser uploaded directly to storage. */
export async function registerBgm(projectId: string, input: z.input<typeof RegisterSchema>) {
  return runAction(async () => {
    const { user } = await assertProjectAccess(projectId);
    const data = parseInput(RegisterSchema, input);
    if (!isValidProjectKey(data.key, user.id, projectId)) throw new UserFacingError("アップロード先が不正です。");
    const stored = await getStorage().head(data.key);
    if (!stored) throw new UserFacingError("アップロードしたファイルが見つかりません。もう一度お試しください。");
    if (!stored.contentType.startsWith("audio/")) {
      await getStorage().delete(data.key).catch(() => undefined);
      throw new UserFacingError("BGMには音声ファイルを選択してください。");
    }
    await setProjectBgm(projectId, { key: data.key, fileName: data.fileName, mimeType: stored.contentType, size: stored.size });
    revalidatePath(`/projects/${projectId}`, "layout");
  });
}

export async function removeBgm(projectId: string) {
  return runAction(async () => {
    await assertProjectAccess(projectId);
    await setProjectBgm(projectId, null);
    revalidatePath(`/projects/${projectId}`, "layout");
  });
}
