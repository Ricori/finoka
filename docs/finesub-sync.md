# FineSub 同步、打包与升级策略

## 1. 决策摘要

Finoka 不 fork FineSub，也不手工复制若干算法模块。仓库通过自动化脚本同步一个固定 commit
的完整引擎快照，并把该目录视为生成产物。

原因：

- FineSub 的生产入口不只是 VAD/ASR 文件，还依赖路径、资源 manifest、prompt 模板、
  依赖锁、patched CTranslate2 和阶段产物规则。
- 只复制“核心算法”会重演旧项目 `vod/finesub` 快照逐渐漂移的问题。
- 完整快照仍然可以只包含运行必需目录，不需要带上 FineSub 自己的前端和安装器 UI。

## 2. 建议目录

```text
third_party/finesub/
  README.md
  UPSTREAM.json
  LICENSE
  PROMPT_LICENSE.md
  pyproject.toml
  src/
    finesub/
    finesub_bootstrap/
  runtime/
    pylock.win-py312.toml
    pylock.win-py312.cn.toml
    runtime-manifest.json
```

`third_party/finesub` 是补丁应用后的可运行源码。开发调试时允许直接修改其中代码；
交付前必须把差异整理到 `patches/finesub`，并确保补丁栈能够从固定基线完整重建该目录。

## 3. 同步白名单

必需：

- `src/finesub/**`
- `src/finesub_bootstrap/**`
- 根 `pyproject.toml`
- 根 `LICENSE`
- `src/finesub/llm/prompt_templates/LICENSE.md`
- `desktop/runtime/pylock.win-py312.toml`
- `desktop/runtime/pylock.win-py312.cn.toml`
- `desktop/resources/runtime-manifest.json`

按实现需要评估后再加入：

- `desktop/backend/resources/**`：若决定直接复用上游资源安装管理器。
- `desktop/backend/common/models.py`：若决定复用上游 `TaskRequest` 校验。
- `desktop/backend/worker/protocol.py`：可作为参考；长期更建议 Finoka 自有协议。

默认不加入：

- `desktop/frontend/**`
- pywebview launcher、tray、updater UI
- FineSub installer
- `tools/**`
- 大多数实验和 benchmark 文件
- 上游测试全集

Finoka 自己应保留少量上游 artifact fixture，作为 Projector 契约测试数据。

## 4. `UPSTREAM.json`

真正同步后生成类似：

```json
{
  "repository": "https://github.com/caca2331/finesub",
  "ref": "v0.4.1",
  "commit": "2a320ede3f5c29e431a4525aab01d97945f349c2",
  "archive_sha256": "<source archive sha256>",
  "engine_version": "0.4.1",
  "synced_at": "2026-08-22T00:00:00Z",
  "sync_schema": 1,
  "patches": []
}
```

没有这个文件或哈希不匹配时，构建必须失败，不能退回机器上碰巧安装的另一个 FineSub。

## 5. 同步流程

同步脚本建议按以下步骤执行：

1. 接收 tag 或 40 位 commit。
2. 从官方仓库下载 source archive 到临时目录。
3. 计算 SHA-256，并解析实际 commit/version。
4. 检查白名单文件全部存在。
5. 在新的临时 vendor 目录中复制白名单。
6. 应用 `patches/finesub/*.patch`，每份补丁先执行 check。
7. 生成 `UPSTREAM.json` 和许可证清单。
8. 运行 import、package-data 和 artifact contract 测试。
9. 原子替换 `third_party/finesub` 生成内容。
10. 生成变更摘要：新增/删除模块、依赖锁变化、artifact fixture 差异。

脚本中途失败不得修改当前可构建的 vendor 快照。

## 6. 补丁政策

优先级：

1. 在 `adapter/` 通过组合解决。
2. FineSub 缺少通用扩展点时向上游提交 PR。
3. 只有无法及时上游合并时才维护独立 patch。

约束：

