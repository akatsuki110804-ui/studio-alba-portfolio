import Link from "next/link";
import { LogOut, Sparkles } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { Logo } from "@/components/logo";
import { aiProviderInfo } from "@/lib/ai";
import { requireUser } from "@/lib/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const ai = aiProviderInfo();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-[1600px] items-center gap-4 px-4">
          <Link href="/projects" className="text-sm">
            <Logo />
          </Link>
          <nav className="hidden text-sm sm:block">
            <Link href="/projects" className="rounded-md px-2 py-1 text-fg-muted hover:bg-surface-2 hover:text-fg">
              プロジェクト
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span
              title={ai.isMock ? "ANTHROPIC_API_KEY を設定すると Claude で解析・生成します" : `AI: ${ai.label}`}
              className={
                ai.isMock
                  ? "hidden items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning sm:inline-flex"
                  : "hidden items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent sm:inline-flex"
              }
            >
              <Sparkles className="size-3" />
              {ai.isMock ? "AIデモモード" : ai.label}
            </span>
            <span className="hidden max-w-40 truncate text-xs text-fg-subtle md:inline">{user.name || user.email}</span>
            <form action={logout}>
              <button
                type="submit"
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                <LogOut className="size-3.5" />
                <span className="hidden sm:inline">ログアウト</span>
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
