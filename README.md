<div align="center">
  <h1>Finoka</h1>
  <p><b>本地优先的 AI 视频字幕生成与专业编辑桌面工作站</b></p>
  <a href="https://github.com/Ricori/finoka/releases/latest"><img src="https://img.shields.io/github/v/release/Ricori/finoka?label=Release&color=4c1&sort=semver" alt="Release"></a>
  <a href="https://github.com/Ricori/finoka/releases/latest"><img src="https://img.shields.io/badge/Download-Windows%20%7C%20macOS-2ea44f?logo=github&logoColor=white" alt="Download"></a>
  <br>
  <a href="https://wails.io/"><img src="https://img.shields.io/badge/Wails-v3-blue.svg" alt="Wails"></a>
  <a href="https://golang.org/"><img src="https://img.shields.io/badge/Go-1.25+-00ADD8.svg" alt="Go"></a>
  <a href="https://reactjs.org/"><img src="https://img.shields.io/badge/React-19-61DAFB.svg" alt="React"></a>
  <a href="https://github.com/caca2331/finesub"><img src="https://img.shields.io/badge/Engine-FineSub-orange.svg" alt="FineSub"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-blue.svg" alt="License"></a>
</div>

<br>

Finoka 是专为外语视频翻译与高质量字幕制作打造的桌面应用。项目深度整合了专业字幕编辑体验与现代转写算法流水线，兼具 Aegisub 的精准可控与剪映的直观便捷，支持**本地离线**与**云端**双模式无缝切换。

---

## ⬇️ 下载安装

