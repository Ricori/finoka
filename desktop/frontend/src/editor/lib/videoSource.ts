import { mediaLibrary } from "../../bridge/library.ts";
import { getVid } from "../session";
import { toast } from "../store/uiStore";
import { videoStore } from "../store/videoStore";
import { errText } from "../utils";

export const mountVideo = (url: string) =>
  videoStore.set({ src: url, fallbackOpen: false, badge: null });

export function showRetrieving(pctText = "") {
  videoStore.set({ retrieving: true, retrievePct: pctText, collapsed: false, fallbackOpen: true });
}

export function showVideoFallback(collapsed: boolean, msgText?: string) {
  videoStore.set({
    retrieving: false,
    collapsed,
    fallbackOpen: true,
    warn: "",
    usePath: null,
    ...(msgText != null ? { fbMsg: msgText, canTranscode: false } : {}),
  });
}

export function showPlaybackError(message: string) {
  showVideoFallback(false, message);
}

export async function setupVideo() {
  mountVideo(await mediaLibrary.mediaURL(getVid()));
}

export async function pickVideoFile() {
  try {
    await mediaLibrary.relink(getVid());
    mountVideo(await mediaLibrary.mediaURL(getVid()));
    toast("已重新关联本地视频");
  } catch (error) {
    const message = errText(error);
    if (message) toast("重新关联失败：" + message, true);
  }
}

export async function attachChosen() {
  await pickVideoFile();
}

export async function transcodeToH264() {
  toast("当前版本尚未提供编辑器内转码，请先在外部转换为 H.264。", true);
}

export function cancelTranscode() {
  videoStore.set({ transcoding: false, transcodePct: "" });
}
