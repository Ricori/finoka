import { useEffect, useMemo, useState } from "react";
import type { MediaEntry } from "../bridge/library.ts";
import { cloudTaskRequest, localTaskRequest } from "../home/defaultRequest.ts";
import type { Capabilities, TaskRequest } from "../providers/types.ts";
import type { ExecutionMode } from "../app/types.ts";
import { CustomSelect } from "./CustomSelect.tsx";
import "./TranscriptionDialog.css";

interface TranscriptionDialogProps {
  entry: MediaEntry;
  initialMode: ExecutionMode;
  localReady: boolean;
  localCapabilities: Capabilities | null;
  cloudCapabilities: Capabilities | null;
  localIssue?: string;
  cloudAuthenticated: boolean;
  cloudRemaining?: number;
  busy: boolean;
  error: string;
  onClose: () => void;
  onOpenRuntime: () => void;
  onOpenAccount: () => void;
  onStart: (mode: ExecutionMode, request: TaskRequest) => Promise<void>;
}

const languageOptions = [
  ["ja", "日语"],
  ["zh", "中文"],
  ["en", "英语"],
  ["auto", "自动检测"],
] as const;

function requestFor(mode: ExecutionMode, entry: MediaEntry, capabilities: Capabilities | null): TaskRequest {
  const request = mode === "local" ? localTaskRequest(entry) : cloudTaskRequest(entry);
  if (mode === "local" && capabilities?.devices[0]?.id) request.device = capabilities.devices[0].id;
  return request;
}