前往 **[Releases 最新发布页](https://github.com/Ricori/finoka/releases/latest)** 获取对应平台的安装包：

| 平台 | 文件名 | 说明 |
| :--- | :--- | :--- |
| **Windows** | `Finoka-<版本>-windows-amd64.exe` | 免安装单文件，自带环境引导，双击即用 |
| **macOS** | `Finoka-<版本>-macOS.zip` | 适配 Apple Silicon 与 Intel 架构 |

> Windows 用户初次使用本地转写时，应用会自动引导下载 `uv` 并部署隔离的 Python 3.12 运行环境，无需手动安装 Python 或配置系统 PATH。

---

## ✨ 核心特性

- 🎙️ **全链路 AI 字幕转写与翻译**
  - **人声分离**：采用 BS-Roformer 神经网络模型精确剥离伴奏与背景噪音。
  - **精准对齐与 VAD**：结合 energy VAD 与带 WT-refine 补丁的 CTranslate2 / Whisper 引擎，实现毫秒级词级时间戳定位。
  - **智能纠错与翻译**：LLM 上下文感知纠错与高质量中日双语翻译，告别生硬机翻。
- ⚡ **本地优先与同源双执行模式**
  - **本地模式**：NVIDIA GPU 本地直接推理，私密数据不出机，支持配置用户自持的 LLM API Key。
  - **云端模式**：一键调度云端 GPU 算力，桌面端仅提取上传无损纯音频（零损失、保护原片隐私），断点自动保存与续跑。
  - **完全同源**：本地与云端运行完全一致的 FineSub 引擎快照与校验规则，保证产物质量一致。
- 🎬 **专业级轨道编辑与所见即所得**
  - **JASSUB 渲染引擎**：基于 WebAssembly 的专业 ASS 字幕实时渲染，与主流播放器像素级对齐。
  - **多轨可视化时间轴**：波形图、词级对齐高亮、低置信度警告段落标记、多轨道拖拽。
  - **灵活导出**：支持导出 SRT、带样式的 ASS 字幕，以及硬件加速的**字幕内嵌压制视频**。
- 🛡️ **轻量、安全与现代化体验**
  - **原生 Go + React 19 架构**：依托 Wails v3，超低内存占用，无卡顿启动。
  - **智能缓存管理**：内置 LRU 视频缓存策略，正在编辑的工程受保护，支持自定义缓存上限。
  - **本地乐观锁存储**：工程快照与版本历史落盘保护，防止并发覆盖。

---

## 🚀 快速开始（开发指南）

### 1. 环境准备
确保开发机已安装：
- **Go (1.25+)**
- **Node.js (18+)** 与 **npm**
- **Python (3.12)**
- **[Task](https://taskfile.dev/)**（推荐）：`go install github.com/go-task/task/v3/cmd/task@latest`

### 2. 启动桌面端开发
进入 `desktop/` 目录并启动开发服务，将同时拉起 Go 后端与 Vite 前端热更新：

```bash
cd desktop
task dev
```

### 3. 常用开发与构建命令

#### 桌面端命令 (`desktop/` 目录下)
| 命令 | 说明 |
| :--- | :--- |
| `task dev` | 启动开发模式（Wails 运行时 + 前端热重载，端口 9245） |
| `task verify` | 自动生成 bindings、装配 sidecar 资源并执行完整桌面校验 |
| `task build` | 构建当前平台的生产可执行文件到 `bin/` |
| `task package` | 产出分发包（Windows 单文件 `Finoka.exe`，macOS `Finoka.app`） |
| `task run` | 运行已构建的桌面应用产物 |
| `go test ./...` | 运行 Go 后端单元测试 |
| `npm --prefix frontend run typecheck` | 前端 TypeScript 类型检查 |
| `npm --prefix frontend run test` | 前端单元测试 |

#### 算法引擎与云端命令 (项目根目录下)
| 命令 | 说明 |
| :--- | :--- |
| `python scripts/sync_finesub.py check` | 离线校验 FineSub 固定快照与补丁完整性 |
| `python -m pytest -q` | 运行 Python 引擎契约、Projector 与文档存储测试 |
| `python -m scripts.build_finesub_bundle` | 构建本地/云端通用的 Engine Bundle |
| `modal deploy -m finoka_modal.app` | 部署生产环境 Modal 云端后端 |

---

## 📁 项目结构

```text
finoka/
├── desktop/                  # 桌面端应用主工程
│   ├── main.go               # 桌面应用入口与资源装配
│   ├── Taskfile.yml          # 构建、打包与开发任务编排
│   ├── internal/app/         # Wails 核心服务、本地流媒体网关、缓存与更新
│   └── frontend/             # React 19 前端工程（媒体库、JASSUB 编辑器、轨道视图）
├── src/finoka/               # Python 适配层、Artifact Projector 与 DocumentStore
├── modal_backend/            # 独立 Modal 云端 GPU 后端与 CTranslate2 补丁
├── third_party/finesub/      # 固定 commit 的 FineSub 算法引擎快照（生成目录）
├── patches/finesub/          # 维护的 FineSub 专用补丁栈
├── scripts/                  # 引擎同步、构建与运维脚本
└── docs/                     # 架构与核心规范文档
```

---

## 📂 数据与存储路径

应用会在系统标准应用数据目录中维护配置与工作缓存：

- **数据根目录**（可通过 `FINOKA_DATA_DIR` 环境变量重定向）：
  - **Windows**: `%APPDATA%\Finoka`
  - **macOS**: `~/Library/Application Support/Finoka`
- **核心子目录与文件**：
  - `videos/`：大容量视频工作副本缓存（受 LRU 上限约束）。
  - `documents/`：字幕工程、波形缓存与编辑版本历史（`document.json`、`history/` 等）。
  - `tasks/`：本地转写任务中间产物与日志。
  - `thumbs/`：媒体快照缩略图。
  - `runtime/`：Windows 端由 `uv` 自动管理的隔离 Python 与模型环境。
  - `config.json`：全局偏好设置与窗口状态。
  - `library.json`：本地媒体库与工程索引。

---

## 📚 进阶架构与规范

- 🏗️ **[系统架构与契约规范](docs/architecture.md)**：深入了解 Provider 执行协议、EditDocument 投影规则、云端同步契约与 Modal API。
- ⚙️ **[FineSub 引擎同步与云端后端运维](docs/engine-and-cloud.md)**：了解上游引擎同步白名单、补丁栈管理、Vocal 采样率阶梯分档与 AOTI 加速策略。

---

## 📄 开源协议

本项目采用 **[GPL-3.0](./LICENSE)** 开源许可证。
底层的 FineSub 算法代码采用 **MIT** 许可证，Prompt 模板遵循 **CC BY-SA 4.0** 许可。