# 从 youtube-live-translate 迁移到 Finoka

## 1. 迁移原则

- 新仓库从零组织，不把现有后端整体搬过来。
- 现有桌面端是 UI、媒体处理和编辑能力来源。
- FineSub 上游是唯一转写流水线来源。
- 现有 `vod/finesub` 旧快照只用于差异核对，不进入新项目生产代码。
- 每个阶段都形成可运行、可测试的小闭环，不进行一次性大搬家。

源仓库：`/Users/chika/Documents/Develop/youtube-live-translate`

## 2. 现有代码分类

### 2.1 优先迁移

桌面壳和本地媒体能力：

- `desktop/internal/app/media_engine.go`
- `desktop/internal/app/media_server.go`
- `desktop/internal/app/ffmpeg_manager.go`
- `desktop/internal/app/library_management.go`
- `desktop/internal/app/cache_lru.go`
- `desktop/internal/app/spectrogram.go`
- `desktop/internal/app/export.go`
- `desktop/internal/app/transcode.go`

前端编辑器：

- `desktop/frontend/src/editor/**`
- JASSUB、字体和图标资源
- 编辑器 store、时间轴、快捷键、SRT/ASS/视频导出逻辑

前端媒体库可迁移后重构：

- `desktop/frontend/src/home/**`
- `desktop/frontend/src/bridge/desktop.ts`

### 2.2 必须重写或抽象

- `desktop/frontend/src/home/store/pipelineStore.ts`
  - 当前是抽音频、R2 上传、调用 `/edit/video/start`。
  - 改为选择 `ExecutionProvider`；本地直接提交受信任源路径，云端才上传。
- `desktop/frontend/src/home/lib/apiClient.ts`
  - 当前全局绑定单一后端和任务 Key。
  - 改为 Local/Cloud 两套 client，实现同一 Provider 接口。
- `desktop/frontend/src/home/store/sessionStore.ts`
  - 删除全局登录闸门。
  - 云端 Key 只影响 Cloud Provider；本地缺依赖或缺 LLM Key显示资源/设置引导。
- `desktop/frontend/src/home/store/libraryStore.ts`
  - 云端任务记录和本地媒体库不再混成同一种真相来源。
  - 本地文档为主，Provider snapshot 只表示处理状态。
- `desktop/frontend/src/home/store/glossaryStore.ts`
  - 现有结构化云端知识库与 FineSub Markdown/git 知识库语义不同。
  - 首版替换为 FineSub knowledge mode 和知识库位置/状态；高级管理后续设计。
- `desktop/internal/app/desktop_service.go`
  - 删除硬编码 backend。
  - 增加 sidecar 生命周期、provider 配置和 capability 获取。

### 2.3 不迁移

- `vod/finesub/**`：旧 FineSub 快照。
- `vod/core/asr_pipeline.py`：由当前 FineSub pipeline 取代。
- `vod/gpu/transcribe.py`、`separate.py`：由 FineSub 本地 worker/云端镜像取代。
- Modal Dict/Volume/R2 特有的数据层。
- 现有 key 额度与跨点播域锁实现。
- 直播产品 `live/**`，除非未来另立需求。

### 2.4 可参考但不直接迁移

- `vod/api/edit.py`：现有 `/edit/*` 文档契约和 rev 校验。
- `vod/core/subtitles.py`：服务端导出规则；桌面端已有本地实现时以桌面实现为主。
- `vod/core/diarize.py`：未来自动说话人分轨的纯逻辑参考。
- `vod/core/knowledge*.py`：理解当前产品行为，不与 FineSub 知识库混用。

## 3. API 迁移映射

| 现有接口 | Finoka 首版 |
| --- | --- |
| `/edit/upload/init` | 删除；仅 Cloud Provider 内部保留上传初始化 |
| `/edit/upload/abort` | 删除；Cloud Provider 提供 cancel upload |
| `/edit/video/start` | `ExecutionProvider.start()` |
| `/edit/video/stop` | `ExecutionProvider.cancel()` |
| `/edit/video/delete` | 删除本地文档；可另选是否删除任务 artifact |
| `/edit/video/rename` | 本地 Document Store 重命名 |
| `/edit/state` | 本地媒体/文档状态 + Provider task snapshot，不再是登录验证 |
| `GET/PUT /edit/{id}` | 保留为本地 sidecar 文档接口或改成 Wails IPC |
| `GET/PUT /edit/{id}/peaks` | 保留本地实现 |
| `/edit/ass-template` | 保留本地设置 |
| `/edit/{id}/stages` | 替换为 `ArtifactManifest` |
| `/edit/{id}/export.*` | 桌面端继续本地导出，不依赖服务端 |
| `/edit/knowledge-*` | 首版替换为 FineSub 配置/knowledge mode；不强行兼容旧 schema |

## 4. 分阶段实施

### 阶段 0：仓库基线

工作：

- 确定目录结构、许可证和版本规则。
- 落地本文档集。
- 建立 CI 空骨架。

验收：

- 架构决策可追踪。
- 没有从源仓库误复制 Secret、缓存或构建产物。

### 阶段 1：FineSub 同步器和引擎包

工作：

- 实现 `sync-finesub` 脚本。
- 生成 `third_party/finesub/UPSTREAM.json`。
- 构建本地 engine bundle。
- 建立 import、license、package-data、lock/manifest 测试。

验收：

- 从空缓存可按固定 commit 构建。
- 重跑同步字节稳定。
- vendor 目录无人工改动。
- 本地和云端构建读取同一 bundle id。

### 阶段 2：本地 Provider 最小任务

工作：

