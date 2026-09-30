import "server-only";
import { z } from "zod";
import { toErrorMessage, UserFacingError, type ActionResult } from "@/lib/errors";

/** Wraps a server action body: converts thrown errors into a typed failure result. */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    // Let Next.js control-flow errors (redirect / notFound) propagate.
    if (isNextControlFlow(error)) throw error;
    return { ok: false, error: toErrorMessage(error) };
  }
}

function isNextControlFlow(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"));
}

/** Parses input with zod, throwing a user-facing error with the first issue. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new UserFacingError(issue?.message || "入力内容を確認してください。");
  }
  return result.data;
}
