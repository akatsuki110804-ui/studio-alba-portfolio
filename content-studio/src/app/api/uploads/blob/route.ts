import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { z } from "zod";
import { assertProjectAccess, assertShotAccess } from "@/lib/access";
import { toErrorMessage, UserFacingError } from "@/lib/errors";
import { ALLOWED_ASSET_TYPES } from "@/lib/files";
import { isValidProjectKey, maxUploadBytes, storageDriverName } from "@/lib/storage";

const PayloadSchema = z.union([
  z.object({ shotId: z.string().min(1) }),
  z.object({ projectId: z.string().min(1), purpose: z.literal("bgm") }),
]);

/**
 * Issues short-lived client tokens so the browser can upload large files
 * straight to Vercel Blob. The database row is created afterwards by the
 * `registerUploadedAsset` action, which re-checks the stored object.
 */
export async function POST(request: Request) {
  if (storageDriverName() !== "vercel-blob") {
    return Response.json({ error: "Direct upload is not enabled." }, { status: 404 });
  }
  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = PayloadSchema.safeParse(JSON.parse(clientPayload ?? "{}"));
        if (!payload.success) throw new UserFacingError("リクエストが不正です。");
        const isBgm = "purpose" in payload.data;
        const { user, projectId } =
          "shotId" in payload.data ? await assertShotAccess(payload.data.shotId) : await assertProjectAccess(payload.data.projectId);
        if (!isValidProjectKey(pathname, user.id, projectId)) throw new UserFacingError("アップロード先が不正です。");
        return {
          allowedContentTypes: isBgm ? ["audio/*"] : ALLOWED_ASSET_TYPES,
          maximumSizeInBytes: maxUploadBytes(),
          addRandomSuffix: false,
          allowOverwrite: false,
        };
      },
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: toErrorMessage(error) }, { status: 400 });
  }
}
