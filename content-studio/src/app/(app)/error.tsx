"use client";

import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-lg font-semibold">読み込み中にエラーが発生しました</h1>
      <p className="max-w-md text-sm text-fg-muted">
        データベースへの接続やネットワークを確認して、もう一度お試しください。
        {error.digest && <span className="mt-1 block font-mono text-xs text-fg-subtle">ID: {error.digest}</span>}
      </p>
      <Button variant="primary" onClick={reset}>
        再読み込み
      </Button>
    </main>
  );
}
