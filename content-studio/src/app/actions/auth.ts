"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";

export type AuthFormState = { error?: string; email?: string } | undefined;

const SignupSchema = z.object({
  name: z.string().trim().max(80).optional(),
  email: z.email("メールアドレスの形式が正しくありません。").trim().toLowerCase(),
  password: z.string().min(8, "パスワードは8文字以上にしてください。").max(200),
});

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1),
});

export async function signup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (process.env.ALLOW_SIGNUP === "false") {
    return { error: "現在、新規登録は受け付けていません。" };
  }
  const parsed = SignupSchema.safeParse(Object.fromEntries(formData));
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, email };

  const exists = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (exists) return { error: "このメールアドレスは既に登録されています。", email };

  const user = await db.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name || null,
      passwordHash: await hashPassword(parsed.data.password),
    },
  });
  await createSession(user.id);
  redirect("/projects");
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = LoginSchema.safeParse(Object.fromEntries(formData));
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { error: "メールアドレスとパスワードを入力してください。", email };

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  const valid = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!user || !valid) return { error: "メールアドレスまたはパスワードが違います。", email };

  await createSession(user.id);
  redirect("/projects");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
