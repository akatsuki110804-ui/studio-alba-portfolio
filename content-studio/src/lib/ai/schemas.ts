import { z } from "zod";

// Every field is required (empty string / empty array when unknown) so the same
// schema works for strict structured outputs and for the rule-based mock provider.

export const AnalyzedCharacterSchema = z.object({
  name: z.string().describe("Name exactly as written in the script (Japanese if the script is Japanese)"),
  aliases: z.array(z.string()).describe("Other ways the script refers to this person, e.g. 高橋さん, 高橋部長"),
  age: z.string(),
  gender: z.string(),
  appearance: z.string(),
  hairStyle: z.string(),
  hairColor: z.string(),
  outfit: z.string(),
  build: z.string(),
  vibe: z.string(),
  notes: z.string(),
});

export const AnalyzedLocationSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  exterior: z.string(),
  interior: z.string(),
  colors: z.string(),
  mood: z.string(),
  timeOfDay: z.string(),
  lighting: z.string(),
  props: z.string(),
});

export const AnalyzedShotSchema = z.object({
  description: z.string().describe("What the viewer sees in this shot (Japanese)"),
  characters: z.array(z.string()).describe("Character names appearing in the shot (must match characters[].name)"),
  location: z.string().describe("Location name (must match locations[].name) or empty"),
  action: z.string(),
  dialogue: z.string().describe("Lines spoken on screen by characters"),
  narration: z.string().describe("Voice-over / narration text for this shot (not spoken on screen), empty if none"),
  emotion: z.string(),
  timeOfDay: z.string(),
  props: z.string(),
  camera: z.string().describe("Shot size and camera movement, e.g. ミディアムショット / ゆっくりズームイン"),
  composition: z.string(),
  durationSec: z.number().describe("Estimated duration in seconds, 0 if unknown"),
  requiredAssets: z.array(z.string()).describe("Materials needed besides the visual, e.g. ナレーション, SE, テロップ"),
});

export const ScriptAnalysisSchema = z.object({
  summary: z.string(),
  characters: z.array(AnalyzedCharacterSchema),
  locations: z.array(AnalyzedLocationSchema),
  scenes: z.array(
    z.object({
      label: z.string().describe("Short scene label, e.g. S1 カフェ・朝"),
      location: z.string(),
      timeOfDay: z.string(),
      summary: z.string(),
      shots: z.array(AnalyzedShotSchema),
    }),
  ),
  props: z.array(z.string()),
  requiredAssets: z.array(z.string()).describe("Project-wide materials: ナレーション, BGM, 字幕, ロゴ…"),
});

export type ScriptAnalysis = z.infer<typeof ScriptAnalysisSchema>;
export type AnalyzedShot = z.infer<typeof AnalyzedShotSchema>;

export const EntityDescriptionSchema = z.object({
  promptName: z.string().describe("Short English label (romanized name for people, e.g. Takahashi; English noun for places, e.g. Cafe)"),
  promptDescription: z.string().describe("One dense English sentence of visual descriptors"),
});
export type EntityDescription = z.infer<typeof EntityDescriptionSchema>;

export const ShotPromptPartsSchema = z.object({
  shots: z.array(
    z.object({
      ref: z.string(),
      imageScene: z.string().describe("English: subject, action, framing, composition, camera angle, lighting for a single still frame"),
      videoMotion: z.string().describe("English: what moves over the clip — subject action, camera movement, pacing"),
    }),
  ),
});
export type ShotPromptParts = z.infer<typeof ShotPromptPartsSchema>["shots"][number];
