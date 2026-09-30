// Pure timeline / subtitle / Premiere XML builders for the edit kit (no browser APIs).

export type KitMedia = {
  url: string;
  /** File name inside the kit, e.g. "cut01_video_v3.mp4" */
  kitName: string;
  /** Measured length in seconds (videos / audio). */
  durationSec?: number | null;
};

export type KitShotInput = {
  no: number;
  label: string; // e.g. "カット01"
  dialogue: string;
  narration: string;
  notes: string;
  /** Planned length from the shot list. */
  plannedSec: number | null;
  visual: (KitMedia & { kind: "VIDEO" | "IMAGE" }) | null;
  narrationAudio: KitMedia | null;
};

export type KitSettings = {
  title: string;
  fps: number;
  width: number;
  height: number;
  bgm: KitMedia | null;
  /** BGM gain as linear amplitude (0.25 ≈ -12dB). */
  bgmLevel: number;
};

export type TimelineClip = {
  shot: KitShotInput;
  startSec: number;
  durationSec: number;
  startFrame: number;
  endFrame: number;
  /** Why the length was chosen, shown in the UI. */
  lengthSource: "narration" | "planned" | "video" | "default";
  /** Seconds of video missing when the video is shorter than the cut. */
  videoShortBySec: number;
};

export type Timeline = { clips: TimelineClip[]; totalSec: number; totalFrames: number };

const DEFAULT_SEC = 3;
/** Breathing room after narration ends. */
const NARRATION_PAD_SEC = 0.4;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Decides each cut's length: narration audio > planned seconds > video length > 3s. */
export function buildTimeline(shots: KitShotInput[], fps: number): Timeline {
  let cursor = 0;
  const clips: TimelineClip[] = shots.map((shot) => {
    const narr = shot.narrationAudio?.durationSec;
    const video = shot.visual?.kind === "VIDEO" ? shot.visual.durationSec : null;
    let durationSec: number;
    let lengthSource: TimelineClip["lengthSource"];
    if (narr && narr > 0) {
      durationSec = round2(narr + NARRATION_PAD_SEC);
      lengthSource = "narration";
    } else if (shot.plannedSec && shot.plannedSec > 0) {
      durationSec = shot.plannedSec;
      lengthSource = "planned";
    } else if (video && video > 0) {
      durationSec = round2(video);
      lengthSource = "video";
    } else {
      durationSec = DEFAULT_SEC;
      lengthSource = "default";
    }
    const startSec = cursor;
    cursor = round2(cursor + durationSec);
    return {
      shot,
      startSec,
      durationSec,
      // Frames from absolute seconds so rounding never drifts across many cuts.
      startFrame: Math.round(startSec * fps),
      endFrame: Math.round(cursor * fps),
      lengthSource,
      videoShortBySec: video && video > 0 && video + 0.05 < durationSec ? round2(durationSec - video) : 0,
    };
  });
  return { clips, totalSec: cursor, totalFrames: Math.round(cursor * fps) };
}

// ── Subtitles (SRT) ─────────────────────────────────────────────

const MAX_CUE_CHARS = 32;