- Wails 启动/停止 Python sidecar。
- Local Provider capabilities。
- TaskRequest 映射到 FineSub `run_pipeline`。
- worker 生命周期、进度、取消、失败和继续。
- 本地 LLM Key 和资源状态接口。

验收：

- 一个短视频可产出 raw SRT。
- 关闭应用时任务变为 interrupted，再启动可继续。
- sidecar 只监听 loopback，并验证会话令牌。
- 缺依赖、缺模型、缺 LLM Key 都返回稳定错误码。

### 阶段 3：Artifact Projector 与文档存储

工作：

- stable-only 投影。
- stable + annotated + final SRT 投影。
- words、合并源段、low confidence 映射。
- document/original/history/peaks/artifact manifest 落盘。
- rev 乐观锁和原子写。

验收：

- raw 与 final 两类 fixture 都能生成编辑器文档。
- annotated 与 final SRT 行数不一致时明确失败。
- 保存历史可恢复。
- 人工轨道不会被后台重新投影覆盖。

### 阶段 4：迁移 Wails/React 桌面端

工作：

- 迁移媒体库、编辑器、JASSUB 和本地导出。
- 删除登录闸门和 R2 上传流程。
- 增加本地运行时/模型/LLM Key 设置页。
- 首页改用 Local Provider。
- 本地任务完成后自动打开/刷新编辑文档。

验收：

- 完整离线媒体库与编辑功能可用。
- 除 LLM/API 和资源下载外，不访问业务云端。
- 本地任务不复制原视频到 localhost 上传目录。
- SRT、ASS、内嵌字幕视频导出通过现有 parity 测试。

### 阶段 5：Cloud Provider

工作：

- 云端 Key、额度和并发。
- 桌面端提取音频并通过 Presigned URL 上传；云端不接收原视频或视频帧。
- Cloud Provider 声明 `video_multimodal=false`，并拒绝视频多模态请求。
- 调度、GPU worker、持久 workspace、进度和取消。
- 同版本 FineSub 容器。
- artifact 下载和本地 Projector。

验收：

- 同一短媒体在本地与云端生成兼容 ArtifactManifest。
- 云端对象存储和任务请求中不出现原视频、截图或关键帧。
- 云端 UI 不提供视频多模态或网页检索选项，任务始终记录
  `effective_media="text"`、`retrieval="none"` 和 `web_search=false`。
- worker 被终止后可在新容器续跑。
- 云端 Secret 不返回客户端。
- 本地 LLM Key 永不上传。
- 云端结果下载后可由同一编辑器编辑和导出。

### 阶段 6：双模式产品化

工作：

- 任务前选择本地或云端。
- capability 差异和降级提示。
- provider 级错误恢复。
- 版本不匹配提示和升级入口。
- telemetry/diagnostics 的隐私策略。

验收：

- 切换 provider 不改变编辑器文档协议。
- 没有云端 Key 时本地模式完整可用。
- 本地缺硬件时可转到云端，参数差异明确展示。
- 一个 provider 故障不会阻塞另一个 provider 的历史文档。

## 5. 首批建议 PR

### PR 1：仓库和同步基础

- 文档、许可证、目录骨架。
- `sync-finesub` 和 `UPSTREAM.json`。
- engine import/package 测试。

### PR 2：Headless 本地任务

- 不接 UI。
- 命令行启动 sidecar 或测试 harness。
- 提交任务、读事件、取消、继续、列 artifact。

### PR 3：Projector

- 固定 FineSub fixture。
- 生成 `EditDocument`。
- 文档存储、rev 和历史。

完成前三个 PR 后再迁移大规模前端，能先把最容易漂移的引擎边界固定下来。

## 6. 测试策略

### 每次提交

- Go 单元测试。
- TypeScript typecheck 和 reducer/store 测试。
- Python adapter/projector 测试。
- 不加载模型的 FineSub contract tests。

### FineSub 升级

- Artifact fixture diff。
- 一个短日语媒体 GPU 端到端。
- 中断/继续测试。
- 本地/云端 provider parity。

### 发布前

- Windows 全新机器首次安装。
- 无 NVIDIA、显存不足、磁盘不足、模型下载中断。
- LLM Key 无效、限流、内容过滤和网络中断。
- 云端上传中断、worker 抢占、结果下载过期。
- 编辑器长视频、10 万字幕段边界和导出 parity。

## 7. 主要风险与缓解

| 风险 | 缓解 |
| --- | --- |
| FineSub 内部 schema 改变 | Projector 防腐层 + 固定 artifact fixture |
| 本地/云端引擎漂移 | 单一 bundle id + commit/manifest 记录 |
| 只同步部分源码漏依赖 | 白名单同步完整 package/bootstrap/lock |
| 上游 patch 长期冲突 | 外部适配优先，patch 必须带删除条件 |
| 本地 sidecar 被网页调用 | loopback、随机端口、会话令牌、路径白名单 |
| 知识库双端冲突 | 首版隔离，后续显式同步 |
| macOS 无可分发运行时 | 首版明确 Windows/NVIDIA，单独立项验证 |
| 云端只上传音频导致质量差异 | 任务前显式选择并记录 effective capability |

## 8. 完成定义

迁移不以“文件都复制过来”为完成，而以以下结果为准：

- 生产转写只调用同步的 FineSub 引擎。
- 本地和云端没有第二套 ASR/LLM 流水线。
- 前端不解析 FineSub artifact。
- 本地模式无需业务云端和云端 Key。
- 云端模式无需用户提供自己的 LLM Key。
- 两种模式生成同一版本的 `EditDocument`。
- FineSub 升级由一个同步 PR 完成，并有清晰的 artifact/质量差异报告。
