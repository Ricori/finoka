import type { Snapshot as SidecarSnapshot } from "../../bindings/github.com/Ricori/finoka/desktop/internal/sidecar/models.js";
import { useState } from "react";
import type { PythonBootstrapState, RuntimeInstallTarget, RuntimeItem, RuntimeProvisionState } from "../bridge/runtime.ts";
import { Mark } from "../components/Mark.tsx";
import type { Capabilities } from "../providers/types.ts";
import "./RuntimePage.css";
import { Notice } from "../components/Notice.tsx";

interface RuntimePageProps {
  capabilities: Capabilities | null;
  message: string;
  /** Failure of the last install/cancel/remove action, shown next to the
      controls that triggered it. */
  provisionMessage: string;
  onDismissProvisionMessage: () => void;
  provision: RuntimeProvisionState | null;
  pythonBootstrap: PythonBootstrapState | null;
  ready: boolean;
  sidecar: SidecarSnapshot | null;
  onInstall: (target: RuntimeInstallTarget) => Promise<void>;
  onInstallPython: () => Promise<void>;
  onCancelInstall: () => Promise<void>;
  onRemoveAll: () => Promise<void>;
}

const installPhases = [
  { id: "downloading", label: "下载" },
  { id: "verifying", label: "校验" },
  { id: "extracting", label: "解压" },
  { id: "activating", label: "安装" },
] as const;

const assetStateLabels: Record<RuntimeItem["state"], string> = {
  missing: "尚未安装",
  downloading: "下载中",
  outdated: "版本过旧",
  ready: "已就绪",
  failed: "安装失败",
};

const optionalToolIds = new Set(["git", "yt-dlp", "tokcount"]);

