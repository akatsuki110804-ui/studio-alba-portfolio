// A prompt is stale when anything that fed into it changed after it was created.
export function isPromptStale(
  promptCreatedAt: Date,
  sources: { shotContentUpdatedAt: Date; projectPromptContextUpdatedAt: Date; entityUpdatedAts: Date[] },
) {
  const created = promptCreatedAt.getTime();
  return (
    sources.shotContentUpdatedAt.getTime() > created ||
    sources.projectPromptContextUpdatedAt.getTime() > created ||
    sources.entityUpdatedAts.some((d) => d.getTime() > created)
  );
}
