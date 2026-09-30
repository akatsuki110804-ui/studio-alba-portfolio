import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "ログイン" };

export default function LoginPage() {
  return <AuthForm mode="login" signupEnabled={process.env.ALLOW_SIGNUP !== "false"} />;
}