const stageOrder: Record<string, number> = {
  preparing: 0,
  resource: 0,
  downloading: 0,
  verifying: 1,
  extracting: 2,
  activating: 3,
  runtime: 3,
  model: 3,
  installing_python: 3,
  installing_dependencies: 3,
  completed: 4,
};

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** index;
  return `${amount >= 100 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

interface ProgressJob {
  resource: string;
  stage: string;
  message: string;
  progress: { completed: number; total: number; unit: string; bytes_per_second?: number } | null;
}

function ProvisionProgress({ job, onCancel, cancellable = true }: { job: ProgressJob; onCancel: () => Promise<void>; cancellable?: boolean }) {
  const progress = job.progress;
  const percentage = progress?.total ? Math.min(100, Math.max(0, progress.completed / progress.total * 100)) : 0;
  const activePhase = stageOrder[job.stage] ?? 0;
  const progressDescription = progress?.total
    ? `${formatBytes(progress.completed)} / ${formatBytes(progress.total)}`
    : job.stage === "installing_dependencies" || job.stage === "activating" || job.stage === "runtime"
      ? "正在安装已下载的依赖"
      : job.stage === "verifying" || job.stage === "extracting"
        ? job.message
        : "正在准备下载";
  return (
    <section className="provision-progress-card" role="status" aria-live="polite">
      <div className="provision-progress-heading">
        <div className="download-pulse" aria-hidden="true"><span>↓</span></div>
        <div>
          <small>{job.resource ? `正在处理 ${job.resource.toUpperCase()}` : "正在准备运行环境"}</small>
          <strong>{job.message || "正在准备下载"}</strong>
        </div>
        <b>{progress?.total ? `${Math.round(percentage)}%` : "处理中"}</b>
        {cancellable && <button className="cancel-button" onClick={() => void onCancel()} type="button">取消</button>}
      </div>
      <div className={`provision-progress-track ${progress?.total ? "" : "indeterminate"}`}>
        <span style={progress?.total ? { width: `${percentage}%` } : undefined} />
      </div>
      <div className="provision-progress-meta">
        <span>{progressDescription}</span>
        <span>{progress?.bytes_per_second ? `${formatBytes(progress.bytes_per_second)}/s` : "校验后自动安装"}</span>
      </div>
      <div className="provision-phase-list">
        {installPhases.map((phase, index) => (
          <span className={index < activePhase ? "complete" : index === activePhase ? "active" : ""} key={phase.id}>
            <i>{index < activePhase ? "✓" : index + 1}</i>{phase.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function AssetTile({ item, optional = false, busy = false, installing = false, onInstall }: {
  item: RuntimeItem;
  optional?: boolean;
  busy?: boolean;
  installing?: boolean;
  onInstall?: () => Promise<void>;
}) {
  const ready = item.state === "ready";
  const stateLabel = optional && !ready
    ? item.state === "downloading" ? "下载中" : item.state === "outdated" ? "可按需更新" : "按需安装"
    : ready && item.source === "system" ? "系统已安装" : assetStateLabels[item.state] ?? item.state;
  return (
    <div className={optional ? "optional-asset-tile" : undefined} title={item.detail}>
      <span className={ready ? "asset-ready" : optional ? "asset-optional" : "asset-missing"}>{ready ? "✓" : optional ? "○" : "↓"}</span>
      <div><strong>{item.id}</strong><small>{item.version ? `${item.version} · ` : ""}{stateLabel}</small></div>
      {optional && !ready && onInstall && (
        <button className="optional-install-button" disabled={busy} title={busy ? "已有安装任务正在进行，请等待其结束。" : undefined} onClick={() => void onInstall()} type="button">
          {installing ? "安装中…" : item.state === "outdated" ? "更新" : "下载"}
        </button>
      )}
    </div>
  );
}

export function RuntimePage({ capabilities, message, provisionMessage, provision, pythonBootstrap, ready, sidecar, onCancelInstall, onDismissProvisionMessage, onInstall, onInstallPython, onRemoveAll }: RuntimePageProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const issues = capabilities?.runtime?.issues ?? [];
  const stages = capabilities?.runtime?.stages ?? [];
  const job = provision?.job;
  const mediaInstalling = job?.state === "running" && job.target === "media";
  const mediaStage = stages.find((stage) => stage.id === "media");
  const ffmpegReady = provision?.media_ready === true || (mediaStage !== undefined && !mediaStage.issues.some((issue) => issue.code === "missing_ffmpeg"));
  const mediaState = mediaInstalling ? "downloading" : ffmpegReady ? "ready" : "missing";
  const pythonInstalling = pythonBootstrap?.state === "running";
  // A sidecar started on an interpreter without FineSub's bootstrap dependencies
  // answers requests but cannot build its provisioner. The card is the way out
  // of that state, so a running sidecar must not hide it.
  const bootstrapBroken = (provision?.bootstrap_error ?? "") !== "";
  const showPythonCard = !sidecar?.running || pythonInstalling || bootstrapBroken || pythonBootstrap?.state === "failed";
  const assets = [provision?.runtime, ...(provision?.resources ?? []), ...(provision?.models ?? [])]
    .filter((item): item is RuntimeItem => item !== undefined && item.id !== "ffmpeg" && item.id !== "ffprobe");
  const optionalTools = assets.filter((item) => optionalToolIds.has(item.id));
  const requiredAssets = assets.filter((item) => !optionalToolIds.has(item.id));
  const readyAssets = requiredAssets.filter((item) => item.state === "ready");
  const pendingAssets = requiredAssets.filter((item) => item.state !== "ready");
  // Every control below is gated on provision state. Without a reason attached
  // the panel greys out silently — on a first launch, or whenever the sidecar
  // cannot build its provisioner, that reads as a dead page.
  const jobRunning = job?.state === "running";
  const provisionBlocked = !provision
    ? pythonInstalling
      ? "正在准备 Python 启动环境，完成后即可安装运行时与模型。"
      : "本地执行服务尚未连接，无法读取运行时状态。等待服务启动，或点击右上角「重新检查」。"
    : provision.bootstrap_error
      ? `FineSub bootstrap 不可用，暂时无法安装运行时或模型：${provision.bootstrap_error}。可用下方「Python 3.12」卡片安装隔离的启动环境后重试。`
      : !provision.supported
        ? `当前 ${provision.platform} ${provision.media_supported ? "支持上方媒体必备工具；" : ""}本地 GPU 流水线仍仅面向 Windows x64/NVIDIA，也可继续使用云端容器。`
        : "";
  const runtimeBlocked = provisionBlocked || (jobRunning ? "已有安装任务正在进行，请等待其结束。" : "");
  const modelsBlocked = runtimeBlocked || (provision && provision.runtime.state !== "ready" ? "需要先完成「仅装运行时」。" : "");
  const mediaUnavailable = !provision
    ? "本地执行服务尚未连接，无法下载 FFmpeg。等待服务启动，或点击右上角「重新检查」。"
    : provision.bootstrap_error
      ? `FineSub bootstrap 不可用：${provision.bootstrap_error}`
      : !provision.media_supported
        ? `托管 FFmpeg 暂不支持 ${provision.platform}，请自行安装并加入 PATH。`
        : "";
  const mediaBlocked = mediaUnavailable || (jobRunning ? "已有安装任务正在进行，请等待其结束。" : "");
  const pythonBlocked = !pythonBootstrap
    ? ""
    : !pythonBootstrap.supported
      ? pythonBootstrap.message || "自动安装 Python 当前仅支持 Windows x64。"
      : pythonInstalling ? "Python 正在安装中。" : "";
  return (
    <section className="runtime-layout">
      <article className="panel runtime-diagnostics">
        <div className="panel-heading">
          <div><span className="eyebrow">Runtime diagnostics</span><h2>环境诊断</h2></div>
          <Mark>{ready ? "环境已就绪" : sidecar?.running ? "需要处理" : "服务未连接"}</Mark>
        </div>
        {issues.length ? (
          <ul className="issues">
            {issues.map((issue) => <li key={`${issue.code}:${issue.message}`}><strong>{issue.code}</strong><span>{issue.message}</span></li>)}
          </ul>
        ) : <p className="success-copy">{ready ? "未发现运行时问题。" : message || "等待 capabilities。"}</p>}
        <div className="diagnostic-section-heading">
          <strong>当前环境下可运行环节</strong>
          <small>{stages.filter((stage) => stage.ready).length} / {stages.length} 可用</small>
        </div>
        <div className="stage-list">
          {stages.map((stage) => (
            <div className={stage.ready ? "stage-ready" : "stage-blocked"} key={stage.id}>
              <span>{stage.ready ? "✓" : "!"}</span>
              <div><strong>{stage.label}</strong><small>{stage.ready ? "可以运行" : stage.issues[0]?.message}</small></div>
            </div>
          ))}
          {!stages.length && <p className="success-copy">连接桌面执行服务后，将分别检测媒体准备、ASR、LLM、知识库和视频多模态环节。</p>}
        </div>
      </article>
      <article className="panel provision-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">Managed assets</span><h2>运行时与模型</h2></div>
          <div className="provision-actions">
            <button className="step-button" disabled={runtimeBlocked !== ""} onClick={() => void onInstall("runtime")} title={runtimeBlocked || "第 1 步：只安装 Python/CUDA 运行环境与 uv、FFmpeg 基础资源，不下载任何模型"}>仅装运行时</button>
            <button className="step-button" disabled={modelsBlocked !== ""} onClick={() => void onInstall("models")} title={modelsBlocked || "第 2 步：只补齐缺失的模型，需要运行时已就绪"}>仅补缺失模型</button>
            <button className="primary-button" disabled={runtimeBlocked !== ""} onClick={() => void onInstall("all")} title={runtimeBlocked || "依次执行上面两步：先装运行时，再下载缺失的模型"}>一键准备全部</button>
          </div>
        </div>
        <p className="provision-hint">「一键准备全部」= 先执行「仅装运行时」，再执行「仅补缺失模型」。已就绪的部分会自动跳过，重复执行只补缺失或损坏的内容。</p>
        <Notice className="provision-message failed" message={provisionMessage} autoDismissMs={0} onDismiss={onDismissProvisionMessage} />
        {provisionBlocked !== "" && (
          <p className={provision?.bootstrap_error ? "provision-blocked failed" : "provision-blocked"} role="status">{provisionBlocked}</p>
        )}
        {showPythonCard && <section className={`required-dependency-card ${pythonBootstrap?.state ?? "missing"}`}>
          <div className="required-dependency-main">
            <div className="required-dependency-icon" aria-hidden="true">PY</div>
            <div className="required-dependency-copy">
              <span>启动依赖 · AUTOMATIC</span>
              <h3>Python 3.12</h3>
              <p>{bootstrapBroken && !pythonInstalling
                ? "当前本地服务运行在版本不符或缺少依赖的系统 Python 上。安装隔离的 Python 3.12 后会自动重启服务。"
                : pythonBootstrap?.message || "Finoka 将自动下载隔离的 Python，不会修改系统 Python。"}</p>
            </div>
            <div className="required-dependency-action">
              <small>{pythonInstalling ? "↓ 正在安装" : pythonBootstrap?.state === "failed" ? "! 安装失败" : pythonBootstrap?.state === "ready" ? "✓ 已安装" : "! 尚未安装"}</small>
              <button className="primary-button" disabled={pythonBlocked !== ""} title={pythonBlocked || undefined} onClick={() => void onInstallPython()}>
                {pythonInstalling ? "正在启用…" : pythonBootstrap?.state === "failed" ? "重试安装" : pythonBootstrap?.state === "ready" ? "重新启用" : "立即安装"}
              </button>
            </div>
          </div>
          {pythonInstalling && pythonBootstrap && <ProvisionProgress job={{
            resource: "Python 3.12",
            stage: pythonBootstrap.stage,
            message: pythonBootstrap.message,
            progress: pythonBootstrap.progress,
          }} onCancel={async () => undefined} cancellable={false} />}
        </section>}
        {mediaState !== "ready" && <section className={`required-dependency-card ${mediaState}`}>
          <div className="required-dependency-main">
            <div className="required-dependency-icon" aria-hidden="true">FF</div>
            <div className="required-dependency-copy">
              <span>必备依赖 · REQUIRED</span>
              <h3>FFmpeg</h3>
              <p>用于视频探测、缩略图、波形、音频提取和视频导出；缺失时无法导入视频。</p>
              {mediaUnavailable !== "" && <p className="required-dependency-blocked">{mediaUnavailable}</p>}
            </div>
            <div className="required-dependency-action">
              <small>{mediaState === "downloading" ? "↓ 下载中" : "! 尚未安装"}</small>
              <button className="primary-button" disabled={mediaBlocked !== ""} title={mediaBlocked || undefined} onClick={() => void onInstall("media")}>
                {mediaState === "downloading" ? "正在安装…" : "立即下载"}
              </button>
            </div>
          </div>
          {mediaInstalling && job && <ProvisionProgress job={job} onCancel={onCancelInstall} />}
        </section>}
        {job?.state === "running" && !mediaInstalling && <ProvisionProgress job={job} onCancel={onCancelInstall} />}
        {job?.state !== "running" && <Notice className={`provision-message ${job?.state ?? ""}`} message={job?.message ?? ""} />}
        {pendingAssets.length > 0 && (
          <section className="asset-group pending">
            <div className="asset-group-heading"><strong>待安装</strong><small>{pendingAssets.length} 项缺失或需要更新</small></div>
            <div className="asset-grid">
              {pendingAssets.map((item) => <AssetTile item={item} key={`${item.id}:${item.version ?? ""}`} />)}
            </div>
          </section>
        )}
        {readyAssets.length > 0 && (
          <section className="asset-group ready">
            <div className="asset-group-heading"><strong>已就绪</strong><small>{readyAssets.length} 项已安装并校验</small></div>
            <div className="asset-grid">
              {readyAssets.map((item) => <AssetTile item={item} key={`${item.id}:${item.version ?? ""}`} />)}
            </div>
          </section>
        )}
        {optionalTools.length > 0 && (
          <section className="asset-group optional">
            <div className="asset-group-heading"><strong>可选工具</strong><small>按需使用，不影响环境就绪状态</small></div>
            <div className="asset-grid">
              {optionalTools.map((item) => <AssetTile
                item={item}
                key={`${item.id}:${item.version ?? ""}`}
                optional
                busy={job?.state === "running"}
                installing={job?.state === "running" && job.target === item.id}
                onInstall={() => onInstall(item.id as RuntimeInstallTarget)}
              />)}
            </div>
          </section>
        )}
        {provision?.root && <div className="runtime-storage-row">
          <small className="runtime-root">安装目录：{provision.root}</small>
          <button
            className={confirmRemove ? "runtime-remove-button confirming" : "runtime-remove-button"}
            disabled={job?.state === "running"}
            onBlur={() => setConfirmRemove(false)}
            onClick={() => {
              if (!confirmRemove) {
                setConfirmRemove(true);
                return;
              }
              setConfirmRemove(false);
              void onRemoveAll();
            }}
            type="button"
          >
            {confirmRemove ? "再次点击确认删除" : "删除所有环境"}
          </button>
        </div>}
      </article>
    </section>
  );
}