- 允许在开发和调试阶段直接修改 vendor 文件，但不能提交无法由 patch 重建的修改。
- 每份 patch 必须说明原因、对应上游 issue/PR、预期删除条件。
- 每份 patch 必须有 Finoka 契约测试。
- 同步新版本时 patch 无法干净应用就立即失败，不自动三方合并。
- Prompt 修改必须单独记录，因为该目录使用 CC BY-SA 4.0。

当前补丁栈有两份，分属两层：

| 补丁 | 触碰范围 | 存在理由 | 删除条件 |
|---|---|---|---|
| `0001-split-vad-prefix-and-qwen-pass.patch` | `src/finesub` | 云端三容器编排需要单独跑 VAD 前缀与 Qwen 收尾 | 上游能分步跑这两段，或 Finoka 不再拆容器 |
| `0002-retry-directory-publish-rename.patch` | `src/finesub_bootstrap` | Windows 上发布用的 `os.replace` 会被刚写入文件的句柄拒绝：资源安装在最后一步丢掉整次下载，`write_atomic` 丢掉整个任务 | 上游自己重试发布用的 `os.replace` |

两者的约束不同。`src/finesub` 是本地与云端共享的引擎，多一份补丁就多一处两边不同，
必须先在本文档说明理由；`src/finesub_bootstrap` 只在本机安装引擎时运行（容器在运行期
不安装任何东西），所以补丁不可能让两边算出不同结果。
`tests/test_split_stage_contract.py` 按这条界线检查补丁栈：`0001` 之外的补丁只允许
落在 `src/finesub_bootstrap/`。

`0001-split-vad-prefix-and-qwen-pass.patch` 把 `run_vad_asr`
里只需要 CPU 的 VAD 前缀和 Qwen 收尾拆成可独立调用的入口，供云端的三容器编排使用。
它是纯增量的——新增函数，加上 `run_vad_asr` 一个默认为 `None` 的关键字——所以任何不传
`prepared_path` 的调用方（本地 worker、CLI、batch）走的仍是未改动的上游代码路径。
`tests/test_split_stage_contract.py` 会逐条核对这一点：补丁只能碰那两个文件，删除的
每一行代码都必须原样重新出现（只允许缩进变化），注释只能重新折行不能改写。

`0002-retry-directory-publish-rename.patch` 修的是“发布”这一步：安装器最后都落在
`os.replace` 上，而 Windows 只要有人还握着其中任一个名字就拒绝——杀毒软件扫描刚写下的
字节就够了，普通读取也够，因为 Python 的 `open` 不共享删除权限。三处会在真实机器上失败：
资源安装把 `<version>.staging` 改名成 `<version>`（刚解压完 `ffmpeg.exe`，用户看到
`[WinError 5] 拒绝访问`，几分钟的下载全部作废）；下载器把 `.part` 发布成最终文件，早一步、
同样刚写完；`write_atomic` 的临时文件交换，代价不是一次下载而是整个任务 `engine_failed`。

上游其实已经为 Python 运行时的激活写过一份有界重试（`EnvironmentManager._swap`），补丁把
它提到 `fsops.replace_path`，让所有“发布”走同一条路径。两处故意保持裸 `os.replace`，
因为它们失败的含义本身就是信息：`move_directory` 顶部那次探测失败意味着“跨卷”，是转向
复制的信号；哈希不匹配时把坏文件挪到 `.bad` 是失败路径，不是发布。`write_atomic` 的退避
预算更短——一棵树只发布一次，一条记录每次状态更新都要重写，名字若长期被占，长预算会让
之后每一次写都付全额。另外，激活前的存在性检查改用 `os.path.lexists`（失效 junction 会让
`Path.exists` 读成不存在，却仍占着那个名字），失败清理也不再让自己的异常盖掉真正的诊断。

它治不了持续读取者：有界等待熬不过一个不停重开同一个名字的循环。那是写者饥饿，是另一个
问题，这里也没有哪个调用方那样轮询。契约测试是 `tests/test_resource_activation_retry.py`；
Finoka 自己的 `src/finoka/document_store.py` 有同样形状的交换，修法相同，测试在
`tests/test_document_store.py`。

