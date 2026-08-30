import type { Dispatch, SetStateAction } from "react";
import type { DialogState } from "../app/types.ts";
import "./MediaDialog.css";

interface MediaDialogProps {
  dialog: DialogState;
  busy: boolean;
  setDialog: Dispatch<SetStateAction<DialogState | null>>;
  onSubmit: () => Promise<void>;
}

export function MediaDialog({ dialog, busy, setDialog, onSubmit }: MediaDialogProps) {
  const isCloudRemove = dialog.kind === "cloud-remove";
  const isSubtitleRemove = dialog.kind === "delete-subtitles";
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDialog(null); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">{dialog.kind === "rename" ? "重命名媒体" : isCloudRemove ? "删除云端字幕" : isSubtitleRemove ? "删除本地字幕" : "从媒体库移除视频"}</h2>
        {dialog.kind === "rename" ? (
          <label className="dialog-field">媒体标题<input autoFocus value={dialog.value} onChange={(event) => setDialog({ ...dialog, value: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") void onSubmit(); }} /></label>
        ) : isCloudRemove ? (
          <p>将永久删除“{dialog.entry.title}”的云端字幕。本机视频和本机字幕不会受到影响。</p>
        ) : isSubtitleRemove ? (
          <p>将删除“{dialog.entry.title}”的本机字幕文档。视频仍保留在媒体库，之后可以重新转写或从云端取回字幕。</p>
        ) : (
          <p>将“{dialog.entry.title}”从本机媒体库移除，卡片将不再显示。原视频文件不会被删除。</p>
        )}
        <div className="dialog-actions">
          <button disabled={busy} onClick={() => setDialog(null)}>取消</button>
          <button className={dialog.kind !== "rename" ? "danger-button" : "primary-button"} disabled={busy || (dialog.kind === "rename" && !dialog.value.trim())} onClick={() => void onSubmit()}>{busy ? "处理中…" : dialog.kind === "rename" ? "保存名称" : isCloudRemove || isSubtitleRemove ? "确认删除" : "确认移除"}</button>
        </div>
      </section>
    </div>
  );
}
