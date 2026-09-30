import { shotStatusMeta } from "@/lib/labels";
import type { EntityOption, ShotRow } from "./types";

function csvCell(value: string | number | null | undefined) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Shot list as CSV (UTF-8 with BOM so Excel opens Japanese correctly). */
export function shotsToCsv(shots: ShotRow[], characters: EntityOption[], locations: EntityOption[]) {
  const charName = new Map(characters.map((c) => [c.id, c.name]));
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const header = ["No", "シーン", "内容", "登場人物", "場所", "アクション", "セリフ", "感情", "カメラ", "構図", "秒数", "画像Prompt", "動画Prompt", "ステータス", "メモ"];
  const lines = shots.map((s, i) =>
    [
      i + 1,
      s.scene,
      s.description,
      s.characterIds.map((id) => charName.get(id) ?? "").join("・"),
      s.locationId ? (locName.get(s.locationId) ?? "") : "",
      s.action,
      s.dialogue,
      s.emotion,
      s.camera,
      s.composition,
      s.durationSec ?? "",
      s.imagePrompt?.content ?? "",
      s.videoPrompt?.content ?? "",
      shotStatusMeta(s.status).label,
      s.notes,
    ]
      .map(csvCell)
      .join(","),
  );
  return "﻿" + [header.join(","), ...lines].join("\r\n");
}

/** Numbered plain-text list of one prompt kind, ready to paste into a batch tool. */
export function promptsToText(shots: ShotRow[], kind: "image" | "video", unit: string) {
  return shots
    .map((s, i) => {
      const p = kind === "image" ? s.imagePrompt : s.videoPrompt;
      return p ? `【${unit}${String(i + 1).padStart(2, "0")}】\n${p.content}` : null;
    })
    .filter(Boolean)
    .join("\n\n");
}

export function downloadText(filename: string, content: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
