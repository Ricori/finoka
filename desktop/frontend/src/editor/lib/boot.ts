import { DEFAULT_ASS_TEMPLATE, ROW_H0, ROW_MAX, ROW_MIN } from "../constants";
import { parseAssTemplate } from "../ass";
import { documents } from "../../bridge/documents.ts";
import { mediaLibrary } from "../../bridge/library.ts";
import { backHome, getVid, setLoadedDocument } from "../session";
import { bumpDoc, docStore } from "../store/docStore";
import { setLoadedState, saveStore } from "../store/saveStore";
import { select, selStore } from "../store/selectionStore";
import { askStore, ctxStore, modalStore, toast, toastStore } from "../store/uiStore";
import { videoStore } from "../store/videoStore";
import { ensureBlkWin, relayout, setDuration, syncZoomRange, viewStore } from "../store/viewStore";
import { playStore } from "../store/playStore";
import { clampN, errText } from "../utils";
import { initSubtitles, preloadSubtitles } from "./subtitles";
import { setupVideo, showVideoFallback } from "./videoSource";
import { resetAutoGain } from "./wave";
import { resetHistory } from "./history";
import { exportStore } from "../store/exportStore";
import { dragStore } from "../store/dragStore";
import type { Clip, Seg, Track } from "../types";

function mapSegs(items: unknown[]): Seg[] {
  const out = (items ?? []).map((item) => {
    const value = item as Partial<Seg>;
    const segment: Seg = {
      t0: Number(value.t0) || 0,
      t1: Number(value.t1) || 0,
      ja: value.ja || "",
      zh: value.zh || "",
    };
    if (Array.isArray(value.words) && value.words.length) segment.words = value.words;
    if (value.low_conf) segment.low_conf = true;
    return segment;
  }).sort((left, right) => left.t0 - right.t0);
  for (let index = 0; index < out.length - 1; index++) {
    if (out[index].t1 > out[index + 1].t0) out[index].t1 = out[index + 1].t0;
  }
  return out;
}

function resetTransientState() {
  resetHistory();
  modalStore.set({ bootDone: false, closeOpen: false, tplOpen: false, trkPop: null, clipTip: null });
  ctxStore.set({ menu: null });
  askStore.set({ dialog: null });
  toastStore.set({ msg: "", show: false, sticky: false, ok: false, onClick: null });
  exportStore.set({ open: false, clip: null, busy: false, pct: 0 });
  dragStore.set({ marquee: null, dropTi: null });
  saveStore.set({ dirty: false, saving: false, conflicted: false, stateText: "正在加载", stateCls: "" });
  selStore.set({ curTrack: -1, sel: -1, selSet: new Set(), preview: null });
  playStore.set({ t: 0, playing: false, rate: 1 });
  videoStore.set({
    src: "", fallbackOpen: false, collapsed: false, retrieving: false, retrievePct: "",
    transcoding: false, transcodePct: "", canTranscode: false, fbMsg: "", warn: "",
    usePath: null, badge: null, subBusy: null,
  });
  viewStore.set({ duration: 60, t0: 0, t1: 60, curClip: null, clips: [], blkWin: null });
}

export async function runBootSequence() {
  resetTransientState();
  const videoID = getVid();
  try {
    setupVideo().catch((error) => showVideoFallback(false, "视频加载失败：" + errText(error)));
    preloadSubtitles().catch(() => undefined);
    const [data, peaks] = await Promise.all([
      documents.read(videoID),
      documents.peaks(videoID),
    ]);
    setLoadedDocument(data);

    const segs = mapSegs(data.subtitles);
    const tracks: Track[] = (data.tracks ?? []).map((track, index) => ({
      id: track.id || `t${Date.now().toString(36)}${index}`,
      name: track.name || `轨道 ${index + 1}`,
      ja: { hidden: !!track.ja?.hidden, style: track.ja?.style || null },
      zh: { hidden: !!track.zh?.hidden, style: track.zh?.style || null },
      hja: clampN(Number(track.hja), ROW_MIN, ROW_MAX, ROW_H0),
      hzh: clampN(Number(track.hzh), ROW_MIN, ROW_MAX, ROW_H0),
      segs: mapSegs(track.segs),
    }));
    const sourceMeta = data.track_meta ?? {
      name: "默认轨",
      ja: { hidden: false, style: "JP" },
      zh: { hidden: false, style: "CN" },
    };
    const trackMeta = {
      name: sourceMeta.name || "默认轨",
      ja: { hidden: !!sourceMeta.ja?.hidden, style: sourceMeta.ja?.style || "JP" },
      zh: { hidden: !!sourceMeta.zh?.hidden, style: sourceMeta.zh?.style || "CN" },
    };

    const assTemplate = data.ass_template?.trim() || DEFAULT_ASS_TEMPLATE;
    docStore.set({
      rev: data.rev || 0,
      title: data.title || videoID,
      videoFp: data.fp || null,
      segs,
      tracks,
      trackMeta,
      assTemplate,
      isAdmin: false,
      knowledgeBase: "",
      canLearnKnowledge: false,
      knowledgeLearning: { status: "idle" },
      peaks,
    });
    parseAssTemplate(assTemplate);
    resetAutoGain();
    setDuration(peaks?.duration || (segs.length ? segs[segs.length - 1].t1 + 2 : 60));

    const clips: Clip[] = ((await mediaLibrary.getClips(videoID).catch(() => [])) ?? [])
      .sort((left, right) => left.t0 - right.t0);
    viewStore.set({ clips });

    modalStore.set({ bootDone: true });
    bumpDoc();
    initSubtitles((text) => videoStore.set({ subBusy: text }))
      .catch((error) => toast("字幕预览渲染器加载失败：" + errText(error)));
    relayout();
    syncZoomRange();
    ensureBlkWin(true);
    if (segs.length) select(0);
    setLoadedState();
  } catch (error) {
    toast("打开字幕失败：" + errText(error), true);
    backHome();
  }
}
