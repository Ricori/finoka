# Finoka

Finoka 是一个本地优先字幕生产桌面应用：复用现有 [Nonoka Subtitle](https://github.com/Ricori/nonoka-subtitle-desktop) 的
Wails/React 媒体库与字幕编辑体验，把转写流水线统一交给
[FineSub](https://github.com/caca2331/finesub) 维护，并允许用户选择本地或云端执行。

代码迁移主链路已经闭合：FineSub `v0.4.1` 按固定 commit 同步；本机由受保护的 loopback
sidecar、隔离 worker 和 FineSub 原生管理运行时执行；产物自动投影为带历史版本和波形的
EditDocument。Wails/React 已包含侧边栏、本地/云端 Provider 切换、媒体库操作、Key 设置、
Key 登录与媒体库合并、自动字幕同步，以及 JASSUB 预览和 SRT/ASS/内嵌视频导出。

并固定关闭网页检索；同时保留 Key
次数/并发限制、字幕库、任务事件、取消/继续和产物下载。当前剩余发布门槛是
需要外部基础设施的验收：Windows NVIDIA 真机完整媒体、L4 部署及抢占/取消演练。

## 已确定的方向

- 不 fork FineSub；按明确 commit 同步完整引擎快照。
- `third_party/finesub` 是生成目录，禁止手工修改。
- 本地与云端使用同一份 FineSub 引擎包、产物转换器和任务协议。
- 本地模式由设置页调用 FineSub 原生 bootstrap 安装带哈希校验的运行时与模型，并配置用户自己的 LLM Key。
- 云端模式只上传临时纯音频对象，由 GPU worker 执行；纠错/翻译使用 OpenAI 兼容接口，
  不启用网页搜索增强，并使用 Finoka 云端任务 Key。
- 无论在哪执行，编辑器都只消费 Finoka 自己的 `EditDocument`，不直接依赖
  FineSub 内部 JSON/CSV 结构。
- 字幕编辑和媒体库保持本地优先；云端处理与未来的云端文档同步是两个独立能力。

## 文档入口

- [总体架构](docs/architecture.md)
- [FineSub 同步与升级策略](docs/finesub-sync.md)
- [统一执行与产物协议](docs/execution-contract.md)
- [云端登录、媒体库与字幕同步协议](docs/cloud-sync-contract.md)
- [迁移步骤与验收标准](docs/migration-plan.md)
- [当前迁移状态](docs/migration-status.md)
- [ADR-0001：不 fork、同步引擎快照](docs/adr/0001-engine-integration.md)
- [第三方引擎目录约定](third_party/finesub/README.md)

## 当前参考基线

- 现有前端与桌面能力：`https://github.com/Ricori/youtube-live-translate/desktop`
- 现有云端编辑契约：`https://github.com/Ricori/youtube-live-translate`
- FineSub 上游：`https://github.com/caca2331/finesub`
- 本次调研时的 FineSub 基线：`0.4.1`，commit
  `2a320ede3f5c29e431a4525aab01d97945f349c2`

该 commit 已由同步脚本从 FineSub 官方仓库重新校验，并记录在
`third_party/finesub/UPSTREAM.json`。开发时可以直接修改 vendor；交付时必须生成对应
patch、更新快照哈希，并通过补丁栈正反向重放测试。升级流程见同步与升级策略文档。

## 桌面开发与打包

桌面工程使用 Wails 3 与 Taskfile 统一启动和打包。Wails Go 模块、CLI 与前端 runtime
固定为同一发行版本；Taskfile 通过 Go tool dependency 调用，因此无需另外安装全局 `wails3`。

```bash
cd desktop

# Wails + Vite 热重载（默认端口 9245）
task dev

# 生成 bindings、装配 sidecar 资源并执行完整桌面校验
task verify

# 当前平台生产构建与原生包
task build
task package

# 常用的显式平台任务
task darwin:package:universal
task windows:build ARCH=amd64
task windows:package ARCH=amd64  # 生成单文件 Finoka.exe
```

macOS 产物位于 `desktop/bin/Finoka.app`，Windows 产物是单文件
`desktop/bin/Finoka.exe`。生产二进制会嵌入 `src/finoka`、固定 FineSub
源码、运行时锁和模型清单，首次启动时按内容哈希解压到用户数据目录；应用允许使用 `FINOKA_PYTHON`、
`FINOKA_SIDECAR_SCRIPT`、`FINOKA_VENDOR_DIR` 和 `FINOKA_DATA_DIR` 覆盖诊断路径。
Windows x64 终端用户无需预装 Python：找不到可用解释器时，环境管理页会自动下载经 SHA-256
校验的 `uv`，安装隔离的 Python 3.12 启动环境并启用本地服务。

应用管理的用户数据统一保存在 Windows `%APPDATA%\Finoka` 或 macOS
`~/Library/Application Support/Finoka`。其中 `videos/` 是可清理的视频工作副本，
`cache.json` 保存容量上限（默认 20 GB）；达到上限后按最近使用时间回收，正在编辑的视频受保护。
原始媒体和用户显式选择的导出文件仍保留在用户选择的位置。

开发机需要 Go 1.25、Node.js/npm 与 [Task](https://taskfile.dev/)。macOS 打包使用系统
`codesign` 做 ad-hoc 签名；发行签名/公证使用 `task darwin:sign:notarize`。当前只支持
macOS 与 Windows；Windows 不依赖 NSIS，也不需要附带资源目录或 ZIP。

## 引擎开发命令

```bash
# 离线校验固定 FineSub 快照
python3 scripts/sync_finesub.py check

# 运行不加载模型的同步、Provider、Projector、运行时与文档存储测试
python3 -m pip install -e . pytest
python3 -m pytest -q

# 构建字节稳定的本地/云端共用 engine bundle
python3 -m scripts.build_finesub_bundle

# 开发模式启动 loopback sidecar（首行输出随机端口和会话令牌）
python3 scripts/run_local_sidecar.py

# 验证 Go sidecar 监管与 Provider 桥接
(cd desktop && go test ./...)

# 验证并构建 React 渲染层
(cd desktop/frontend && npm ci && npm run typecheck && npm test && npm run build)

# 直接运行已构建的 Wails 应用也可使用 `(cd desktop && task run)`
```

首次同步或升级需访问 FineSub 官方 GitHub：

```bash
python3 scripts/sync_finesub.py sync --ref v0.4.1
```