export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8" aria-busy="true" aria-label="読み込み中">
      <div className="mb-6 h-8 w-48 animate-pulse rounded-md bg-surface-3" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl bg-surface-2" />
        ))}
      </div>
    </main>
  );
}
