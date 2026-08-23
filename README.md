# Finoka

Finoka 是一个规划中的本地优先字幕生产桌面应用：复用现有 [Nonoka Subtitle](https://github.com/Ricori/nonoka-subtitle-desktop) 的
Wails/React 媒体库与字幕编辑体验，把转写流水线统一交给
[FineSub](https://github.com/caca2331/finesub) 维护，并允许用户选择本地或云端执行。

当前仓库处于架构和迁移准备阶段，尚未同步 FineSub 源码，也没有可运行产品。

## 已确定的方向

- 不 fork FineSub；按明确 commit 同步完整引擎快照。
- `third_party/finesub` 是生成目录，禁止手工修改。
- 本地与云端使用同一份 FineSub 引擎包、产物转换器和任务协议。
- 本地模式由用户自行下载运行时、模型和依赖，并配置自己的 LLM Key。
- 云端模式上传媒体后由 GPU worker 执行，使用 Finoka 云端任务 Key。
- 无论在哪执行，编辑器都只消费 Finoka 自己的 `EditDocument`，不直接依赖
  FineSub 内部 JSON/CSV 结构。
- 字幕编辑和媒体库保持本地优先；云端处理与未来的云端文档同步是两个独立能力。

## 文档入口

- [总体架构](docs/architecture.md)
- [FineSub 同步与升级策略](docs/finesub-sync.md)
- [统一执行与产物协议](docs/execution-contract.md)
- [迁移步骤与验收标准](docs/migration-plan.md)
- [ADR-0001：不 fork、同步引擎快照](docs/adr/0001-engine-integration.md)
- [第三方引擎目录约定](third_party/finesub/README.md)

## 当前参考基线

- 现有前端与桌面能力：`/Users/chika/Documents/Develop/youtube-live-translate/desktop` 或者 https://github.com/Ricori/youtube-live-translate
- 现有云端编辑契约：`/Users/chika/Documents/Develop/youtube-live-translate/vod/api/edit.py` 或者 https://github.com/Ricori/youtube-live-translate
- FineSub 上游：`https://github.com/caca2331/finesub`
- 本次调研时的 FineSub 基线：`0.4.1`，commit
  `2a320ede3f5c29e431a4525aab01d97945f349c2`

该 commit 只是第一轮开发的候选基线。真正同步时必须由同步脚本重新校验，并写入
`third_party/finesub/UPSTREAM.json`，不能仅凭本文档认定已经同步。

## 建议的第一个开发里程碑

先完成纯本地最小闭环：

1. 同步并构建 FineSub 引擎包。
2. 本地 sidecar 启动一个 FineSub 任务并上报结构化进度。
3. 将 `stable.json`、`*-annotated.csv`、最终 SRT 转换为 `EditDocument`。
4. 现有编辑器加载、修改、保存并导出该文档。
5. 全流程不访问现有后端。

达到这个里程碑后，再实现云端 `ExecutionProvider`，避免同时调试本地运行时、云端调度
和前端迁移三个变量。
