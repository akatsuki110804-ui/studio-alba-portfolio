import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "新規登録" };

export default function SignupPage() {
  if (process.env.ALLOW_SIGNUP === "false") redirect("/login");
  return <AuthForm mode="signup" />;
}
