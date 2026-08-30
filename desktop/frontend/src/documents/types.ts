export interface EditSegment {
  t0: number;
  t1: number;
  ja: string;
  zh: string;
  words?: unknown[];
  low_conf?: boolean;
}

export interface LaneMeta {
  hidden: boolean;
  style: string | null;
}

export interface EditTrack {
  id: string;
  name: string;
  ja: LaneMeta;
  zh: LaneMeta;
  hja: number;
  hzh: number;
  segs: EditSegment[];
}

export interface EditDocument {
  schema: 1;
  video_id: string;
  title: string;
  source: string;
  fp: string | null;
  rev: number;
  subtitles: EditSegment[];
  tracks: EditTrack[];
  track_meta: { name: string; ja: LaneMeta; zh: LaneMeta };
  projection: { schema: 1; mode: "stable" | "final" };
  created_at?: string;
  updated_at?: string;
}
