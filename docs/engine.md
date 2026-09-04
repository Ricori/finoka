# FineSub 引擎同步、补丁栈与构建规范

本文档记录 FineSub 算法引擎在 Nonoka X 中的集成原则、快照同步流程、补丁栈维护规则、Patched CTranslate2 构建以及本地 Engine Bundle 构建规范。

---

## 1. 引擎集成原则

Nonoka X 不 fork FineSub，也不手工复制零散算法模块：

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
| `0003-desktop-model-routing.patch` | `src/finesub` | 读取桌面端首选 LLM 目标与 Gemini Base URL 自定义配置。API 提供商的选定目标前置于打包组之上（保留可处理音视频的兜底）；选定**本地 CLI** 时不保留任何 API 兜底——它跑在用户自己的订阅上，静默改走 Gemini 既不是用户要的，也会在没有 Gemini Key 时报出与真实原因无关的错误。同 tier 的打包成员保留（同一个 CLI，agy 的联网孪生目标据此仍可达）；该 CLI 无法胜任的任务改为在能力校验阶段直接报错并点名 CLI | 上游提供原生 Base URL 与目标覆盖接口 |
| `0004-subprocess-text-encoding-and-msvc-include.patch` | `src/finesub` | 非 UTF-8 ANSI 代码页（如 GBK）下 `subprocess(text=True)` 读 ffmpeg/ffprobe 的 UTF-8 输出会抛 `UnicodeDecodeError`；`cl.exe` 在 PATH 但 `INCLUDE` 缺 `<array>` 时 AOTI 会跳过 `vcvars64.bat` 激活 | 上游显式指定 UTF-8 解码并检查 MSVC include 就绪 |
| `0005-codex-terra-model.patch` | `src/finesub` | Codex CLI 提供 `gpt-5.6-terra`，但打包目录只记录了 luna 与 sol；`LOCAL_CODEX` 的目录行不会自动生成 target（`AUTO_TARGET_LOCAL_AGENT_PROFILES` 仅含 dsh），桌面端因此无目标可指。quality_score 由 owner 评定为 80（介于 sol 90 与 luna 70 之间），其余能力列沿用同族 luna 的实测值，待 terra 单独实测后替换 | 上游在打包目录中收录 terra |
| `0006-runtime-tool-manifest.patch` | `resources/runtime-manifest.json` | 两处对打包清单的更正。①清单钉的是 BtbN 的 **lgpl** 构建（`--disable-libx264`），而引擎所有切片都用 `libx264` 编码——视频窗切片、agy 的视频转码，以及把音频窗封成单帧 MP4 的 `containerize_audio_for_agy`；只要纠错参考不是纯文本就会报 `Unknown encoder 'libx264'`，改用同一 release 的 gpl 构建可让切片与引擎的标定保持一致，ffmpeg 由用户机器在预置阶段自行下载，Nonoka X 不分发该二进制。②桌面端视频下载器需要 aria2c、node 与 pot-provider，上游清单未声明；Nonoka X 没有独立的资源系统，只能在此声明才可安装 | ffmpeg 部分：上游改用 lgpl 构建可运行的编码器或自行钉 gpl 变体；其余：上游清单收录这三项工具 |
| `0007-agy-workspace-read-grant.patch` | `src/finesub` | agy 1.1.20 起只自动放行工作区内的读取，工作区外一律弹权限确认；headless 无法确认，`-p` 会软拒绝并结束回合，驱动判为 transient，链路一路回退到没有 Key 的 Gemini 付费池并报出误导性的 `Provider GEMINI_PAID is disabled`。工具协议与联网检索两条 agy 路径交给模型的文件都在其项目工作区之外，用 `--add-dir` 把这些目录并入工作区；读取边界仍由项目内的 PreToolUse 钩子把守 | 上游为 agy 项目授予其所交付目录的读取权限 |
| `0008-hf-mirror-disable-xet.patch` | `src/finesub_bootstrap` | `huggingface_hub` 1.x 默认走 Xet，而 HF 镜像并不代理 Xet：镜像返回的元数据仍指向官方 `cas-server.xethub.hf.co`，随附的短期令牌该 CAS 不认，于是元数据请求成功、下载在首个 reconstruction 请求上以 `401 Unauthorized` 失败，`cn` 路由下模型完全装不上。只在流量确实指向镜像时关闭 Xet（官方端点仍走 Xet，用户显式设置的 `HF_HUB_DISABLE_XET` 优先）；同时把该 401 计入镜像失败标记，使回退官方源与按机器降级的规则真正生效 | 镜像同时代理 Xet 内容寻址存储，或上游不再对令牌不被 CAS 接受的端点下发 Xet 元数据 |
| `0009-correction-output-truncation-warning.patch` | `src/finesub` | 窗口回答触达输出上限时，引擎会整次作废并把窗口对半拆开重跑，但这个决定只记在 debug 与任务产物里：桌面端看到的是 `correction window validation failed ... output_limited=true` 和一串越来越长的 chunk id，既看不出一次数分钟的生成被丢弃，也看不出补救手段是一个配置项。实测某 DeepSeek V4 路由声明的输出上限偏小四倍时，5 个窗口膨胀到 13 个、纠错跑了一个多小时而日志里没有任何一句点出原因。每次运行只告警一次（配置错误会在每个窗口上重复触发），总次数由收尾摘要的「输出截断」给出 | 上游把输出截断经 reporter 上报，而不只写进任务产物 |
| `0010-provider-call-failure-visibility.patch` | `src/finesub` | `chat_complete` 里的每一次 HTTP 失败——429 退避、402 换 Key、超时重试、整个 tier 的 Key 被日限锁死——此前只写进任务产物的 `api_attempts`，reporter 一句都不发。结果是限流或欠费的提供商在桌面端与"卡死"完全无法区分，排查只能靠索要 artifacts 目录。同一 (tier, 模型, 返回码) 首次出现记为 warning 并保留提供商原文与下一步动作，重复出现降级为 debug（限流本就会连续产生大量同类记录） | 上游把提供商调用失败经 reporter 上报 |
| `0011-qwen-referee-offline-and-nonfatal.patch` | `src/finesub` | 两处独立故障，同一个症状：对齐跑完之后整条流水线才崩，栈顶是 httpx。①`_ensure_model` 把仓库 id 交给 `from_pretrained`，而 transformers 5.x 会先联网解析该仓库的对话模板清单再看缓存——此时权重早已在盘上（`ensure_hf_model` 干净返回本就意味着无需再取）。那次解析本来有离线兜底，却兜不住这一种：`list_repo_templates` 捕获的是 `httpx.NetworkError`，而 `httpx.ConnectTimeout` 继承自它的兄弟 `TimeoutException`——连接被拒能恢复，连接被丢弃（`WinError 10060`）则直接抛出，复核能不能加载取决于网络以哪种方式拒绝。②`apply_verification` 的两个调用点都没有兜底，而复核只产出证据、从不做决策，任何异常却都会带走整次运行。钉住的快照可信时传 `local_files_only` 去掉成因；`auto` 下捕获（`on` 是调用方点名要证据，仍然抛）去掉波及面，失败路径不写 `qwen_verify` 键，后续的收尾复核因此仍愿意再试。同时把 Gemini 上传的 connect 超时从 45s 降到 15s：这个预算是按解析出的每个地址各花一次的，`generativelanguage.googleapis.com` 有好几个，被墙时实测静默 169 秒才打出第一条重试日志，与卡死无从分辨 | 上游离线加载已钉住的本地权重（或把那处兜底放宽到 `TimeoutException`），并把失败的复核当作缺证据而非运行失败 |

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
