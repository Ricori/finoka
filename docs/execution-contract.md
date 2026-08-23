# 统一执行与产物协议

## 1. 原则

Finoka 前端不直接调用 FineSub 内部 Python API。前端只依赖由 Finoka 版本化的执行协议，
本地和云端各提供一个实现。

该协议只描述：

- 能做什么。
- 如何提交、观察、取消和继续任务。
- 任务实际使用了什么版本与能力。
- 哪里可以取得产物。

字幕编辑文档另有独立存储协议。

## 2. Provider 接口草案

```ts
interface ExecutionProvider {
  capabilities(): Promise<Capabilities>;
  start(request: TaskRequest): Promise<TaskSnapshot>;
  status(taskId: string): Promise<TaskSnapshot>;
  events(taskId: string, afterCursor: number): Promise<TaskEventPage>;
  cancel(taskId: string): Promise<TaskSnapshot>;
  retry(taskId: string): Promise<TaskSnapshot>;
  resume(taskId: string): Promise<TaskSnapshot>;
  artifacts(taskId: string): Promise<ArtifactManifest>;
}
```

桌面端通过 provider id 选择实现：

```text
local -> localhost sidecar
cloud -> Finoka HTTPS API
```

## 3. Capabilities

```json
{
  "provider": "local",
  "adapter_schema": 1,
  "artifact_schema": 1,
  "engine": {
    "name": "finesub",
    "version": "0.4.1",
    "commit": "2a320ede3f5c29e431a4525aab01d97945f349c2"
  },
  "features": {
    "raw_srt": true,
    "translation": true,
    "video_multimodal": true,
    "knowledge": true,
    "resume": true,
    "diarization": false
  },
  "devices": [
    {"id": "cuda:0", "name": "NVIDIA GPU", "memory_mb": 12288}
  ]
}
```

前端必须按 `features` 控制选项，不允许按 provider 类型写死。

Cloud Provider 首版必须返回 `video_multimodal=false`。桌面端据此隐藏视频多模态选项，
但服务端仍必须独立校验请求，不能只依赖前端约束。

## 4. TaskRequest

Finoka 自己定义稳定请求；Adapter 再映射为当前 FineSub 参数。

```json
{
  "schema": 1,
  "provider": "local",
  "source": {
    "kind": "local_file",
    "path": "/absolute/path/video.mp4",
    "title": "video",
    "fingerprint": "..."
  },
  "target": "final-srt",
  "language": "ja",
  "device": "cuda:0",
  "gpu_budget_gb": 8,
  "correction": {
    "enabled": true,
    "media": "video",
    "retrieval": "local",
    "difficulty": "quality",
    "fast": "auto",
    "extra_info": "",
    "extra_style": ""
  },
  "knowledge": "update",
  "cleanup_intermediate": false
}
```

云端请求的 `source` 改为音频上传对象 id，不传客户端绝对路径。云端首版只接受音频，
`correction.media` 必须为 `"audio"`；收到 `"video"` 时返回稳定的
`unsupported_capability` 错误，不做静默降级。任务 snapshot 必须记录
`effective_media="audio"` 和 `video_multimodal=false`。

## 5. TaskSnapshot

```json
{
  "schema": 1,
  "task_id": "...",
  "provider": "local",
  "state": "running",
  "stage": "aligned",
  "progress": {
    "completed": 42,
    "total": 100,
    "unit": "segments",
    "message": "正在识别"
  },
  "engine": {
    "version": "0.4.1",
    "commit": "2a320ede3f5c29e431a4525aab01d97945f349c2"
  },
  "requested_capabilities": {},
  "effective_capabilities": {},
  "error": null,
  "created_at": "...",
  "updated_at": "..."
}
```

状态枚举首版固定为：

```text
queued | running | completed | failed | cancelled | interrupted
```

不要引入 `working`、`done` 等同义状态。

## 6. TaskEvent

