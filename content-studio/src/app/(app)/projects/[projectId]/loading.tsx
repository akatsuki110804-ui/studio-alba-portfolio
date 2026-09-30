export default function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="読み込み中">
      <div className="h-8 w-64 animate-pulse rounded-md bg-surface-3" />
      <div className="h-64 animate-pulse rounded-xl bg-surface-2" />
    </div>
  );
}
