/** An error whose message is safe to show to the user. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function toErrorMessage(error: unknown): string {
  if (error instanceof UserFacingError) return error.message;
  console.error(error);
  return "予期しないエラーが発生しました。時間をおいて再度お試しください。";
}
