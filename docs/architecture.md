# Finoka 总体架构

## 1. 目标

Finoka 的核心目标是把“字幕产品”和“转写算法”解耦：

- FineSub 持续维护人声分离、VAD、ASR、稳定化、LLM 纠错翻译和知识库流水线。
- Finoka 维护桌面媒体库、任务入口、双执行模式、字幕文档、专业编辑器和导出。
- 本地与云端只在执行位置、鉴权和存储方式上不同，不分叉转写算法。

## 2. 首版范围

首版包含：

- Windows x64/NVIDIA 的本地 FineSub 执行。
- 用户自行配置 FineSub 支持的 LLM/检索 Key。
- 现有 Wails/React 视频库与字幕编辑器。
- 云端 FineSub GPU worker 的纯音频任务提交、进度、取消和结果下载。
- SRT、ASS、内嵌字幕视频的本地导出。

首版不包含：

- 云端多人协作编辑。
- 本地与云端知识库自动双向合并。
- FineSub 上游尚未提供的自动说话人分离。
- macOS 上完整的 FineSub GPU 运行时。现有 Wails 壳可以继续支持 macOS，但
  FineSub patched CTranslate2、Torch 和分离模型的 macOS 分发需要单独验证。

## 3. 总体结构

```text
┌─────────────────────────────────────────────────────────────┐
│ Wails + React                                               │
│ 媒体库 / 任务设置 / 进度 / 编辑器 / 本地导出               │
└──────────────────────┬──────────────────────────────────────┘
                       │ Finoka Execution Contract
                ┌──────┴──────┐
                │             │
┌───────────────▼──────┐  ┌───▼──────────────────────────────┐
│ Local Provider       │  │ Cloud Provider                  │
│ localhost sidecar    │  │ HTTPS API + 云端任务 Key        │
│ 直接读取本地文件     │  │ 仅上传音频 / GPU 调度           │
└───────────────┬──────┘  └───┬──────────────────────────────┘
                │             │
                └──────┬──────┘
                       ▼
             同版本 FineSub Engine Bundle
                       │
             stable / annotated / final SRT
                       │
                       ▼
              Artifact Projector
                       │
                       ▼
                 EditDocument
                       │
                       ▼
              本地 Document Store
```

## 4. 组件边界

### 4.1 FineSub Engine Bundle

引擎包由固定上游 commit 生成，包括完整 `finesub`、`finesub_bootstrap`、依赖锁和资源
manifest。它只提供流水线能力，不知道 Finoka 的页面、账户、媒体库或编辑器。

FineSub 负责：

- 人声分离。
- VAD、Whisper fw-refine、对齐和稳定化。
- 原文 SRT。
- LLM 纠错、翻译和后处理。
- FineSub 知识库。
- 阶段产物与断点续跑。

### 4.2 Local Provider

本地 Provider 是由 Wails 启动和监管的 Python sidecar：

- 只监听 `127.0.0.1` 的随机端口。
- 启动时生成随机会话令牌，前端每个请求必须携带。
- 读取本地源视频路径，不做 R2 上传或无意义的 localhost 媒体复制。
- 启动隔离 worker；应用退出时把任务标成 interrupted，并允许继续。
- 管理本地 FineSub 运行时、模型、缓存和用户 LLM Key。
- 将 FineSub 事件投影为 Finoka 的统一任务事件。

### 4.3 Cloud Provider

云端 Provider 与本地 Provider 实现同一协议，但增加：

- Finoka 云端任务 Key 鉴权、额度和并发限制。
- Presigned URL 上传客户端提取的音频；不上传原视频或视频帧。
- GPU 队列和每任务隔离容器。
- 持久工作目录和对象存储。
- 结构化进度持久化。
- 取消、抢占恢复和结果保留策略。

云端 worker 不应复用桌面窗口生命周期相关的 JobManager。它直接调用同版本 FineSub
pipeline，并绑定云端 Reporter；任务状态由云端调度层维护。