/** Splits text into readable cues at sentence ends, then by length. */
export function splitSubtitle(text: string): string[] {
  const sentences = text
    .replace(/\r/g, "")
    .split(/(?<=[。！？!?])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const cues: string[] = [];
  for (const s of sentences) {
    if (s.length <= MAX_CUE_CHARS) {
      cues.push(s);
      continue;
    }
    // Prefer breaking after 、 or a space; otherwise hard-wrap.
    let rest = s;
    while (rest.length > MAX_CUE_CHARS) {
      const window = rest.slice(0, MAX_CUE_CHARS);
      const cut = Math.max(window.lastIndexOf("、"), window.lastIndexOf("，"), window.lastIndexOf(" "));
      const at = cut >= MAX_CUE_CHARS / 2 ? cut + 1 : MAX_CUE_CHARS;
      cues.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) cues.push(rest);
  }
  return cues;
}

function srtTime(sec: number) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function subtitleText(shot: Pick<KitShotInput, "dialogue" | "narration">) {
  return [shot.dialogue, shot.narration].map((t) => t.trim()).filter(Boolean).join("\n");
}

/** One or more cues per cut, time shared in proportion to text length. */
export function buildSrt(timeline: Timeline) {
  const out: string[] = [];
  let index = 1;
  for (const clip of timeline.clips) {
    const cues = splitSubtitle(subtitleText(clip.shot));
    if (cues.length === 0) continue;
    const totalChars = cues.reduce((n, c) => n + c.length, 0);
    let t = clip.startSec;
    for (const cue of cues) {
      const len = (clip.durationSec * cue.length) / totalChars;
      out.push(`${index++}\n${srtTime(t)} --> ${srtTime(t + len - 0.04)}\n${cue}\n`);
      t += len;
    }
  }
  return out.join("\n");
}

// ── Premiere Pro XML (Final Cut Pro 7 XML / xmeml) ──────────────

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rate(fps: number) {
  return `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`;
}

/** Relative to the kit folder; Premiere asks to relink once and then finds the rest by name. */
function pathUrl(kitName: string) {
  return `file://localhost/media/${encodeURIComponent(kitName)}`;
}

function audioFile(id: string, media: KitMedia, fps: number) {
  const frames = Math.max(1, Math.round((media.durationSec ?? 0) * fps));
  return `<file id="${id}"><name>${esc(media.kitName)}</name><pathurl>${pathUrl(media.kitName)}</pathurl>${rate(fps)}<duration>${frames}</duration><media><audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio></media></file>`;
}

function levelFilter(level: number) {
  return `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype><parameter><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>${level}</value></parameter></effect></filter>`;
}

export function buildPremiereXml(timeline: Timeline, settings: KitSettings) {
  const { fps, width, height } = settings;
  let ids = 0;
  const nextId = (p: string) => `${p}-${++ids}`;

  // V1: pictures
  const videoItems = timeline.clips
    .filter((c) => c.shot.visual)
    .map((c) => {
      const v = c.shot.visual!;
      const fileId = nextId("file");
      const clipFrames = c.endFrame - c.startFrame;
      const isVideo = v.kind === "VIDEO";
      const sourceFrames = isVideo && v.durationSec ? Math.max(1, Math.round(v.durationSec * fps)) : clipFrames;
      const used = Math.min(clipFrames, sourceFrames);
      return `<clipitem id="${nextId("clipitem")}"><name>${esc(`${c.shot.label} ${v.kitName}`)}</name><enabled>TRUE</enabled><duration>${sourceFrames}</duration>${rate(fps)}<start>${c.startFrame}</start><end>${c.startFrame + used}</end><in>0</in><out>${used}</out><file id="${fileId}"><name>${esc(v.kitName)}</name><pathurl>${pathUrl(v.kitName)}</pathurl>${rate(fps)}<duration>${sourceFrames}</duration><media><video><samplecharacteristics>${rate(fps)}<width>${width}</width><height>${height}</height></samplecharacteristics></video></media></file>${isVideo ? "" : "<stillframe>TRUE</stillframe>"}</clipitem>`;
    })
    .join("");

  // A1: narration
  const narrationItems = timeline.clips
    .filter((c) => c.shot.narrationAudio?.durationSec)
    .map((c) => {
      const a = c.shot.narrationAudio!;
      const frames = Math.max(1, Math.round((a.durationSec ?? 0) * fps));
      return `<clipitem id="${nextId("clipitem")}"><name>${esc(`${c.shot.label} ナレーション`)}</name><enabled>TRUE</enabled><duration>${frames}</duration>${rate(fps)}<start>${c.startFrame}</start><end>${c.startFrame + frames}</end><in>0</in><out>${frames}</out>${audioFile(nextId("file"), a, fps)}<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack></clipitem>`;
    })
    .join("");

  // A2: BGM (lowered), trimmed to the sequence length
  let bgmItem = "";
  if (settings.bgm?.durationSec) {
    const src = Math.max(1, Math.round(settings.bgm.durationSec * fps));
    const used = Math.min(src, timeline.totalFrames);
    bgmItem = `<clipitem id="${nextId("clipitem")}"><name>BGM</name><enabled>TRUE</enabled><duration>${src}</duration>${rate(fps)}<start>0</start><end>${used}</end><in>0</in><out>${used}</out>${audioFile(nextId("file"), settings.bgm, fps)}<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>${levelFilter(settings.bgmLevel)}</clipitem>`;
  }

  // Sequence markers carry each cut's revision notes.
  const markers = timeline.clips
    .map(
      (c) =>
        `<marker><name>${esc(c.shot.label)}</name><comment>${esc(c.shot.notes || subtitleText(c.shot).slice(0, 80))}</comment><in>${c.startFrame}</in><out>-1</out></marker>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
<sequence id="sequence-1">
<name>${esc(settings.title)}</name>
<duration>${timeline.totalFrames}</duration>
${rate(fps)}
<timecode>${rate(fps)}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
<media>
<video>
<format><samplecharacteristics>${rate(fps)}<width>${width}</width><height>${height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>
<track>${videoItems}</track>
</video>
<audio>
<numOutputChannels>2</numOutputChannels>
<format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>
<track>${narrationItems}</track>
<track>${bgmItem}</track>
</audio>
</media>
${markers}
</sequence>
</xmeml>
`;
}

/** Frame size for the project's aspect ratio (1080-based). */
export function frameSize(aspectRatio: string) {
  const map: Record<string, [number, number]> = {
    "9:16": [1080, 1920],
    "16:9": [1920, 1080],
    "1:1": [1080, 1080],
    "4:5": [1080, 1350],
    "4:3": [1440, 1080],
    "21:9": [2560, 1080],
  };
  const [width, height] = map[aspectRatio] ?? [1080, 1920];
  return { width, height };
}
