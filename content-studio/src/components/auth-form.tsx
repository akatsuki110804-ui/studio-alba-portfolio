"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { login, signup, type AuthFormState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function AuthForm({ mode, signupEnabled = true }: { mode: "login" | "signup"; signupEnabled?: boolean }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(mode === "login" ? login : signup, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">{mode === "login" ? "ログイン" : "アカウント作成"}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {mode === "login" ? "ワークスペースにログインします。" : "メールアドレスとパスワードで始められます。"}
        </p>
      </div>

      {state?.error && (
        <div role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </div>
      )}

      {mode === "signup" && (
        <Field label="お名前（任意）" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" />
        </Field>
      )}
      <Field label="メールアドレス" htmlFor="email">
        <Input id="email" name="email" type="email" required autoComplete="email" defaultValue={state?.email} />
      </Field>
      <Field label="パスワード" htmlFor="password" hint={mode === "signup" ? "8文字以上" : undefined}>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={mode === "signup" ? 8 : undefined}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
      </Field>

      <Button type="submit" variant="primary" size="md" loading={pending} className="mt-1 w-full">
        {mode === "login" ? "ログイン" : "アカウントを作成"}
      </Button>

      <p className="text-center text-sm text-fg-muted">
        {mode === "login" ? (
          signupEnabled ? (
            <>
              アカウントをお持ちでない方は{" "}
              <Link href="/signup" className="font-medium text-accent hover:underline">
                新規登録
              </Link>
            </>
          ) : null
        ) : (
          <>
            既にアカウントをお持ちの方は{" "}
            <Link href="/login" className="font-medium text-accent hover:underline">
              ログイン
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
