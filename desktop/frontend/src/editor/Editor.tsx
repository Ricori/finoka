import { useEffect, useMemo, useRef, useState } from "react";
import JASSUB from "jassub";
import workerUrl from "jassub/dist/worker/worker.js?worker&url";
import wasmUrl from "jassub/dist/wasm/jassub-worker-modern.wasm?url";
import defaultFontUrl from "jassub/dist/default.woff2?url";
import type { MediaEntry } from "../bridge/library.ts";
import { mediaLibrary } from "../bridge/library.ts";
import { documents } from "../bridge/documents.ts";
import type { Peaks } from "../bridge/documents.ts";
import type { EditDocument, EditSegment } from "../documents/types.ts";
import { buildAss, buildSrt } from "./export.ts";


interface EditorProps {
  media: MediaEntry;
  onClose(): void;
  onSaved(): void;
}

function baseName(title: string): string {
  return title.replace(/\.[a-z0-9]{2,5}$/i, "") || "subtitle";
}

export function Editor({ media, onClose, onSaved }: EditorProps) {
  const [document, setDocument] = useState<EditDocument | null>(null);
  const [videoURL, setVideoURL] = useState("");
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [message, setMessage] = useState("正在加载编辑文档…");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const jassubRef = useRef<JASSUB | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([documents.read(media.id), mediaLibrary.mediaURL(media.id), documents.peaks(media.id)]).then(([next, url, waveform]) => {
      if (!active) return;
      setDocument(next);
      setVideoURL(url);
      setPeaks(waveform);
      setMessage("");
    }).catch((value) => setMessage(value instanceof Error ? value.message : String(value)));
    return () => { active = false; };
  }, [media.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoURL || !document) return;
    const renderer = new JASSUB({
      video,
      subContent: buildAss(document),
      workerUrl,
      wasmUrl,
      modernWasmUrl: wasmUrl,
      fonts: [defaultFontUrl],
      defaultFont: "Liberation Sans",
      queryFonts: false,
    });
    jassubRef.current = renderer;
    void renderer.ready.catch(() => setMessage("JASSUB 预览初始化失败；编辑和导出仍可使用。"));
    return () => {
      jassubRef.current = null;
      void renderer.destroy();
    };
  }, [videoURL]);

  const ass = useMemo(() => document ? buildAss(document) : "", [document]);
  useEffect(() => {
    const renderer = jassubRef.current;
    if (!renderer || !ass) return;
    void renderer.ready.then(() => renderer.renderer.setTrack(ass));
  }, [ass]);

  const updateSegment = (index: number, update: Partial<EditSegment>) => {
    setDocument((current) => current ? { ...current, subtitles: current.subtitles.map((segment, position) => position === index ? { ...segment, ...update } : segment) } : current);
    setDirty(true);
  };

  const seek = (seconds: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, seconds);
    void videoRef.current.play().catch(() => undefined);
  };

  const addSegment = () => {
    const start = Math.max(0, videoRef.current?.currentTime ?? 0);
    const end = Math.min(media.duration || start + 3, start + 3);
    const segment: EditSegment = { t0: start, t1: Math.max(start + 0.1, end), ja: "", zh: "" };
    setDocument((current) => current ? {
      ...current,
      subtitles: [...current.subtitles, segment].sort((left, right) => left.t0 - right.t0),
    } : current);
    setDirty(true);
  };

  const splitSegment = (index: number) => {
    setDocument((current) => {
      if (!current) return current;
      const segment = current.subtitles[index];
      const playhead = videoRef.current?.currentTime ?? 0;
      const splitAt = playhead > segment.t0 + 0.05 && playhead < segment.t1 - 0.05
        ? playhead
        : segment.t0 + (segment.t1 - segment.t0) / 2;
      if (splitAt <= segment.t0 + 0.05 || splitAt >= segment.t1 - 0.05) return current;
      const first = { ...segment, t1: splitAt };
      const second = { ...segment, t0: splitAt };
      return { ...current, subtitles: current.subtitles.flatMap((item, position) => position === index ? [first, second] : [item]) };
    });
    setDirty(true);
  };

  const removeSegment = (index: number) => {
    setDocument((current) => current ? { ...current, subtitles: current.subtitles.filter((_, position) => position !== index) } : current);
    setDirty(true);
  };

  const save = async () => {
    if (!document) return;
    setBusy(true);
    try {
      const saved = await documents.save(media.id, document);
      setDocument(saved);
      setDirty(false);
      setMessage("已保存");
      onSaved();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  };

  const saveSubtitle = async (kind: "ja" | "zh" | "both" | "ass") => {
    if (!document) return;
    setBusy(true);
    try {
      const name = `${baseName(document.title)}${kind === "ja" ? " - 日文.srt" : kind === "zh" ? " - 中文.srt" : kind === "both" ? ".srt" : ".ass"}`;
      const content = kind === "ass" ? ass : buildSrt(document, kind);
      const path = await mediaLibrary.saveSubtitle(name, content);
      if (path) setMessage(`已导出 ${path}`);
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  };

  const exportVideo = async () => {
    setBusy(true);
    try {
      const path = await mediaLibrary.exportVideo(media.id, ass);
      if (path) setMessage(`已导出 ${path}`);
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  };

  if (!document) {
    return <section className="panel editor-loading"><h2>字幕编辑器</h2><p>{message}</p><button onClick={onClose}>返回媒体库</button></section>;
  }

  return (
    <section className="editor-shell panel">
      <header className="editor-toolbar">
        <div><span className="eyebrow">EditDocument rev {document.rev}</span><h2>{document.title}</h2></div>
        <div className="editor-actions">
          <button onClick={addSegment} disabled={busy}>在播放头新建</button>
          <button onClick={() => void saveSubtitle("ja")} disabled={busy}>日文 SRT</button>
          <button onClick={() => void saveSubtitle("zh")} disabled={busy}>中文 SRT</button>
          <button onClick={() => void saveSubtitle("both")} disabled={busy}>双语 SRT</button>
          <button onClick={() => void saveSubtitle("ass")} disabled={busy}>ASS</button>
          <button onClick={() => void exportVideo()} disabled={busy}>内嵌视频</button>
          <button className="primary-button" onClick={() => void save()} disabled={busy || !dirty}>{busy ? "处理中…" : dirty ? "保存" : "已保存"}</button>
          <button onClick={onClose}>返回</button>
        </div>
      </header>
      {message && <p className="editor-message">{message}</p>}
      <div className="editor-preview">
        <div className="video-stage"><video ref={videoRef} src={videoURL} controls preload="metadata" /></div>
        <div className="waveform" aria-label="音频波形">
          {(peaks?.peaks ?? []).filter((_, index, values) => index % Math.max(1, Math.ceil(values.length / 240)) === 0).map((peak, index) => <i key={index} style={{ height: `${Math.max(3, peak * 100)}%` }} />)}
          {!peaks && <span>波形将在本地生成后显示</span>}
        </div>
      </div>
      <div className="subtitle-table" role="table">
        <div className="subtitle-row subtitle-header" role="row"><span>#</span><span>开始</span><span>结束</span><span>日文</span><span>中文</span><span>操作</span></div>
        {document.subtitles.map((segment, index) => (
          <div className={`subtitle-row ${segment.low_conf ? "low-confidence" : ""}`} role="row" key={`${index}:${segment.t0}`}>
            <button className="segment-index" title="从这里播放" onClick={() => seek(segment.t0)}>{index + 1}</button>
            <input aria-label={`第 ${index + 1} 条开始时间`} type="number" min="0" step="0.01" value={segment.t0} onChange={(event) => updateSegment(index, { t0: Number(event.target.value) })} />
            <input aria-label={`第 ${index + 1} 条结束时间`} type="number" min="0" step="0.01" value={segment.t1} onChange={(event) => updateSegment(index, { t1: Number(event.target.value) })} />
            <textarea aria-label={`第 ${index + 1} 条日文`} value={segment.ja} onChange={(event) => updateSegment(index, { ja: event.target.value })} />
            <textarea aria-label={`第 ${index + 1} 条中文`} value={segment.zh} onChange={(event) => updateSegment(index, { zh: event.target.value })} />
            <div className="segment-actions"><button onClick={() => splitSegment(index)}>分割</button><button className="danger" onClick={() => removeSegment(index)}>删除</button></div>
          </div>
        ))}
      </div>
    </section>
  );
}