### 4.4 Artifact Projector

Projector 是最重要的防腐层。它负责把 FineSub 产物转换成稳定的 Finoka 文档：

```text
stable.json       -> 原始日文、词级时间、源段编号
*-annotated.csv   -> 纠错日文、中文、置信度、源段映射
final.srt         -> 最终后处理时间轴和中文
                    ↓
EditDocument      -> t0/t1/ja/zh/words/low_conf/tracks
```

前端禁止直接读取 FineSub 的内部 artifact。上游 schema 变化只能影响 Projector 和它的
契约测试，不应扩散到编辑器。

### 4.5 Document Store

字幕编辑文档默认始终保存在本地，即使任务由云端执行：

- 云端完成后下载 artifact。
- 本地 Projector 生成 `EditDocument`。
- 编辑、版本、轨道、ASS 模板和导出均在本机完成。

未来若增加协作，应新增独立 `DocumentSyncProvider`。不要把“在哪转写”和“字幕保存在哪”
再次绑定为一个后端。

## 5. 本地与云端的差异

| 维度 | 本地 | 云端 |
| --- | --- | --- |
| 媒体输入 | 本地路径 | 客户端提取音频后 Presigned URL 上传 |
| 视频多模态纠错 | 按本地能力启用 | 不支持，固定为纯音频纠错 |
| 业务鉴权 | 无；仅 localhost 会话令牌 | 云端任务 Key |
| LLM Key | 用户本机配置，禁止上传 | 云端 Secret |
| FineSub 版本 | 本地 engine bundle | 同版本容器镜像 |
| 中间产物 | 本地任务目录 | 持久卷/对象存储 |
| 进度 | sidecar 事件 | SSE/长轮询/轮询 |
| 最终编辑文档 | 本地 | 下载后本地生成 |
| 知识库 | 本地 Markdown/git | 云端按用户隔离 |

## 6. 版本与兼容

每个任务必须记录：

- `engine_version`
- `engine_commit`
- `runtime_manifest_sha256`
- `adapter_schema`
- `artifact_schema`
- 实际任务参数和执行能力降级

本地 sidecar 和云端 API 都提供 `capabilities()`。前端按能力显示选项，不按版本字符串猜测。
建议服务端至少兼容当前和前一个 `adapter_schema`。

## 7. 媒体上传策略

本地直接把原视频交给 FineSub，并可按本机能力使用视频多模态纠错。

云端首版只提供纯音频流水线：

- 桌面端在本机从媒体中提取音频，再通过 Presigned URL 上传。
- 不上传原视频、截图、关键帧或其他视觉内容。
- Cloud Provider 的 `capabilities()` 固定返回 `video_multimodal=false`。
- 云端任务固定使用 `correction.media="audio"`；服务端收到视频多模态请求时直接拒绝，
  不做静默降级。
- UI 在云端模式下不显示视频多模态选项，并明确提示纠错只使用音频和文本上下文。

本地和云端仍使用同版本 FineSub 引擎与相同 artifact schema；这项能力差异必须记录在
任务的 `requested_capabilities` 和 `effective_capabilities` 中。

## 8. 知识库策略

首版采用两个独立域：

- 本地任务使用本地 FineSub 知识库。
- 云端任务使用云端用户隔离知识库。
- 不自动互相覆盖。
- 后续通过显式导出/导入或带版本的同步协议交换。

这样可以避免同名条目、git 分支、离线修改和云端并发写入之间出现不可解释冲突。

## 9. 许可证

- 现有 Nonoka Desktop 为 GPL-3.0。
- FineSub Python 代码为 MIT。
- `src/finesub/llm/prompt_templates` 单独为 CC BY-SA 4.0。

Finoka 整体采用 GPL-3.0 是自然组合；同步时必须保留 FineSub MIT LICENSE，并对 prompt
模板保留单独许可证、署名和修改说明。本节仅记录工程处理原则，不替代正式法律意见。