早先另有四份补丁已经全部删除，因为它们要解决的问题都能在 vendor 之外解决：

| 已删除的补丁 | 它存在的唯一理由 | 现在怎么做 |
|---|---|---|
| execution profile 核心 | 给下面三份提供 `cloud_execution_enabled()` 开关 | 没有消费者了；云端与本地的差别现在体现在**调用哪个函数**，在调用点可见 |
| LLM 路由 | 云端目录声明 `max_output_tokens=8192`，低于 `SESSION_OUTPUT_MAX_TOKENS`，必须逐处夹住 session 上限 | `openai_runtime` 声明模型自己的上限，夹紧逻辑变成恒等式 |
| separator 加速 | 给 AOTI 缓存键加 batch、给分离器加云端采样率 | 云端不走 FineSub 的分离器；CPU 指令集那一维加在 `vocal_accel.package_dir` 里，落在上游键的下一级目录 |
| 共享资源预算 | `RAM_BUDGET_GB` 8→12 | 该常量只驱动一条 warning；云端靠分块把峰值锁在一个块上，不靠这个数字 |

`BASELINE_FILES.json` 固定未打补丁的上游文件哈希；契约测试会从当前 vendor 逆序撤销
整组补丁，核对上游基线，再正序重放并核对 `FILES.json`。因此测试不需要下载上游归档，
也不会加载 Torch 或模型。

补丁的应用必须绕开外层仓库：`git apply` 在仓库子目录里会给补丁路径加上前缀，然后
找不到目标、打印 `Skipped patch` 并返回 0——而暂存目录就在 `third_party/` 下。
`scripts/sync_finesub.py` 的 `git_apply_env()` 用 `GIT_CEILING_DIRECTORIES` 把向上搜索
截断在暂存目录的父目录；`git_apply_command()` 同时钉死 `core.autocrlf=false` 和
`core.eol=lf`（`.gitattributes` 的 `text=auto` 覆盖了前者，而 `third_party/finesub/** -text`
并不覆盖暂存目录）。改这两个函数之前先想清楚这两件事。

### 日常修改与交付流程

1. 直接修改 `third_party/finesub`，运行相关单元测试并完成调试。
2. 按上述功能边界生成或更新对应 patch，不把不相关模块混入同一补丁。
3. 更新 `FILES.json`，并在 `UPSTREAM.json` 中更新内容哈希、manifest 哈希和 patch 哈希。
4. 运行补丁栈测试：从当前 vendor 逆序撤销全部 patch 后必须等于
   `BASELINE_FILES.json`，再正序应用后必须等于当前 `FILES.json`。
5. 运行 local/cloud 策略测试和业务回归测试后再提交。

因此，“不能直接修改 vendor”不是开发限制；真正的交付约束是：

```text
固定上游基线 + 已登记 patch 栈 = 已提交 vendor
```

最低快速检查：

```bash
python -m pytest tests/test_split_stage_contract.py \
  tests/test_finesub_patch_stack.py \
  tests/test_resource_activation_retry.py \
  tests/test_vendor_contract.py -q
python scripts/sync_finesub.py check
```

## 7. 引擎包

一次同步只产出一份逻辑引擎：

```text
finesub-engine/<engine-version>+<short-commit>
```

它不是依赖公共 PyPI CLI 壳，而是从 vendor 源码和上游 lock 构建的 Finoka 私有运行时产物。

消费方式：

- 本地：sidecar/worker 的 `PYTHONPATH` 或隔离 runtime 指向该引擎目录。
- 云端：Docker 构建复制同一引擎目录并安装同一 lock。
- CI：在 CPU 环境跑轻量契约测试，在受控 GPU runner 跑少量端到端 fixture。

同一引擎在两边跑同一套代码，没有 profile 开关。云端与本地的差别只有三处，
每一处都在调用点可见，而不是藏在引擎内部的上下文变量里：

