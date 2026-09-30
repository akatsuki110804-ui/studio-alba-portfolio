// Deterministic prompt assembly. The AI writes only the shot-specific part
// (scene / motion); character, location and style blocks are injected verbatim
// here so the same character always gets exactly the same description.

export type PromptEntity = { name: string; promptName: string; promptDescription: string };

export type ComposeInput = {
  imageScene: string;
  videoMotion: string;
  characters: PromptEntity[];
  location: PromptEntity | null;
  styleGuide: string;
  aspectRatio: string;
  durationSec: number | null;
};

export type PromptTarget = {
  id: string;
  label: string;
  image: (input: ComposeInput) => string;
  video: (input: ComposeInput) => string;
};

function entityLine(e: PromptEntity) {
  const label = e.promptName || e.name;
  const desc = e.promptDescription.trim();
  return desc && desc !== label ? `${label}: ${desc}` : label;
}

function sentence(text: string) {
  const t = text.trim();
  if (!t) return "";
  return /[.。!?！？]$/.test(t) ? t : `${t}.`;
}

const generic: PromptTarget = {
  id: "generic",
  label: "汎用",
  image: (i) =>
    [
      sentence(i.imageScene),
      i.characters.length > 0 && `Characters — ${i.characters.map(entityLine).map(sentence).join(" ")}`,
      i.location && `Setting — ${sentence(entityLine(i.location))}`,
      i.styleGuide && `Style — ${sentence(i.styleGuide)}`,
      i.aspectRatio && `Aspect ratio ${i.aspectRatio}.`,
    ]
      .filter(Boolean)
      .join("\n"),
  video: (i) =>
    [
      sentence(i.videoMotion),
      i.characters.length > 0 && `Characters — ${i.characters.map(entityLine).map(sentence).join(" ")}`,
      i.location && `Setting — ${sentence(entityLine(i.location))}`,
      i.styleGuide && `Style — ${sentence(i.styleGuide)}`,
      [i.durationSec ? `Duration ${i.durationSec}s` : "", i.aspectRatio ? `aspect ratio ${i.aspectRatio}` : ""]
        .filter(Boolean)
        .join(", ") + (i.durationSec || i.aspectRatio ? "." : ""),
    ]
      .filter(Boolean)
      .join("\n"),
};

/**
 * Registry of prompt formats. Add tool-specific formatters here
 * (e.g. "midjourney" appending `--ar 9:16`, "kling", "veo"…) — the data
 * model already stores prompts per target.
 */
export const PROMPT_TARGETS: Record<string, PromptTarget> = {
  [generic.id]: generic,
};

export const DEFAULT_TARGET = generic.id;

export function composeImagePrompt(input: ComposeInput, target = DEFAULT_TARGET) {
  return (PROMPT_TARGETS[target] ?? generic).image(input);
}

export function composeVideoPrompt(input: ComposeInput, target = DEFAULT_TARGET) {
  return (PROMPT_TARGETS[target] ?? generic).video(input);
}
