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
├── LICENSE                 # 上游 GPL-3.0-or-later 开源协议（0.5.0 起，此前为 MIT）
├── PROMPT_LICENSE.md       # Prompt 模板的 CC BY-SA 4.0 协议
├── pyproject.toml
├── VERSION                 # pyproject.toml 读取的动态版本号
└── src/
    ├── finesub/            # 核心转写流水线
    └── finesub_bootstrap/  # 运行时与模型下载管理器
        ├── runtime-manifest.json    # 托管二进制清单
        ├── pylock.win-py312.toml    # Python 运行环境锁
        └── pylock.win-py312.cn.toml # 同上，国内镜像路由
```

> 上游 0.5.0 把桌面端移出了仓库，托管运行时的三份资产随之成为 `finesub_bootstrap`
> 的包内数据：`resources.PACKAGED_RUNTIME_MANIFEST` 与 `environment.PACKAGED_RUNTIME_LOCK`
> 都用 `Path(__file__).with_name(...)` 解析它们。快照因此**不再**保留
> `resources/` 与 `runtime/` 两个目录——留一份副本只会让补丁打在没人读的那份上，
> 而且失败是静默的。

### 2.2 同步白名单
- **核心代码**：`src/finesub/**`、`src/finesub_bootstrap/**`（含上述三份运行时资产）
- **配置文件与协议**：`pyproject.toml`、`LICENSE`、`PROMPT_LICENSE.md`
- **版本号**：仓库根目录 `VERSION`。0.5.0 起 `pyproject.toml` 的 `project.version`
  是 `dynamic`，同步器改为读这个文件，读不到即中断。
- *排除项*：FineSub CLI 包装、部署脚本、agent 任务说明、实验测试文件。

### 2.3 `UPSTREAM.json` 契约
```json
{
  "repository": "https://github.com/caca2331/finesub",
  "ref": "v0.5.0",
  "commit": "4638bb7f01d7ba52520395dad9905e873ba09452",
  "archive_sha256": "...",
  "engine_version": "0.5.0",
  "synced_at": "2026-09-04T06:00:12Z",
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
| `0001-qwen-tail-entry-point.patch` | `src/finesub` | 云端三容器架构把纯 CPU 的收尾与要 GPU 的识别分开调度，而上游的复核是 `run_vad_asr` 内联的一段，没有对既有 aligned 产物补挂证据的入口。`finalize_qwen_verification` 就是这个入口，调用的是上游自己的 `apply_verification`，参数一模一样；纯增量，本地与 CLI 走的仍是未被触碰的内联路径。上游 0.5.0 已自带 VAD 前缀那一半（`run_vad_prefix`、`write/read_vad_prefix`、`run_vad_asr(vad_prefix_path=)`）与 `QwenReferee.warm`，故补丁只剩这一个函数 | 上游支持对既有 aligned 产物单独跑复核，或不再拆分容器 |
| `0002-runtime-tool-manifest.patch` | `src/finesub_bootstrap/runtime-manifest.json` | 桌面端视频下载器需要 aria2c、node 与 pot-provider，上游清单未声明；Nonoka X 没有独立的资源系统（所有托管二进制都在 `finesub/runtime/<id>/` 下由 `managedtools` 解析），只能在此声明才可安装。三者只在一起才有用：YouTube 是逐道设卡的，缺一件会在更早的一道上失败，看起来像单独加哪一件都没用。ffmpeg 那一半已随上游 0.5.0 改钉 gpl 构建而删除 | 上游清单收录这三项工具 |
| `0003-agy-workspace-read-grant.patch` | `src/finesub` | agy 1.1.20 起只自动放行工作区内的读取，工作区外一律弹权限确认；headless 无法确认，`-p` 会软拒绝并结束回合，驱动判为 transient，链路一路回退到没有 Key 的 Gemini 付费池并报出误导性的 `Provider GEMINI_PAID is disabled`。工具协议与联网检索两条 agy 路径交给模型的文件都在其项目工作区之外，用 `--add-dir` 把这些目录并入工作区；读取边界仍由项目内的 PreToolUse 钩子把守 | 上游为 agy 项目授予其所交付目录的读取权限 |
| `0004-qwen-referee-offline-and-nonfatal.patch` | `src/finesub` | 两处独立故障，同一个症状：对齐跑完之后整条流水线才崩，栈顶是 httpx。①`_load_model` 把仓库 id 交给 `from_pretrained`，而 transformers 5.x 会先联网解析该仓库的对话模板清单再看缓存——此时权重早已在盘上（`ensure_hf_model` 干净返回本就意味着无需再取）。那次解析本来有离线兜底，却兜不住这一种：`list_repo_templates` 捕获的是 `httpx.NetworkError`，而 `httpx.ConnectTimeout` 继承自它的兄弟 `TimeoutException`——连接被拒能恢复，连接被丢弃（`WinError 10060`）则直接抛出，复核能不能加载取决于网络以哪种方式拒绝。上游 0.5.0 在这里什么也没改：它传的 `revision=` 从 0.4.2 起就在，与这条无关。②`apply_verification` 的调用点没有兜底，而复核只产出证据、从不做决策，任何异常却都会带走整次运行。钉住的快照可信时传 `local_files_only` 去掉成因；`auto` 下捕获（`on` 是调用方点名要证据，仍然抛）去掉波及面，失败路径不写 `qwen_verify` 键，后续的收尾复核因此仍愿意再试。同时把 Gemini 上传的 connect 超时从 45s 降到 15s：这个预算是按解析出的每个地址各花一次的，`generativelanguage.googleapis.com` 有好几个，被墙时实测静默 169 秒才打出第一条重试日志，与卡死无从分辨（0.5.0 把这个常量从 `llm/client.py` 挪到了 `llm/media_upload.py`，值未变） | 上游离线加载已钉住的本地权重（或把那处兜底放宽到 `TimeoutException`），并把失败的复核当作缺证据而非运行失败 |
| `0005-nonoka-042-runtime-marker.patch` | `src/finesub_bootstrap` | 0.5.0 把运行时锁移入包目录并改用忽略注释与换行的内容摘要，原本意图复用 0.4.x 环境；但其兼容表只收了上游工作区锁的哈希，遗漏 Nonoka X 0.4.2 实际发布包中带旧桌面生成命令头的 LF/CRLF 哈希。依赖行完全一致，误判却会重建约 5 GB 环境并重新下载 PyTorch。本补丁接受这两个已发布、可复核的旧哈希，下一次真正重生成锁时即可删除 | 上游兼容表收录 Nonoka X 0.4.2 的两个发布锁哈希，或提供基于旧锁内容摘要的通用迁移 |
| `0006-triton-msvc-c11-empty-struct.patch` | `src/finesub` | Windows 下 Triton 生成的 C11 启动器代码（`__triton_launcher.c`）包含空结构体初始化 `CUlaunchAttribute clusterAttr = {};`。MSVC 在 `/std:c11` 严格模式下报 `error C2059: 语法错误: '}'`，且 Windows SDK `winbase.h` 产生 `warning C5105`。本补丁 monkey-patch Triton 的启动器生成与构建命令，将 `{}` 替换为合法的 `{0}` 并插入 `/wd5105` 屏蔽告警 | 上游 Triton 修复 C11 下的空结构体初始化或上游 FineSub 内置该适配 |
| `0007-referee-live-vram-and-verify-progress.patch` | `src/finesub` | 两处，同一个症状：任务日志停在 `group ASR (...)` 那一行之后再无输出。①`lang_redecode.referee_device` 只按**档位预算**判断复核模型能不能与常驻的 Whisper 池共处一卡，而档位是"这类机器应该有多少空闲"的预算、不是测量——`standard` 记 6.5 GiB，于是在驱动只剩 2.4 GiB 的卡上照样算出"富余 4.43 GiB"。`vad_asr_stage.RefereeWarm` 随即在 CTranslate2 解码的同时用辅助线程把复核模型搬上卡，两者相撞：编码器要么空转数分钟、一条事件都发不出，要么进程在组内直接吃访问违例（8 GB RTX 3070 上两次复现 `0xC0000005`），没有 Python 异常可供桌面端上报。同一任务同一台机器实测：抑制并行预热后对齐 17.7 秒跑完，不抑制则 60 秒内进程消失。现在实时空闲显存对这一处放置有否决权——且只对这一处，绝不用于选档位（档位会改变分离器分块边界，必须稳定）。②收尾复核是整条流水线里最长的一段静默（受挤的卡上 197 秒的阶段里占 168 秒，零事件），现在按 clip 计数汇报进度，并在加载之前就先报出 0/N，好让这一段在还没开始动之前就有名字 | 上游按实时空闲显存决定复核模型是否共处一卡，并在 `apply_verification` 内汇报进度 |

> 上游 0.5.0 吸收了此前的部分补丁：Windows 发布性重命名重试
> （`fsops.ReplaceBudget`）、GBK 代码页下的子进程解码与 MSVC `INCLUDE` 就绪检查
> （但未包含 Triton C11 空结构体修复，故以 0006 重新维护）、
> Codex 的 GPT-5.6 Terra 目录行、`GEMINI_BASE_URL` 与 `[llm.preferred_targets]`、
> HF 镜像关闭 Xet（`model_fetch.apply_xet_policy`），以及每次 API 交互的运行日志。
> 其中三条的行为承诺仍由 Nonoka X 侧的回归测试守着，实现则已经是上游的：
> `tests/test_resource_activation_retry.py`、`tests/test_hf_mirror_transfer.py`、
> `tests/test_llm_call_visibility.py`。
>
> ⚠ `[llm.preferred_targets]` 的语义比它取代的补丁更严格：钉住的模型组**替换整条链**，
> 钉住的模型做不了的调用直接失败，后面不再挂任何兜底（上游 2026-08-28 的裁定）。
> 桌面端据此把音视频纠错入口在选定模型不支持时直接禁用并说明——把失败前移到设置页，
> 而不是让它发生在跑到一半的时候。

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
python scripts/sync_finesub.py sync --ref v0.5.0
```

---

## 4. Patched CTranslate2 构建

FineSub `0.5.0` 的 `fw-refine` 后端深度依赖 CTranslate2 解码器内部的 attention、beam winner lineage、终止事件与 chosen logprob 接口，原生 CTranslate2 不具备此能力。

### 4.1 补丁序列
补丁源码位于 `modal_backend/ct2_patches/`，基于上游 `v4.8.1 / 0d8bcd36`：
- `0001`–`0004`：WT alignment 控制与 attention 后处理。
- `0005`–`0008`：Decoded prefix、单遍 trace/refine path 与 unfinished span。
- `0009`–`0010`：Beam winner lineage 与 disfluency weights。
- `0011`：逐样本 `real_audio_frames` 支持。

### 4.2 镜像构建与验证
构建环境拉取源码、应用 11 个补丁并编译 Linux CUDA wheel。构建末尾自动执行 `return_refine_paths` 接口断言，确保运行时能力完备。