1. **人声分离**不走 FineSub 的分离器。云端有自己的 Vocal 容器（`vocal_policy` 的
   采样率阶梯、AOTI 装载判断、分块合并），只把 `subtitle-vocal.flac` 交回流水线。
   切块用 `src/finoka/vocal_blocks.py`——上游 `plan_separation_blocks` 的逐字符副本，
   因为那个镜像没有 torchaudio，import 不了 `separation`。
2. **纠错媒体固定 text**。两个中转都是纯 `/chat/completions`，没有地方挂音频。
   `reserve_cloud_task` 在受理时就把请求改写成 `media=text`，并同时记录申报值与
   生效值；其余每个 LLM 开关都按请求原样传下去。
3. **VAD 前缀与 Qwen 收尾跑在 CPU 容器上**，靠上面那份补丁提供的入口。计算结果与
   一次跑完完全相同，差别只是在哪台机器上算。

资源预算表属于共享引擎契约，两边同一份。

不要让本地从某个 commit 构建、云端却从 `main` 或 PyPI latest 安装。

## 8. 上游升级流程

上游发布新版本时，不在旧 vendor 上直接覆盖文件，也不机械解决所有 patch 冲突：

1. 锁定新的 tag 或 40 位 commit，下载官方 source archive 并校验 archive SHA-256。
2. 使用同步白名单生成未打补丁的新基线，同时更新 `BASELINE_FILES.json`。
3. 按编号顺序尝试应用现有 patch，并逐份分类处理：
   - 能干净应用：保留并重新验证语义。
   - 上游已有等价实现：删除对应 patch 或 hunk，改用上游接口。
   - 与新实现冲突：根据新代码重新实现并生成该层 patch，禁止自动三方合并后直接接受。
4. 如果上游已经能把 VAD 前缀和 Qwen 收尾分步跑，删掉那份补丁，改调上游接口。
5. 从新基线应用完整 patch 栈，生成新的 vendor，再更新 `FILES.json`、`UPSTREAM.json`、
   commit、archive SHA、内容 SHA 和各 patch SHA。
6. 运行补丁栈正反向测试、local/cloud 回归、artifact 契约测试和 engine bundle 构建。

升级完成后的关系必须是：

```text
新版上游基线 + 迁移后的 patch 栈 = 新版 vendor
```

`BASELINE_FILES.json` 与 `UPSTREAM.json` 必须在同一次升级中更新，不能让新版 vendor
继续引用旧版本基线。

## 9. 升级检查表

每次 FineSub 升级至少检查：

- `run_pipeline` 参数是否变化。
- `Reporter` 协议是否变化。
- `stable.json` segment/word schema 是否变化。
- `*-annotated.csv` 列、位置映射和置信度是否变化。
- 最终 SRT 后处理是否改变条数或时轴关系。
- `TaskRequest` 默认值是否变化。
- 任务目录、可续跑 artifact 和清理规则是否变化。
- patched CTranslate2 下载地址和标签是否变化。
- Python、Torch、CUDA 和模型依赖锁是否变化。
- Prompt 许可证目录是否新增文件。
- separator 分块算法是否变化。`src/finoka/vocal_blocks.py` 是它的逐字符副本，
  云端 Vocal worker 用它切块——那台镜像没有 torchaudio，import 不了 `separation`。
  `tests/test_separator_block_plan.py` 会在上游改动时报红，照它说的重新复制即可；
  不要为此改 vendor：该函数目前不被任何 patch 触碰。

## 10. 契约测试门槛

同步完成必须通过：

1. Engine import smoke test。
2. 运行时 manifest 与 lock 一致性测试。
3. 纯 fixture Projector 测试。
4. 中断/继续任务状态测试。
5. 本地 Provider 与 mock Cloud Provider 的协议一致性测试。
6. 一个短媒体 GPU 端到端测试：至少产出 stable、annotated、final SRT 和 EditDocument。
7. 同一 engine bundle 在本地 worker 与云端容器得到兼容 artifact schema。

质量或格式变化可以有意接受，但必须在升级 PR 中展示并更新 fixture；不能静默漂移。
