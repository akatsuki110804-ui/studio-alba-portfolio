import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="font-mono text-sm text-fg-subtle">404</p>
      <h1 className="text-lg font-semibold">ページが見つかりません</h1>
      <p className="text-sm text-fg-muted">削除されたか、アクセス権のないプロジェクトの可能性があります。</p>
      <Link href="/projects" className="mt-2 text-sm font-medium text-accent hover:underline">
        プロジェクト一覧へ戻る
      </Link>
    </main>
  );
}
