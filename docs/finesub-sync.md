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

当前补丁按可独立审查和失败定位的边界拆分为：execution profile 核心、LLM 路由、
VAD/Qwen 生命周期、separator 加速、共享资源预算。`BASELINE_FILES.json` 固定未打补丁
的上游文件哈希；契约测试会从当前 vendor 逆序撤销整组补丁，核对上游基线，再正序
重放并核对 `FILES.json`。因此测试不需要下载上游归档，也不会加载 Torch 或模型。

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
python -m pytest tests/test_execution_profile.py \
  tests/test_finesub_patch_stack.py \
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

同一引擎通过显式 `execution_profile` 区分运行策略：本地 worker 必须传
`local`，保持固定上游版本的默认调用路径；云端容器必须传 `cloud`，才允许启用
16 kHz cost vocal、路由输出裁剪、Linux AOTI、CPU int8、prepared VAD 和拆分
Qwen 收尾。禁止通过平台探测隐式切换。资源预算表属于共享引擎契约，不随 profile
分叉。

不要让本地从某个 commit 构建、云端却从 `main` 或 PyPI latest 安装。

## 8. 上游升级流程

上游发布新版本时，不在旧 vendor 上直接覆盖文件，也不机械解决所有 patch 冲突：

1. 锁定新的 tag 或 40 位 commit，下载官方 source archive 并校验 archive SHA-256。
2. 使用同步白名单生成未打补丁的新基线，同时更新 `BASELINE_FILES.json`。
3. 按编号顺序尝试应用现有 patch，并逐份分类处理：
   - 能干净应用：保留并重新验证语义。
   - 上游已有等价实现：删除对应 patch 或 hunk，改用上游接口。
   - 与新实现冲突：根据新代码重新实现并生成该层 patch，禁止自动三方合并后直接接受。
4. 让新版 local profile 跟随新版上游默认流程；仅保留仍有必要的 cloud 条件分支。
5. 单独复核无条件生效的 `resources.py`，明确采用新版上游预算还是继续维护共享资源 patch。
6. 从新基线应用完整 patch 栈，生成新的 vendor，再更新 `FILES.json`、`UPSTREAM.json`、
   commit、archive SHA、内容 SHA 和各 patch SHA。
7. 运行补丁栈正反向测试、local/cloud 回归、artifact 契约测试和 engine bundle 构建。

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
