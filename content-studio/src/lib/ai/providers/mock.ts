import type { AnalyzedShot, ScriptAnalysis } from "../schemas";
import type { AIProvider, AnalyzeScriptInput, DescribeEntityInput, ProjectContext, ShotPromptInput } from "../types";

/**
 * Rule-based provider used when no AI API key is configured.
 * It is intentionally simple — good enough to demo the whole workflow offline
 * and to run the app in development/CI without spending tokens.
 */

const LOCATION_KEYWORDS = [
  "カフェ", "喫茶店", "オフィス", "会議室", "自宅", "部屋", "リビング", "キッチン", "寝室", "玄関",
  "屋外", "公園", "駅", "ホーム", "店舗", "レストラン", "バー", "ホテル", "学校", "教室", "廊下",
  "屋上", "街", "商店街", "路地", "海", "浜辺", "山", "車内", "病院", "神社", "工房", "スタジオ", "教室",
];

const TIME_KEYWORDS: [RegExp, string][] = [
  [/深夜|真夜中/, "深夜"],
  [/夜/, "夜"],
  [/夕方|夕暮れ|夕日/, "夕方"],
  [/昼|日中/, "昼"],
  [/朝|早朝/, "朝"],
];

const EMOTION_KEYWORDS: [RegExp, string][] = [
  [/笑|微笑|ほほえ/, "笑顔・穏やか"],
  [/驚/, "驚き"],
  [/泣|涙/, "悲しみ"],
  [/怒|苛立/, "怒り"],
  [/緊張|焦/, "緊張"],
  [/照れ/, "照れ"],
];

const NOT_NAMES = new Set(["二人", "三人", "全員", "彼", "彼女", "私", "僕", "俺", "皆", "客", "店員", "一同", "カメラ", "画面"]);

const NARRATION_LINE = /^(?:ナレーション|ナレ|NA|N|Ｎ|ＮＡ)\s*[:：「]\s*(.+?)」?$/;

