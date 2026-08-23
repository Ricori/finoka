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

`third_party/finesub` 中除 `README.md` 外的同步文件全部由脚本生成，禁止直接修改。

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

- 不直接修改 vendor 文件。
- 每份 patch 必须说明原因、对应上游 issue/PR、预期删除条件。
- 每份 patch 必须有 Finoka 契约测试。
- 同步新版本时 patch 无法干净应用就立即失败，不自动三方合并。
- Prompt 修改必须单独记录，因为该目录使用 CC BY-SA 4.0。

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

不要让本地从某个 commit 构建、云端却从 `main` 或 PyPI latest 安装。

## 8. 升级检查表

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

## 9. 契约测试门槛

同步完成必须通过：

1. Engine import smoke test。
2. 运行时 manifest 与 lock 一致性测试。
3. 纯 fixture Projector 测试。
4. 中断/继续任务状态测试。
5. 本地 Provider 与 mock Cloud Provider 的协议一致性测试。
6. 一个短媒体 GPU 端到端测试：至少产出 stable、annotated、final SRT 和 EditDocument。
7. 同一 engine bundle 在本地 worker 与云端容器得到兼容 artifact schema。

质量或格式变化可以有意接受，但必须在升级 PR 中展示并更新 fixture；不能静默漂移。
