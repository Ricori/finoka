import type { Snapshot as SidecarSnapshot } from "../../bindings/github.com/Ricori/finoka/desktop/internal/sidecar/models.js";
import type { RuntimeProvisionState } from "../bridge/runtime.ts";
import { Mark } from "../components/Mark.tsx";
import type { Capabilities } from "../providers/types.ts";
import "./RuntimePage.css";

interface RuntimePageProps {
  capabilities: Capabilities | null;
  message: string;
  provision: RuntimeProvisionState | null;
  ready: boolean;
  sidecar: SidecarSnapshot | null;
  onInstall: (target: "media" | "runtime" | "models" | "all") => Promise<void>;
}

const installPhases = [
  { id: "downloading", label: "下载" },
  { id: "verifying", label: "校验" },
  { id: "extracting", label: "解压" },
  { id: "activating", label: "安装" },
] as const;

const stageOrder: Record<string, number> = {
  preparing: 0,
  resource: 0,
  downloading: 0,
  verifying: 1,
  extracting: 2,
  activating: 3,
  runtime: 3,
  model: 3,
};

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** index;
  return `${amount >= 100 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function ProvisionProgress({ job }: { job: RuntimeProvisionState["job"] }) {
  const progress = job.progress;
  const percentage = progress?.total ? Math.min(100, Math.max(0, progress.completed / progress.total * 100)) : 0;
  const activePhase = stageOrder[job.stage] ?? 0;
  return (
    <section className="provision-progress-card" role="status" aria-live="polite">
      <div className="provision-progress-heading">
        <div className="download-pulse" aria-hidden="true"><span>↓</span></div>
        <div>
          <small>{job.resource ? `正在处理 ${job.resource.toUpperCase()}` : "正在准备运行环境"}</small>
          <strong>{job.message || "正在准备下载"}</strong>
        </div>
        <b>{progress?.total ? `${Math.round(percentage)}%` : "处理中"}</b>
      </div>
      <div className={`provision-progress-track ${progress?.total ? "" : "indeterminate"}`}>
        <span style={progress?.total ? { width: `${percentage}%` } : undefined} />
      </div>
      <div className="provision-progress-meta">
        <span>{progress?.total ? `${formatBytes(progress.completed)} / ${formatBytes(progress.total)}` : "正在建立安全下载连接"}</span>
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

export function RuntimePage({ capabilities, message, provision, ready, sidecar, onInstall }: RuntimePageProps) {
  const issues = capabilities?.runtime?.issues ?? [];
  const stages = capabilities?.runtime?.stages ?? [];
  const job = provision?.job;
  const mediaInstalling = job?.state === "running" && job.target === "media";
  const mediaState = mediaInstalling ? "downloading" : provision?.media_ready ? "ready" : "missing";
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
            <button disabled={!provision?.supported || provision.job.state === "running"} onClick={() => void onInstall("runtime")}>安装/修复运行时</button>
            <button disabled={!provision?.supported || provision.runtime.state !== "ready" || provision.job.state === "running"} onClick={() => void onInstall("models")}>下载缺少模型</button>
            <button disabled={!provision?.supported || provision.job.state === "running"} onClick={() => void onInstall("all")}>全部准备</button>
          </div>
        </div>
        <section className={`required-dependency-card ${mediaState}`}>
          <div className="required-dependency-main">
            <div className="required-dependency-icon" aria-hidden="true">FF</div>
            <div className="required-dependency-copy">
              <span>必备依赖 · REQUIRED</span>
              <h3>FFmpeg</h3>
              <p>用于视频探测、缩略图、波形、音频提取和视频导出；缺失时无法导入视频。</p>
            </div>
            <div className="required-dependency-action">
              <small>{mediaState === "ready" ? "✓ 已就绪" : mediaState === "downloading" ? "↓ 下载中" : "! 尚未安装"}</small>
              <button className="primary-button" disabled={!provision?.media_supported || job?.state === "running"} onClick={() => void onInstall("media")}>
                {mediaState === "ready" ? "检查并修复" : mediaState === "downloading" ? "正在安装…" : "立即下载"}
              </button>
            </div>
          </div>
          {mediaInstalling && job && <ProvisionProgress job={job} />}
        </section>
        {!provision?.supported && <p className="success-copy">当前 {provision?.platform ?? "平台"} 支持上方媒体必备工具；本地 GPU 流水线仍仅面向 Windows x64/NVIDIA，也可继续使用云端容器。</p>}
        {job?.state === "running" && !mediaInstalling && <ProvisionProgress job={job} />}
        {job?.state !== "running" && job?.message && <p className={`provision-message ${job.state}`}>{job.message}</p>}
        <div className="asset-grid">
          {[provision?.runtime, ...(provision?.resources ?? []), ...(provision?.models ?? [])].filter((item) => item !== undefined && item.id !== "ffmpeg" && item.id !== "ffprobe").map((item) => (
            <div key={`${item.id}:${item.version ?? ""}`}><span className={item.state === "ready" ? "asset-ready" : "asset-missing"}>{item.state === "ready" ? "✓" : "↓"}</span><div><strong>{item.id}</strong><small>{item.version ? `${item.version} · ` : ""}{item.state}</small></div></div>
          ))}
        </div>
        {provision?.root && <small className="runtime-root">安装目录：{provision.root}</small>}
      </article>
    </section>
  );
}