const SCENE_HEADING = /^(?:#+\s*|[○◯●■□]\s*|S\s*\d+[\s.:：]*|シーン\s*\d*[\s.:：]*|【(.+)】$)/i;

function detectFrom<T extends string>(text: string, table: [RegExp, T][]) {
  return table.find(([re]) => re.test(text))?.[1] ?? "";
}

function uniq<T>(items: T[]) {
  return [...new Set(items)];
}

export class MockProvider implements AIProvider {
  readonly id = "mock";
  readonly label = "デモモード（ルールベース）";

  async analyzeScript(input: AnalyzeScriptInput): Promise<ScriptAnalysis> {
    const knownChars = input.knownCharacters;
    const knownLocs = input.knownLocations;
    const lines = input.script
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const characterNames: string[] = [];
    const locationNames: string[] = [];
    const scenes: ScriptAnalysis["scenes"] = [];
    let current: ScriptAnalysis["scenes"][number] | null = null;
    let lastLocation = "";
    let lastTime = "";

    const findLocation = (text: string) => {
      const known = knownLocs.find((l) => [l.name, ...l.aliases].some((n) => n && text.includes(n)));
      if (known) return known.name;
      return LOCATION_KEYWORDS.find((k) => text.includes(k)) ?? "";
    };

    const findCharacters = (text: string) => {
      const found: string[] = [];
      for (const c of knownChars) {
        if ([c.name, ...c.aliases].some((n) => n && text.includes(n))) found.push(c.name);
      }
      for (const n of characterNames) if (text.includes(n)) found.push(n);
      // New names: kanji/katakana at sentence start followed by a particle or a quote.
      const re = /(?:^|[。、\s])([一-龯々ァ-ヶー]{1,5}?)(?:さん|くん|ちゃん|先生|部長|課長|社長)?(?:が|は|と|も|「|：|:)/g;
      for (const m of text.matchAll(re)) {
        const name = m[1];
        if (!NOT_NAMES.has(name) && !LOCATION_KEYWORDS.includes(name)) found.push(name);
      }
      return uniq(found);
    };

    for (const line of lines) {
      const heading = line.match(SCENE_HEADING);
      if (heading) {
        const label = (heading[1] ?? line.replace(SCENE_HEADING, "")).trim() || `シーン${scenes.length + 1}`;
        lastLocation = findLocation(label) || lastLocation;
        lastTime = detectFrom(label, TIME_KEYWORDS) || lastTime;
        current = { label: `S${scenes.length + 1} ${label}`, location: lastLocation, timeOfDay: lastTime, summary: "", shots: [] };
        scenes.push(current);
        if (lastLocation) locationNames.push(lastLocation);
        continue;
      }

      if (!current) {
        current = { label: "S1", location: "", timeOfDay: "", summary: "", shots: [] };
        scenes.push(current);
      }

      // Narration lines ("ナレーション：…", "N：…", "NA：…") attach to the previous shot.
      const narrationMatch = line.match(NARRATION_LINE);
      if (narrationMatch) {
        const text = narrationMatch[1].trim();
        const prev = current.shots[current.shots.length - 1];
        if (prev) {
          prev.narration = prev.narration ? `${prev.narration}${text}` : text;
          if (!prev.requiredAssets.includes("ナレーション音声")) prev.requiredAssets.push("ナレーション音声");
          continue;
        }
      }

      const location = findLocation(line) || lastLocation;
      if (location && location !== lastLocation && current.shots.length > 0) {
        // New location → new scene
        current = { label: `S${scenes.length + 1} ${location}`, location, timeOfDay: lastTime, summary: "", shots: [] };
        scenes.push(current);
      }
      if (location) {
        lastLocation = location;
        locationNames.push(location);
        if (!current.location) current.location = location;
      }
      lastTime = detectFrom(line, TIME_KEYWORDS) || lastTime;

      const chars = findCharacters(line);
      characterNames.push(...chars);

      const dialogueMatch = line.match(/「(.+?)」/) ?? line.match(/^[^：:]{1,8}[：:]\s*(.+)$/);
      const dialogue = dialogueMatch?.[1] ?? "";
      const isFirst = current.shots.length === 0;

      const shot: AnalyzedShot = {
        description: line,
        characters: chars,
        location,
        action: dialogue ? "会話する" : line.replace(/「.+?」/g, "").replace(/。$/, ""),
        dialogue,
        narration: narrationMatch ? narrationMatch[1].trim() : "",
        emotion: detectFrom(line, EMOTION_KEYWORDS),
        timeOfDay: lastTime,
        props: "",
        camera: isFirst
          ? "ワイドショット（状況説明）"
          : dialogue
            ? "ミディアムショット"
            : /振り返|見つめ|気づ/.test(line)
              ? "バストアップ"
              : "ミディアムショット",
        composition: chars.length >= 2 ? "二人を左右に配置" : chars.length === 1 ? "人物を三分割線上に配置" : "",
        durationSec: dialogue ? 4 : 3,
        requiredAssets: dialogue ? ["セリフ音声"] : [],
      };
      current.shots.push(shot);
      if (!current.summary) current.summary = line;
    }

    const allCharacters = uniq(characterNames);
    const allLocations = uniq(locationNames);

    return {
      summary: lines.slice(0, 2).join(" "),
      characters: allCharacters.map((name) => ({
        name,
        aliases: [],
        age: "",
        gender: "",
        appearance: "",
        hairStyle: "",
        hairColor: "",
        outfit: "",
        build: "",
        vibe: "",
        notes: "",
      })),
      locations: allLocations.map((name) => ({
        name,
        aliases: [],
        exterior: "",
        interior: "",
        colors: "",
        mood: "",
        timeOfDay: "",
        lighting: "",
        props: "",
      })),
      scenes: scenes.filter((s) => s.shots.length > 0),
      props: [],
      requiredAssets: [
        ...(scenes.some((s) => s.shots.some((sh) => sh.dialogue)) ? ["セリフ音声"] : []),
        ...(scenes.some((s) => s.shots.some((sh) => sh.narration)) ? ["ナレーション音声"] : []),
        "字幕",
      ],
    };
  }

  async describeEntity(input: DescribeEntityInput) {
    const values = Object.values(input.fields).filter(Boolean);
    return {
      promptName: input.name,
      promptDescription: values.length > 0 ? values.join(", ") : input.name,
    };
  }

  async generateShotPromptParts(input: { project: ProjectContext; shots: ShotPromptInput[] }) {
    return input.shots.map((s) => {
      const who = s.characters.map((c) => c.promptName || c.name).join(" and ");
      const where = s.location ? ` in ${s.location.promptName || s.location.name}` : "";
      const imageScene = [
        s.camera,
        `${who ? `${who}${where}` : `Scene${where}`}: ${s.description}`,
        s.emotion && `expression: ${s.emotion}`,
        s.composition,
        s.timeOfDay && `time of day: ${s.timeOfDay}`,
      ]
        .filter(Boolean)
        .join(", ");
      const videoMotion = [
        s.action || s.description,
        s.dialogue && `speaking: 「${s.dialogue}」`,
        "subtle handheld camera, natural motion",
      ]
        .filter(Boolean)
        .join(", ");
      return { ref: s.ref, imageScene, videoMotion };
    });
  }
}
