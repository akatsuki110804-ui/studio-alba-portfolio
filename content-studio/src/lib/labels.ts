// Client-safe labels & display helpers for enums.
import type { AssetKind, ProjectFormat, ProjectStatus, ShotStatus } from "@/generated/prisma/enums";

export const PROJECT_FORMATS: { value: ProjectFormat; label: string; unit: string }[] = [
  { value: "SHORT_VIDEO", label: "ショート動画", unit: "カット" },
  { value: "YOUTUBE", label: "YouTube動画", unit: "カット" },
  { value: "WEB_AD", label: "Web広告（動画）", unit: "カット" },
  { value: "PRODUCT_PR", label: "商品PR", unit: "カット" },
  { value: "SNS_POST", label: "SNS投稿", unit: "コンテンツ" },
  { value: "IMAGE_AD", label: "画像広告", unit: "クリエイティブ" },
  { value: "MANGA", label: "漫画", unit: "コマ" },
  { value: "OTHER", label: "その他", unit: "カット" },
];

export function formatLabel(format: ProjectFormat) {
  return PROJECT_FORMATS.find((f) => f.value === format)?.label ?? format;
}

/** The word used for a "shot" in this format (カット / コマ / コンテンツ …). */
export function unitLabel(format: ProjectFormat) {
  return PROJECT_FORMATS.find((f) => f.value === format)?.unit ?? "カット";
}

export const PROJECT_STATUSES: { value: ProjectStatus; label: string; tone: Tone }[] = [
  { value: "PLANNING", label: "企画中", tone: "gray" },
  { value: "IN_PROGRESS", label: "制作中", tone: "blue" },
  { value: "REVIEW", label: "確認待ち", tone: "amber" },
  { value: "DELIVERED", label: "納品済み", tone: "green" },
  { value: "ARCHIVED", label: "アーカイブ", tone: "gray" },
];

export const SHOT_STATUSES: { value: ShotStatus; label: string; tone: Tone }[] = [
  { value: "TODO", label: "未着手", tone: "gray" },
  { value: "PROMPT_READY", label: "Prompt作成済み", tone: "violet" },
  { value: "IMAGE_DONE", label: "画像生成済み", tone: "blue" },
  { value: "VIDEO_DONE", label: "動画生成済み", tone: "cyan" },
  { value: "REVISING", label: "修正中", tone: "amber" },
  { value: "DONE", label: "完了", tone: "green" },
];

export const ASSET_KINDS: { value: AssetKind; label: string }[] = [
  { value: "IMAGE", label: "画像" },
  { value: "VIDEO", label: "動画" },
  { value: "AUDIO", label: "音声" },
  { value: "OTHER", label: "その他" },
];

export type Tone = "gray" | "blue" | "violet" | "cyan" | "amber" | "green" | "red";

export function projectStatusMeta(status: ProjectStatus) {
  return PROJECT_STATUSES.find((s) => s.value === status) ?? PROJECT_STATUSES[0];
}

export function shotStatusMeta(status: ShotStatus) {
  return SHOT_STATUSES.find((s) => s.value === status) ?? SHOT_STATUSES[0];
}

export function assetKindLabel(kind: AssetKind) {
  return ASSET_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

/** Share of shots marked DONE, 0–100. */
export function progressPercent(counts: Partial<Record<ShotStatus, number>>) {
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  if (total === 0) return 0;
  return Math.round(((counts.DONE ?? 0) / total) * 100);
}

export function formatDate(date: Date | string | null | undefined) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tokyo" });
}

export function formatDateTime(date: Date | string | null | undefined) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Days until due date (negative = overdue). */
export function daysUntil(date: Date | string | null | undefined) {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