export function TranscriptionDialog(props: TranscriptionDialogProps) {
  const {
    entry, initialMode, localReady, localCapabilities, cloudCapabilities, localIssue, cloudAuthenticated,
    cloudRemaining, busy, error, onClose, onOpenRuntime, onOpenAccount, onStart,
  } = props;
  const preferredMode = initialMode === "local"
    ? localReady ? "local" : cloudAuthenticated ? "cloud" : "local"
    : cloudAuthenticated ? "cloud" : localReady ? "local" : "cloud";
  const [step, setStep] = useState<"mode" | "settings">("mode");
  const [mode, setMode] = useState<ExecutionMode>(preferredMode);
  const [request, setRequest] = useState<TaskRequest>(() => requestFor(preferredMode, entry, localCapabilities));
  const selectedReady = mode === "local" ? localReady : cloudAuthenticated;
  const selectedCapabilities = mode === "local" ? localCapabilities : cloudCapabilities;
  const supportsVideo = selectedCapabilities?.features.video_multimodal === true;
  const supportsKnowledge = selectedCapabilities?.features.knowledge === true;
  const finalOutput = request.target === "final-srt";
  const devices = localCapabilities?.devices ?? [];

  const summary = useMemo(() => {
    const output = finalOutput ? "AI 纠错与翻译后的最终字幕" : "识别与断句后的原始字幕";
    const source = request.language === "auto" ? "自动检测语言" : languageOptions.find(([id]) => id === request.language)?.[1] ?? request.language;
    return `${source} · ${output}`;
  }, [finalOutput, request.language]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      if (step === "settings") setStep("mode");
      else onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, step]);

  const chooseMode = (nextMode: ExecutionMode) => {
    const ready = nextMode === "local" ? localReady : cloudAuthenticated;
    if (!ready) return;
    setMode(nextMode);
    setRequest(requestFor(nextMode, entry, localCapabilities));
    setStep("settings");
  };

  const setTarget = (target: TaskRequest["target"]) => {
    setRequest((current) => ({
      ...current,
      target,
      correction: { ...current.correction, enabled: target === "final-srt" },
      knowledge: target === "raw-srt" || mode === "cloud"
        ? "none"
        : current.knowledge === "none" ? "collect" : current.knowledge,
    }));
  };

  return (
    <div className="modal-backdrop transcription-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="transcription-dialog" role="dialog" aria-modal="true" aria-labelledby="transcription-title">
        <header className="transcription-head">
          <div>
            <span className="eyebrow">{step === "mode" ? "第 1 步，共 2 步" : "第 2 步，共 2 步"}</span>
            <h2 id="transcription-title">{step === "mode" ? "选择运行位置" : "转写设置"}</h2>
            <p title={entry.sourcePath}>{entry.title}</p>
          </div>
          <button className="transcription-close" aria-label="关闭" disabled={busy} onClick={onClose}>×</button>
        </header>

        {step === "mode" ? (
          <div className="execution-picker">
            <button className={`execution-card ${preferredMode === "local" ? "preferred" : ""}`} disabled={!localReady} onClick={() => chooseMode("local")}>
              <span className="execution-icon local">⌁</span>
              <span><strong>本地运行</strong><small>原视频不离开电脑，使用本机转写引擎 与 GPU</small></span>
              <em>{localReady ? "可用" : "未就绪"}</em>
            </button>
            {!localReady && <p className="execution-unavailable">{localIssue || "本地运行环境尚未就绪"}<button onClick={onOpenRuntime}>检查运行环境</button></p>}

            <button className={`execution-card ${preferredMode === "cloud" ? "preferred" : ""}`} disabled={!cloudAuthenticated} onClick={() => chooseMode("cloud")}>
              <span className="execution-icon cloud">☁</span>
              <span><strong>云端运行</strong><small>提取音轨后交给 Nonoka Cloud 处理</small></span>
              <em>{cloudAuthenticated ? cloudRemaining === undefined ? "已登录" : `剩余 ${cloudRemaining} 次` : "未登录"}</em>
            </button>
            {!cloudAuthenticated && <p className="execution-unavailable">需要先登录云端账户<button onClick={onOpenAccount}>前往登录</button></p>}
          </div>
        ) : (
          <div className="transcription-settings">
            <section className="transcription-section">
              <div className="transcription-section-title"><strong>输出内容</strong><span>{mode === "local" ? "本地运行" : "云端运行"}</span></div>
              <div className="option-cards two-columns">
                <button className={request.target === "raw-srt" ? "selected" : ""} onClick={() => setTarget("raw-srt")}><strong>原始字幕</strong><small>完成识别与断句，不调用 LLM</small></button>
                <button className={request.target === "final-srt" ? "selected" : ""} onClick={() => setTarget("final-srt")}><strong>最终字幕</strong><small>继续进行纠错、翻译与知识处理</small></button>
              </div>
            </section>

            <section className="transcription-section form-grid">
              <label>原始语言<CustomSelect value={request.language} options={languageOptions.map(([value, label]) => ({ value, label }))} onChange={(language) => setRequest((current) => ({ ...current, language }))} /></label>
              {mode === "local" && <label>计算设备<CustomSelect value={request.device} options={devices.length > 0 ? devices.map((device) => ({ value: device.id, label: `${device.name} · ${Math.round(device.memory_mb / 1024)} GB` })) : [{ value: "cuda", label: "自动选择 NVIDIA GPU" }]} onChange={(device) => setRequest((current) => ({ ...current, device }))} /></label>}
              {mode === "local" && <label>显存预算<CustomSelect value={request.gpu_budget_gb} options={([4, 8, 12, 16] as const).map((value) => ({ value, label: `${value} GB` }))} onChange={(gpu_budget_gb) => setRequest((current) => ({ ...current, gpu_budget_gb }))} /></label>}
            </section>

            {finalOutput && <>
              <section className="transcription-section form-grid">
                <label>纠错参考<CustomSelect value={request.correction.media} options={[{ value: "text", label: "仅识别文本" }, ...(mode === "local" ? [{ value: "audio" as const, label: "音频" }] : []), ...(supportsVideo ? [{ value: "video" as const, label: "视频多模态" }] : [])]} onChange={(media) => setRequest((current) => ({ ...current, correction: { ...current.correction, media } }))} /></label>
                <label>处理质量<CustomSelect value={request.correction.difficulty} options={[{ value: "efficiency", label: "效率优先" }, { value: "intermediate", label: "均衡" }, { value: "quality", label: "质量优先" }]} onChange={(difficulty) => setRequest((current) => ({ ...current, correction: { ...current.correction, difficulty } }))} /></label>
                <label>快速模式<CustomSelect value={request.correction.fast} options={[{ value: "auto", label: "自动" }, { value: "on", label: "开启" }, { value: "off", label: "关闭" }]} onChange={(fast) => setRequest((current) => ({ ...current, correction: { ...current.correction, fast } }))} /></label>
                {mode === "local" && <label>资料检索<CustomSelect value={request.correction.retrieval} options={[{ value: "none", label: "不检索" }, { value: "local", label: "本地检索" }, { value: "native", label: "模型原生检索" }]} onChange={(retrieval) => setRequest((current) => ({ ...current, correction: { ...current.correction, retrieval } }))} /></label>}
                {supportsKnowledge && <label>知识库<CustomSelect value={request.knowledge} options={[{ value: "none", label: "不使用" }, { value: "collect", label: "读取并收集" }, { value: "update", label: "更新知识库", disabled: mode === "cloud" }]} onChange={(knowledge) => setRequest((current) => ({ ...current, knowledge }))} /></label>}
              </section>

              <section className="transcription-section prompt-grid">
                <label>背景信息<textarea rows={3} maxLength={4000} placeholder="人物、节目、专有名词或上下文（可选）" value={request.correction.extra_info} onChange={(event) => setRequest((current) => ({ ...current, correction: { ...current.correction, extra_info: event.target.value } }))} /></label>
                <label>翻译风格<textarea rows={3} maxLength={4000} placeholder="例如：简洁自然，保留角色名英文（可选）" value={request.correction.extra_style} onChange={(event) => setRequest((current) => ({ ...current, correction: { ...current.correction, extra_style: event.target.value } }))} /></label>
              </section>
            </>}

            {mode === "local" && <label className="cleanup-check"><input type="checkbox" checked={request.cleanup_intermediate} onChange={(event) => setRequest((current) => ({ ...current, cleanup_intermediate: event.target.checked }))} /><span><strong>任务完成后清理中间文件</strong></span></label>}
            <div className="transcription-summary"><span>将要执行</span><strong>{summary}</strong></div>
            {error && <p className="transcription-error" role="alert">{error}</p>}
          </div>
        )}

        <footer className="transcription-actions">
          {step === "settings" ? <button disabled={busy} onClick={() => setStep("mode")}>上一步</button> : <button disabled={busy} onClick={onClose}>取消</button>}
          {step === "settings" && <button className="primary-button" disabled={busy || !selectedReady} onClick={() => void onStart(mode, request)}>{busy ? "正在启动…" : "开始转写"}</button>}
        </footer>
      </section>
    </div>
  );
}
