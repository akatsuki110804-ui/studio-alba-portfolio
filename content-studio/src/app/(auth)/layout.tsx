import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getCurrentUser } from "@/lib/auth/session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/projects");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Logo className="mb-8 text-lg" />
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-panel">{children}</div>
      <p className="mt-8 max-w-sm text-center text-xs leading-relaxed text-fg-subtle">
        台本 → カット → Prompt → 素材。AIコンテンツ制作の面倒な工程をひとつのワークスペースに。
      </p>
    </main>
  );
}
