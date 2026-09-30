import type { AssetKind, PromptKind, PromptSource, ShotStatus } from "@/generated/prisma/enums";

// Serializable view models passed from the server page to the client board.

export type PromptInfo = {
  id: string;
  kind: PromptKind;
  content: string;
  version: number;
  source: PromptSource;
  createdAt: string;
  stale: boolean;
};

export type AssetVersionRow = {
  id: string;
  version: number;
  url: string | null; // our file route (uploads)
  externalUrl: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  note: string;
  createdAt: string;
};

export type AssetRow = {
  id: string;
  kind: AssetKind;
  label: string;
  versions: AssetVersionRow[]; // newest first
};

export type ShotRow = {
  id: string;
  order: number;
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
  notes: string;
  status: ShotStatus;
  locationId: string | null;
  characterIds: string[];
  imagePrompt: PromptInfo | null;
  videoPrompt: PromptInfo | null;
  promptHistory: PromptInfo[];
  assets: AssetRow[];
};

export type EntityOption = { id: string; name: string; imageUrl: string | null; hasSheet: boolean };
