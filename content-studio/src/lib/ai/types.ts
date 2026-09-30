import type { EntityDescription, ScriptAnalysis, ShotPromptParts } from "./schemas";

export type ProjectContext = {
  title: string;
  format: string; // human label, e.g. ショート動画
  platform: string;
  aspectRatio: string;
  styleGuide: string;
};

export type KnownEntity = { name: string; aliases: string[] };

export type AnalyzeScriptInput = {
  script: string;
  project: ProjectContext;
  knownCharacters: KnownEntity[];
  knownLocations: KnownEntity[];
};

export type DescribeEntityInput = {
  kind: "character" | "location";
  name: string;
  /** Japanese field label → value (only non-empty fields). */
  fields: Record<string, string>;
  project: ProjectContext;
};

export type ShotPromptInput = {
  ref: string;
  scene: string;
  description: string;
  action: string;
  dialogue: string;
  emotion: string;
  timeOfDay: string;
  props: string;
  camera: string;
  composition: string;
  durationSec: number | null;
  characters: { name: string; promptName: string; promptDescription: string }[];
  location: { name: string; promptName: string; promptDescription: string } | null;
};

/**
 * Provider-agnostic AI interface. Swap implementations (Anthropic, mock, …)
 * without touching the rest of the app. Providers only return *content*;
 * persistence and prompt assembly happen elsewhere.
 */
export interface AIProvider {
  readonly id: string;
  readonly label: string;
  analyzeScript(input: AnalyzeScriptInput): Promise<ScriptAnalysis>;
  describeEntity(input: DescribeEntityInput): Promise<EntityDescription>;
  generateShotPromptParts(input: { project: ProjectContext; shots: ShotPromptInput[] }): Promise<ShotPromptParts[]>;
}
