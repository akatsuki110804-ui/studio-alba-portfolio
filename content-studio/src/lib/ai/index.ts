import "server-only";
import { AnthropicProvider } from "./providers/anthropic";
import { MockProvider } from "./providers/mock";
import type { ScriptAnalysis } from "./schemas";
import type { AIProvider, AnalyzeScriptInput, DescribeEntityInput, ProjectContext, ShotPromptInput } from "./types";
import { composeImagePrompt, composeVideoPrompt, DEFAULT_TARGET } from "@/lib/prompts/compose";

export type { ScriptAnalysis } from "./schemas";
export type { ProjectContext, ShotPromptInput } from "./types";

let cached: AIProvider | null = null;

/** Picks the provider from env. Secrets are read server-side only. */
export function getAIProvider(): AIProvider {
  if (cached) return cached;
  const key = process.env.ANTHROPIC_API_KEY;
  const configured = (process.env.AI_PROVIDER || (key ? "anthropic" : "mock")).toLowerCase();
  if (configured === "anthropic") {
    if (!key) {
      console.warn("[ai] AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty — falling back to mock provider");
      cached = new MockProvider();
    } else {
      cached = new AnthropicProvider(key);
    }
  } else {
    cached = new MockProvider();
  }
  return cached;
}

export function aiProviderInfo() {
  const p = getAIProvider();
  return { id: p.id, label: p.label, isMock: p.id === "mock" };
}

// ── Script → structure ────────────────────────────────────────────

export function generateScriptAnalysis(input: AnalyzeScriptInput): Promise<ScriptAnalysis> {
  return getAIProvider().analyzeScript(input);
}

export function generateCharacters(analysis: ScriptAnalysis) {
  return analysis.characters.filter((c) => c.name.trim());
}

export function generateLocations(analysis: ScriptAnalysis) {
  return analysis.locations.filter((l) => l.name.trim());
}

export function generateShots(analysis: ScriptAnalysis) {
  return analysis.scenes.flatMap((scene) =>
    scene.shots.map((shot) => ({
      ...shot,
      scene: scene.label,
      location: shot.location || scene.location,
      timeOfDay: shot.timeOfDay || scene.timeOfDay,
    })),
  );
}

// ── Bible entries ────────────────────────────────────────────────

export function generateEntityDescription(input: DescribeEntityInput) {
  return getAIProvider().describeEntity(input);
}

// ── Prompts ──────────────────────────────────────────────────────

const PROMPT_BATCH_SIZE = 12;

export type GeneratedShotPrompts = { ref: string; image: string; video: string };

/**
 * Generates image + video prompts for many shots. The AI writes the shot-specific
 * part in batches; the final prompt is composed deterministically.
 */
export async function generateShotPrompts(
  project: ProjectContext,
  shots: ShotPromptInput[],
  target = DEFAULT_TARGET,
): Promise<GeneratedShotPrompts[]> {
  const provider = getAIProvider();
  const results: GeneratedShotPrompts[] = [];
  for (let i = 0; i < shots.length; i += PROMPT_BATCH_SIZE) {
    const batch = shots.slice(i, i + PROMPT_BATCH_SIZE);
    const parts = await provider.generateShotPromptParts({ project, shots: batch });
    const byRef = new Map(parts.map((p) => [p.ref, p]));
    for (const shot of batch) {
      const p = byRef.get(shot.ref);
      const input = {
        imageScene: p?.imageScene || shot.description,
        videoMotion: p?.videoMotion || shot.action || shot.description,
        characters: shot.characters,
        location: shot.location,
        styleGuide: project.styleGuide,
        aspectRatio: project.aspectRatio,
        durationSec: shot.durationSec,
      };
      results.push({ ref: shot.ref, image: generateImagePrompt(input, target), video: generateVideoPrompt(input, target) });
    }
  }
  return results;
}

export const generateImagePrompt = composeImagePrompt;
export const generateVideoPrompt = composeVideoPrompt;
