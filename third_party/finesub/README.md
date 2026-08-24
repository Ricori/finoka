# FineSub vendor directory

此目录保存由 `scripts/sync_finesub.py` 生成的 FineSub 引擎快照。

规则：

- 不要手工复制或修改 `src/finesub`。
- 不要把机器上安装的 `site-packages/finesub` 复制到这里。
- 只接受来自 FineSub 官方仓库固定 tag/commit 的 source archive。
- 每次同步必须生成并校验 `UPSTREAM.json` 与 `FILES.json`。
- 必要补丁放在仓库外部的 `patches/finesub`，由同步器应用。
- 本地 runtime 和云端镜像必须使用同一 `engine_bundle_id`。

上游原始说明保存在 `UPSTREAM_README.md`。具体流程见
[FineSub 同步与升级策略](../../docs/finesub-sync.md)。
