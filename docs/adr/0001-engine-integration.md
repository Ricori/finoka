# ADR-0001：不 fork FineSub，按 commit 同步完整引擎快照

- 状态：Accepted
- 日期：2026-08-22

## 背景

Finoka 希望未来所有本地和云端转写都由 FineSub 流水线执行，同时保留现有桌面媒体库和
专业字幕编辑器。需要一种能持续跟随 FineSub 更新、又不让前端直接依赖其内部结构的集成方式。

考虑过：

1. Fork FineSub 并长期维护产品分支。
2. 只复制 VAD/ASR 等少量核心文件。
3. 直接依赖公开的 FineSub CLI wheel。
4. 按固定 commit 同步完整引擎 package，并在外部建立 Adapter。

## 决策

采用方案 4：

- 不 fork FineSub。
- 自动同步完整 `src/finesub`、`src/finesub_bootstrap` 和必要 runtime metadata。
- vendor 目录禁止人工修改。
- Finoka Adapter 定义稳定任务协议和 Artifact Projector。
- 本地 runtime 与云端镜像消费同一 engine bundle。
- 只有缺少必要扩展点时才维护独立 patch，并优先推动上游合并。

## 理由

- Fork 容易把产品功能和算法改动混在同一分支，升级会持续积累冲突。
- 少量文件不是完整运行边界，会漏掉依赖锁、prompt、模型、资源和 artifact 规则。
- 当前公开 CLI wheel 是托管运行时启动壳，不应被当作稳定的嵌入式 SDK。
- 完整快照有明确来源和 commit，发布可复现，也能进行离线安装。
- 外部 Adapter 把上游变化限制在少量转换和契约测试中。

## 后果

正面：

- FineSub 升级变成显式同步 PR。
- 本地和云端共享完全相同的流水线代码。
- Finoka 可以独立设计任务、账户、编辑文档和 UI。
- 不必等待 FineSub 发布适合嵌入的 SDK wheel。

代价：

- Finoka 必须维护同步脚本和 engine bundle 构建。
- 必须维护 FineSub artifact 到 EditDocument 的兼容测试。
- 上游删除或改变内部入口时，Adapter 仍需升级。
- 许可证清单必须随同步自动维护。

## 约束

- `third_party/finesub` 不接受手工提交的业务改动。
- 构建必须验证 `UPSTREAM.json`、archive hash 和 package 内容。
- 前端不得 import 或解析 FineSub artifact。
- 云端不得安装 floating `main`/`latest`。
- 一个发布版本只能声明一个默认 engine bundle；兼容旧任务时可以保留旧 bundle，但必须按
  task metadata 明确选择。
