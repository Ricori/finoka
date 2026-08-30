# FineSub 引擎同步、补丁栈与构建规范

本文档记录 FineSub 算法引擎在 Finoka 中的集成原则、快照同步流程、补丁栈维护规则、Patched CTranslate2 构建以及本地 Engine Bundle 构建规范。

---

## 1. 引擎集成原则

Finoka 不 fork FineSub，也不手工复制零散算法模块：

1. **快照同步**：仓库通过自动化脚本同步官方固定 commit 的完整引擎快照，`third_party/finesub` 视为生成产物。
2. **同源引擎包**：构建产出字节稳定的本地与云端共用 Engine Bundle（`finesub-engine/<version>+<commit>`），杜绝本地与云端算法漂移。
3. **补丁栈约束**：开发调试时可直接修改 vendor，但提交前必须整理为独立的 `patches/finesub/*.patch`，并通过正反向重放契约测试。
4. **外部适配优先**：业务逻辑、任务状态与数据模型统一在外部 Adapter 与 Projector 实现，保持引擎纯粹。

---

## 2. 同步机制与目录规范

### 2.1 目录结构
```text
third_party/finesub/
├── README.md
├── UPSTREAM.json           # 上游源信息、commit 与校验哈希
├── FILES.json              # 当前打补丁后的文件清单
├── BASELINE_FILES.json     # 未打补丁的上游基线文件哈希
├── LICENSE                 # 上游 MIT 开源协议
├── PROMPT_LICENSE.md       # Prompt 模板的 CC BY-SA 4.0 协议
├── pyproject.toml
├── src/
│   ├── finesub/            # 核心转写流水线
│   └── finesub_bootstrap/  # 运行时与模型下载管理器
└── resources/
    └── runtime-manifest.json
```

### 2.2 同步白名单
- **核心代码**：`src/finesub/**`、`src/finesub_bootstrap/**`
- **配置文件与协议**：`pyproject.toml`、`LICENSE`、`PROMPT_LICENSE.md`
- **运行时锁与清单**：`desktop/runtime/pylock.*.toml`、`desktop/resources/runtime-manifest.json`
- *排除项*：FineSub 原生前端、pywebview launcher、安装器 UI、实验测试文件。

### 2.3 `UPSTREAM.json` 契约
```json
{
  "repository": "https://github.com/caca2331/finesub",
  "ref": "v0.4.2",
  "commit": "8a33092a40ab4d86872941155143fd91b84eaa56",
  "archive_sha256": "...",
  "engine_version": "0.4.2",
  "synced_at": "2026-08-22T00:00:00Z",
  "sync_schema": 1,
  "patches": []
}
```
构建与 CI 必须严格校验 `UPSTREAM.json`，哈希不匹配时立即中断构建。

---

## 3. 补丁栈管理与契约测试

### 3.1 当前维护的补丁清单
| 补丁文件 | 影响模块 | 存在原因 | 移除条件 |
| :--- | :--- | :--- | :--- |
| `0001-split-vad-prefix-and-qwen-pass.patch` | `src/finesub` | 云端三容器架构需要将纯 CPU 的 VAD 前缀与 Qwen 收尾独立调度执行 | 上游支持分步调度，或不再拆分容器 |
| `0002-retry-directory-publish-rename.patch` | `src/finesub_bootstrap` | Windows 下防病毒扫描或读取句柄导致 `os.replace` 偶发报错，引入带退避的有界重试 | 上游合并原子重命名的重试逻辑 |
| `0003-desktop-model-routing.patch` | `src/finesub` | 读取桌面端首选 LLM 目标与 Gemini Base URL 自定义配置 | 上游提供原生 Base URL 与目标覆盖接口 |
| `0004-subprocess-text-encoding-and-msvc-include.patch` | `src/finesub` | 非 UTF-8 ANSI 代码页（如 GBK）下 `subprocess(text=True)` 读 ffmpeg/ffprobe 的 UTF-8 输出会抛 `UnicodeDecodeError`；`cl.exe` 在 PATH 但 `INCLUDE` 缺 `<array>` 时 AOTI 会跳过 `vcvars64.bat` 激活 | 上游显式指定 UTF-8 解码并检查 MSVC include 就绪 |
| `0005-codex-terra-model.patch` | `src/finesub` | Codex CLI 提供 `gpt-5.6-terra`，但打包目录只记录了 luna 与 sol；`LOCAL_CODEX` 的目录行不会自动生成 target（`AUTO_TARGET_LOCAL_AGENT_PROFILES` 仅含 dsh），桌面端因此无目标可指。quality_score 由 owner 评定为 80（介于 sol 90 与 luna 70 之间），其余能力列沿用同族 luna 的实测值，待 terra 单独实测后替换 | 上游在打包目录中收录 terra |

### 3.2 补丁栈测试约束
- **正反向重放**：`tests/test_finesub_patch_stack.py` 会从当前 vendor 逆序撤销所有 patch，比对是否与 `BASELINE_FILES.json` 一致；随后重新正序应用，比对是否与 `FILES.json` 完全一致。
- **边界保护**：除特定拆分与路由补丁外，严禁补丁触碰未经测试证明的算法核心。

### 3.3 同步与校验命令
```bash
# 离线校验当前快照与补丁完整性
python scripts/sync_finesub.py check

# 运行补丁栈与引擎契约测试
python -m pytest tests/test_split_stage_contract.py tests/test_finesub_patch_stack.py tests/test_resource_activation_retry.py -q

# 构建本地/云端 Engine Bundle
python -m scripts.build_finesub_bundle

# 同步指定 upstream 版本
python scripts/sync_finesub.py sync --ref v0.4.2
```

---

## 4. Patched CTranslate2 构建

FineSub `0.4.2` 的 `fw-refine` 后端深度依赖 CTranslate2 解码器内部的 attention、beam winner lineage、终止事件与 chosen logprob 接口，原生 CTranslate2 不具备此能力。

### 4.1 补丁序列
补丁源码位于 `modal_backend/ct2_patches/`，基于上游 `v4.8.1 / 0d8bcd36`：
- `0001`–`0004`：WT alignment 控制与 attention 后处理。
- `0005`–`0008`：Decoded prefix、单遍 trace/refine path 与 unfinished span。
- `0009`–`0010`：Beam winner lineage 与 disfluency weights。
- `0011`：逐样本 `real_audio_frames` 支持。

### 4.2 镜像构建与验证
构建环境拉取源码、应用 11 个补丁并编译 Linux CUDA wheel。构建末尾自动执行 `return_refine_paths` 接口断言，确保运行时能力完备。
