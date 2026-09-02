import type { RelocationProgress, StorageDestination, StorageLocation, StorageStatus, StorageTarget } from "../bridge/storage.ts";
import "./StorageLocationsCard.css";
import { Notice } from "./Notice.tsx";
import {
  RelocationConfirm,
  RelocationProgressView,
  formatStorageBytes,
  storageTargetTitles,
  useDestinationChoice,
} from "./StorageRelocation.tsx";

interface StorageLocationsCardProps {
  status: StorageStatus | null;
  progress: RelocationProgress | null;
  message: string;
  busy: boolean;
  onChoose: (target: StorageTarget) => Promise<StorageDestination | null>;
  onRelocate: (target: StorageTarget, destination: string) => Promise<void>;
  onReset: (target: StorageTarget) => Promise<void>;
  onCancel: () => Promise<void>;
  onDismissMessage: () => void;
}

const targetDetails: Record<StorageTarget, string> = {
  runtime: "Python 运行时、人声分离与转写模型、下载缓存。本地转写占用的绝大部分空间都在这里。",
  video: "任务执行时复制的视频工作副本，按缓存上限自动回收。",
};

export function StorageLocationsCard(props: StorageLocationsCardProps) {
  const { status, progress, message, busy, onChoose, onRelocate, onReset, onCancel, onDismissMessage } = props;
  const { pending, choosing, choose, clear } = useDestinationChoice(onChoose);
  const active = progress?.active === true;

  const confirm = () => {
    if (!pending) return;
    const { target, directory } = pending;
    clear();
    void onRelocate(target as StorageTarget, directory);
  };

  const pendingEmpty = (status?.locations ?? []).some((location) => location.target === pending?.target && location.empty);

  return (
    <article className="panel storage-locations-card">
      <div className="storage-heading">
        <div>
          <span className="eyebrow">Storage locations</span>
          <h2>磁盘占用与位置</h2>
          <p>
            默认情况下运行环境与视频缓存都放在系统盘的 Nonoka X 数据目录里。可以把它们整体搬到别的盘，Nonoka Sub X 会记住新位置。
          </p>
        </div>
      </div>

      <div className="storage-rows">
        {(status?.locations ?? []).map((location: StorageLocation) => {
          const target = location.target as StorageTarget;
          const title = storageTargetTitles[target];
          if (!title) return null;
          const movingThis = active && progress?.target === location.target;
          return (
            <section className="storage-row" key={location.target}>
              <div className="storage-row-heading">
                <div>
                  <strong>{title}</strong>
                  <p>{targetDetails[target]}</p>
                </div>
                <b>{location.missing ? "—" : formatStorageBytes(location.bytes)}</b>
              </div>
              <div className="storage-path" title={location.directory}>
                <span>当前位置</span>
                <code>{location.directory}</code>
              </div>
              <div className="storage-row-stats">
                {location.custom ? <span className="storage-badge">已迁移</span> : <span className="storage-badge muted">默认位置</span>}
                <span>
                  {location.volume} 剩余 <b>{formatStorageBytes(location.freeBytes)}</b>
                </span>
                {!location.missing && location.files > 0 && <span>{location.files} 个文件</span>}
                {location.empty && !location.missing && <span>尚未安装</span>}
                {location.missing && <span className="storage-warn">目录当前不可访问，请重新连接该磁盘或改回默认位置</span>}
              </div>
              <div className="storage-row-actions">
                <button disabled={busy || active || choosing !== ""} onClick={() => void choose(target)} type="button">
                  {choosing === target ? "正在选择…" : "更改位置…"}
                </button>
                {location.custom && (
                  <button className="ghost" disabled={busy || active} onClick={() => void onReset(target)} type="button">
                    移回默认位置
                  </button>
                )}
                {movingThis && <span className="storage-inline-progress">正在迁移…</span>}
              </div>
            </section>
          );
        })}
      </div>

      {pending && <RelocationConfirm pending={pending} busy={busy} empty={pendingEmpty} onConfirm={confirm} onDismiss={clear} />}
      <RelocationProgressView progress={progress} onCancel={() => void onCancel()} />

      <Notice className="storage-message" message={message} onDismiss={onDismissMessage} />
    </article>
  );
}