```json
{
  "cursor": 17,
  "task_id": "...",
  "type": "progress",
  "timestamp": "...",
  "payload": {
    "stage": "aligned",
    "completed": 42,
    "total": 100,
    "unit": "segments",
    "message": "正在识别"
  }
}
```

事件类型：

```text
started | stage | progress | warning | log | completed | failed | cancelled
```

本地可以轮询或由 Wails 转发事件；云端首版可轮询，后续增加 SSE。cursor 必须单调递增，
客户端重连可以从游标继续。

## 7. ArtifactManifest

```json
{
  "schema": 1,
  "task_id": "...",
  "engine_commit": "...",
  "artifacts": {
    "stable_json": {
      "uri": "file:///.../video-stable.json",
      "sha256": "...",
      "bytes": 123
    },
    "annotated_csv": {
      "uri": "file:///.../video-annotated.csv",
      "sha256": "...",
      "bytes": 123
    },
    "final_srt": {
      "uri": "file:///.../video.srt",
      "sha256": "...",
      "bytes": 123
    }
  }
}
```

网络协议中的 `uri` 不应直接暴露云端文件系统路径；云端返回受限下载 URL 或 artifact id。
本地实现内部可以使用路径，但 renderer 只通过可信 sidecar/Wails 打开。

## 8. EditDocument 投影

现有编辑器核心句结构保持：

```ts
interface Seg {
  t0: number;
  t1: number;
  ja: string;
  zh: string;
  words?: unknown[];
  low_conf?: boolean;
}
```

转换规则：

| EditDocument 字段 | FineSub 来源 |
| --- | --- |
| `t0/t1` | 最终 SRT 对应行时间；无 LLM 时使用 stable 段时间 |
| `ja` | annotated `corrected_text`；无 LLM 时使用 stable `text` |
| `zh` | annotated/final translation；raw 模式为空 |
| `words` | annotated `source_ids` 映射并合并 stable words |
| `low_conf` | annotated `conf == low` 或明确的上游低置信证据 |

合并源段时：

- `ja/zh` 使用 annotated 行。
- words 按源段顺序拼接。
- 起止时间优先使用与该 annotated 行 1:1 对应的最终 SRT。
- 若 annotated 与最终 SRT 行数不一致，Projector 必须失败并保留原 artifact，禁止靠 zip
  截断或猜测对齐。

FineSub 没有自动说话人轨时，初始产物全部进入默认轨。用户在编辑器创建的自定义轨属于
Finoka 文档，后续重新投影不得覆盖人工轨道。

## 9. 文档存储

建议每个本地视频目录至少包含：

```text
documents/<video-id>/
  document.json
  original.json
  history/<revision>.json
  peaks.json
  artifacts.json
```

- `document.json`：当前可编辑文档。
- `original.json`：首次 Projector 结果，供比较和知识学习。
- `history`：保存前快照，保留上限另行配置。
- `peaks.json`：本地波形。
- `artifacts.json`：FineSub artifact manifest 和 hash，不复制大文件本体也可。

保存继续使用 `rev` 乐观锁，即便当前只有单机，也可防止双窗口互相覆盖。

## 10. 本地 sidecar 安全

- 只绑定 IPv4/IPv6 loopback，不绑定 `0.0.0.0`。
- 使用操作系统分配的随机端口。
- Wails 启动时通过管道读取端口和随机 256-bit 会话令牌。
- 每个请求验证令牌和允许的 Host/Origin。
- sidecar 退出后令牌立即失效。
- 所有文件路径由 Wails 媒体库或 sidecar task workspace 解析，不能让任意网页提交路径后读取。
- LLM Key 只写本地 FineSub secret/config 存储，不放进 renderer localStorage 和日志。

## 11. 错误模型

```json
{
  "error": {
    "code": "ENGINE_DEPENDENCY_MISSING",
    "message": "尚未安装本地转写运行时",
    "retryable": true,
    "action": "open_resources",
    "details": {}
  }
}
```

稳定错误码由 Finoka 定义；FineSub 原始异常放在受限 diagnostics 中，不能让前端依赖异常文本。
