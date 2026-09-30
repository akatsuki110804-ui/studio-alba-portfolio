import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { UserFacingError } from "@/lib/errors";
import {
  EntityDescriptionSchema,
  ScriptAnalysisSchema,
  ShotPromptPartsSchema,
} from "../schemas";
import type { AIProvider, AnalyzeScriptInput, DescribeEntityInput, ProjectContext, ShotPromptInput } from "../types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

const DEFAULT_MODEL = "claude-opus-5-5";

function projectBlock(p: ProjectContext) {
  return [
    `Project: ${p.title}`,
    `Format: ${p.format}`,
    p.platform && `Platform: ${p.platform}`,
    `Aspect ratio: ${p.aspectRatio}`,
    p.styleGuide && `Visual direction / style guide: ${p.styleGuide}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const ANALYZE_SYSTEM = `You are a production coordinator for AI-generated video and image content.
You break scripts down into a shot list that a solo creator will execute with tools such as Nano Banana, Kling, Veo and Midjourney.

Rules:
- Write every value in the script's language (usually Japanese), except where a field says otherwise.
- Only list characters and locations that actually appear. Do not invent names.
- If a known character/location is referenced, reuse its exact name; put alternate spellings/honorifics in aliases.
- Fill appearance fields only with what the script states or strongly implies; leave a field empty rather than guessing wildly.
- Split into shots the way an editor would cut: one clear visual beat per shot, typically 2–6 seconds for short-form video.
- Put on-screen lines in dialogue and voice-over (ナレーション / N: / NA:) in narration; keep the original wording, it becomes subtitles.
- Every shot's characters must match characters[].name and its location must match locations[].name (or be empty).
- Suggest practical camera and composition choices suited to the format and aspect ratio.`;

const DESCRIBE_SYSTEM = `You write reusable "character sheet" and "location sheet" descriptors for image/video generation prompts.
The output is inserted verbatim into every prompt, so it must be:
- English, one dense sentence of comma-separated visual descriptors (max ~60 words).
- Purely visual and stable across shots: no actions, no emotions of the moment, no camera terms.
- For people: apparent age, gender, ethnicity if stated, face, hair style & color, build, outfit, signature details.
- For places: type of place, architecture/interior, materials, color palette, signature props, atmosphere.
promptName: a short English label — romanize Japanese person names (高橋 → Takahashi); use an English noun phrase for places (カフェ → Cozy Cafe).`;

const SHOT_SYSTEM = `You write the shot-specific part of prompts for AI image and video generators.
Character and location descriptions are appended automatically after your text, so:
- Refer to characters ONLY by the given English promptName (e.g. "Takahashi"), never re-describe their appearance.
- Refer to the location briefly by its promptName; do not re-describe it.
imageScene: one English paragraph for a single still frame — subject and pose/action, facial expression, framing (shot size), camera angle, composition, lighting and time of day. No style words (style is appended separately).
videoMotion: one or two English sentences for image-to-video — what moves (subject action, gestures, dialogue delivery), camera movement and pacing across the clip.
Return one entry per input shot, echoing its ref exactly.`;

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  readonly label = "Claude (Anthropic)";
  private client: Anthropic;
  private model: string;
  private effort: Effort;

  constructor(apiKey: string) {
    // Server-side only: the key never leaves the server.
    this.client = new Anthropic({ apiKey });
    this.model = process.env.AI_MODEL || DEFAULT_MODEL;
    const effort = process.env.AI_EFFORT as Effort | undefined;
    this.effort = effort && EFFORTS.includes(effort) ? effort : "medium";
  }

  private async structured<S extends z.ZodType>(opts: {
    system: string;
    user: string;
    schema: S;
    maxTokens: number;
  }): Promise<z.infer<S>> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
        output_config: { format: betaZodOutputFormat(opts.schema), effort: this.effort },
        // Re-run on a fallback model if a safety classifier declines the request.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (error) {
      throw mapAnthropicError(error);
    }

    if (response.stop_reason === "refusal") {
      throw new UserFacingError("AIがこの内容の処理を拒否しました。台本や設定の表現を見直してください。");
    }
    if (response.stop_reason === "max_tokens") {
      throw new UserFacingError("AIの出力が長すぎて途中で終了しました。台本を分割して解析してください。");
    }
    if (!response.parsed_output) {
      throw new UserFacingError("AIの出力を読み取れませんでした。もう一度お試しください。");
    }
    return response.parsed_output as z.infer<S>;
  }

  async analyzeScript(input: AnalyzeScriptInput) {
    const known = [
      input.knownCharacters.length > 0 &&
        `Known characters: ${input.knownCharacters.map((c) => [c.name, ...c.aliases].join(" / ")).join(", ")}`,
      input.knownLocations.length > 0 &&
        `Known locations: ${input.knownLocations.map((l) => [l.name, ...l.aliases].join(" / ")).join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n");

    const user = `${projectBlock(input.project)}
${known}

<script>
${input.script}
</script>

Break this script down into characters, locations, scenes and shots.`;

    return this.structured({ system: ANALYZE_SYSTEM, user, schema: ScriptAnalysisSchema, maxTokens: 16000 });
  }

  async describeEntity(input: DescribeEntityInput) {
    const fields = Object.entries(input.fields)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n");
    const user = `${projectBlock(input.project)}

Write the ${input.kind === "character" ? "character" : "location"} sheet for "${input.name}".
Known details (may be Japanese):
${fields || "(no details yet — infer something plausible and neutral from the name and project)"}`;
    return this.structured({ system: DESCRIBE_SYSTEM, user, schema: EntityDescriptionSchema, maxTokens: 2000 });
  }

  async generateShotPromptParts(input: { project: ProjectContext; shots: ShotPromptInput[] }) {
    const shots = input.shots.map((s) => ({
      ref: s.ref,
      scene: s.scene,
      description: s.description,
      action: s.action,
      dialogue: s.dialogue,
      emotion: s.emotion,
      timeOfDay: s.timeOfDay,
      props: s.props,
      camera: s.camera,
      composition: s.composition,
      durationSec: s.durationSec,
      characters: s.characters.map((c) => c.promptName || c.name),
      location: s.location ? s.location.promptName || s.location.name : "",
    }));
    const user = `${projectBlock(input.project)}

Shots (JSON):
${JSON.stringify(shots, null, 2)}`;
    const result = await this.structured({
      system: SHOT_SYSTEM,
      user,
      schema: ShotPromptPartsSchema,
      maxTokens: 16000,
    });
    return result.shots;
  }
}

function mapAnthropicError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError) {
    return new UserFacingError("AIのAPIキーが無効です。サーバーの ANTHROPIC_API_KEY を確認してください。");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new UserFacingError("AIの利用上限に達しました。少し待ってから再度お試しください。");
  }
  if (error instanceof Anthropic.BadRequestError) {
    console.error("[ai] bad request", error.message);
    return new UserFacingError("AIへのリクエストが不正です（入力が長すぎる可能性があります）。");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new UserFacingError("AIサービスに接続できませんでした。ネットワークを確認してください。");
  }
  if (error instanceof Anthropic.APIError) {
    console.error("[ai] api error", error.status, error.message);
    return new UserFacingError("AIサービスでエラーが発生しました。時間をおいて再度お試しください。");
  }
  return error instanceof Error ? error : new Error(String(error));
}
