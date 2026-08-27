# FineSub 引擎同步、补丁栈与云端后端运维

本文档记录 FineSub 算法引擎的同步与升级策略、补丁栈管理规则、Patched CTranslate2 构建以及 Modal 云端后端的架构与运维规范。

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
- 核心代码：`src/finesub/**`、`src/finesub_bootstrap/**`
- 配置文件与协议：`pyproject.toml`、`LICENSE`、`PROMPT_LICENSE.md`
- 运行时锁与清单：`desktop/runtime/pylock.*.toml`、`desktop/resources/runtime-manifest.json`
- *排除项*：FineSub 原生前端、pywebview launcher、安装器 UI、实验测试文件。

### 2.3 `UPSTREAM.json` 契约
```json
{
  "repository": "https://github.com/caca2331/finesub",
  "ref": "v0.4.1",
  "commit": "2a320ede3f5c29e431a4525aab01d97945f349c2",
  "archive_sha256": "...",
  "engine_version": "0.4.1",
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
python scripts/sync_finesub.py sync --ref v0.4.1
```

---

## 4. Patched CTranslate2 构建

FineSub `0.4.1` 的 `fw-refine` 后端深度依赖 CTranslate2 解码器内部的 attention、beam winner lineage、终止事件与 chosen logprob 接口，原生 CTranslate2 不具备此能力。

### 4.1 补丁序列
补丁源码位于 `modal_backend/ct2_patches/`，基于上游 `v4.8.1 / 0d8bcd36`：
- `0001`–`0004`：WT alignment 控制与 attention 后处理。
- `0005`–`0008`：Decoded prefix、单遍 trace/refine path 与 unfinished span。
- `0009`–`0010`：Beam winner lineage 与 disfluency weights。
- `0011`：逐样本 `real_audio_frames` 支持。

### 4.2 镜像构建与验证
Modal GPU 镜像在 Docker 构建期自动拉取源码、应用 11 个补丁并编译 Linux CUDA wheel。构建末尾自动执行 `return_refine_paths` 接口断言，确保运行时能力完备。

---

## 5. Modal 云端后端架构与调度

### 5.1 调度流程 (`run_finesub`)
云端采用 CPU 与 GPU 分离的五段式编排，最小化昂贵 GPU 容器的占用时长：

```text
1. prepare (CPU)          -> 下载源音频，ffmpeg 预解码为目标采样率 PCM
2. vocal (T4 GPU)         -> BS-Roformer 分块人声分离，输出 16kHz subtitle-vocal.flac
3. aligned-prepare (CPU)  -> energy VAD 计算，输出 aligned-prepared.pt
4. aligned (T4 GPU)       -> Patched CT2 执行 Whisper large-v3-turbo fw-refine 转写
5. cpu (CPU)              -> Qwen 判定收尾、生成 stable、纯文本 LLM 纠错与翻译
```

### 5.2 状态持久化与断点续跑
- 任务工作目录持久化在 Modal Volume 中。
- 任务执行携带独立 `run_id`，防止旧容器状态覆盖。
- 若任务在某阶段中断（如容器抢占或用户取消），重新执行时自动复用已提交产物（如跳过已完成的 vocal/aligned 阶段），**断点续跑不重复扣减次数**。

### 5.3 LLM 转发与 Secret 配置
云端直接复用部署环境已有的 Secret：
- `gz-llm` / `GZ_LLM_API_KEY`：主中转（`https://gpt-agent.cc/v1`）。
- `anthropic` / `ANTHROPIC_API_KEY`：备选中转（`https://codeyu.shop/v1`）。
- `yt-admin` / `ADMIN_TOKEN`：管理员认证。
- `huggingface` / `HF_TOKEN`：模型权重拉取。
- `r2`：音频临时对象存储。

LLM 纠错翻译模型固定采用 `gpt-5.6-terra`，通过 OpenAI 兼容 REST 接口调用，模型目录声明输出上限（65536 tokens），无需对引擎打额外窗口补丁。

---

## 6. Vocal 分离优化策略

### 6.1 采样率自动分档阶梯
分离耗时与音频时长、采样率成正比。云端按客户端申报时长自动选择立体声采样率，兼顾速度与识别精度：

| 音频时长 | 档位 | 分离输入 | 实时率 | 说明 |
| :--- | :--- | :--- | :---: | :--- |
| **< 12 分钟** | `44.1k-stereo` | 44.1 kHz 立体声 | 0.138 | 检查点原生采样率，短音频追求最高音质 |
| **12–40 分钟** | `32k-stereo` | 32 kHz 立体声 | 0.105 | 质量甜点：ASR 频带偏差极小，耗时减少 ~26% |
| **> 40 分钟** | `22.05k-stereo` | 22.05 kHz 立体声 | 0.072 | 极致性价比：长音频成本减半，字幕质量依旧稳健 |

> **关键设计**：全档位保留立体声输入，彻底废除了旧版 16kHz 单声道（避免了因分离前下混导致的 VAD 漏失与歌词幻觉）。分离完成后由 ffmpeg 流式下混并重采样为 16kHz 单声道供后续 VAD/Whisper 使用。

### 6.2 AOTI Inductor 自动加速
- **装载成本平衡**：AOTI 包进程内首次装载需 11–13 秒固定开销。因此云端通过 `vocal_accel.wanted()` 判断：**音频时长 $\ge 270\text{ 秒}$ 时自动启用 AOTI 加速**（分离速度提升 1.6–1.73 倍），短音频则走 eager 模式避免负收益。
- **精简编译模块**：构建仅针对 transformer 块（`targets="transformers"`），构建时间由 120 秒降至 49 秒，包体积仅 4MB 且剥离了 torchaudio 依赖。
- **指令集隔离缓存**：缓存键携带宿主 CPU 特征哈希，防止不同机器 `-march=native` 导致非法指令崩溃。

### 6.3 长音频分块流式内存管理
为解决 2 小时长音频分离导致宿主内存飙升至 25–33 GB 的问题，云端引入 `_separate_blocked`：
- 按 10 分钟核心 + 两侧各 10 秒 padding 进行分块流式分离，并在内存中逐块拼回。
- 峰值 RSS 稳定控制在约 0.6 GB，容器内存申请仅需 2 GiB，彻底消除 OOM 风险。

---

## 7. 部署与运维命令

```bash
# 部署生产云端服务
modal deploy -m finoka_modal.app

# 验证 Patched CTranslate2 接口
modal run -m finoka_modal.testing.verify_container::verify_patched_ctranslate2

# 验证 Vocal 三档采样率分离
modal run -m finoka_modal.testing.verify_container::verify_vocal_tiers

# 预热并缓存 AOTI 模型包
modal run -m finoka_modal.operations.prime_container
```
