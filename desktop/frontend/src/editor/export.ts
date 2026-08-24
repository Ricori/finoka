import type { EditDocument, EditSegment } from "../documents/types.ts";
import { ASS_EVENTS_HEAD, ASS_SCRIPT_INFO, DEFAULT_ASS_TEMPLATE } from "./constants.ts";


export type ExportLanguage = "ja" | "zh" | "both";

function pad(value: number, width = 2): string {
  return String(Math.max(0, Math.floor(value))).padStart(width, "0");
}

function srtTime(seconds: number): string {
  const millis = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(millis / 3_600_000);
  const minutes = Math.floor(millis / 60_000) % 60;
  const remainder = Math.floor(millis / 1000) % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(remainder)},${pad(millis % 1000, 3)}`;
}

function assTime(seconds: number): string {
  const centis = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centis / 360_000);
  const minutes = Math.floor(centis / 6000) % 60;
  const remainder = Math.floor(centis / 100) % 60;
  return `${hours}:${pad(minutes)}:${pad(remainder)}.${pad(centis % 100)}`;
}

function visibleSegments(document: EditDocument): EditSegment[] {
  return [document.subtitles, ...document.tracks.map((track) => track.segs)]
    .flat()
    .slice()
    .sort((left, right) => left.t0 - right.t0 || left.t1 - right.t1);
}

export function buildSrt(document: EditDocument, language: ExportLanguage): string {
  const cues = visibleSegments(document).flatMap((segment) => {
    const text = language === "ja" ? segment.ja : language === "zh" ? segment.zh : [segment.ja, segment.zh].filter(Boolean).join("\n");
    return text.trim() ? [{ ...segment, text }] : [];
  });
  return cues.map((cue, index) => `${index + 1}\n${srtTime(cue.t0)} --> ${srtTime(cue.t1)}\n${cue.text.trim()}\n`).join("\n");
}

function assText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("{", "\\{").replaceAll("}", "\\}").replaceAll("\n", "\\N");
}

export function buildAss(document: EditDocument): string {
  const lines: string[] = [];
  for (const segment of visibleSegments(document)) {
    if (segment.ja.trim()) lines.push(`Dialogue: 0,${assTime(segment.t0)},${assTime(segment.t1)},JP,,0,0,0,,${assText(segment.ja.trim())}`);
    if (segment.zh.trim()) lines.push(`Dialogue: 0,${assTime(segment.t0)},${assTime(segment.t1)},CN,,0,0,0,,${assText(segment.zh.trim())}`);
  }
  let template = document.ass_template?.trim() || DEFAULT_ASS_TEMPLATE;
  const eventsIndex = template.toLowerCase().indexOf("[events]");
  if (eventsIndex >= 0) template = template.slice(0, eventsIndex).trimEnd();
  const head = template.toLowerCase().includes("[script info]") ? template : ASS_SCRIPT_INFO + template;
  return head + ASS_EVENTS_HEAD + lines.join("\n") + "\n";
}
