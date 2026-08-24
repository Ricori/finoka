# 迁移状态

更新日期：2026-08-24

| 阶段 | 状态 | 已落地 | 尚未完成 |
| --- | --- | --- | --- |
| 0 仓库基线 | 完成 | 架构/ADR/迁移文档、GPL-3.0 规则、CI | 发布版本规则随桌面壳确定 |
| 1 FineSub 引擎 | 完成 | 固定 `v0.4.1` 同步、来源/文件/许可证清单、可复现 bundle、离线校验、Windows 全新缓存 CI | 无代码项 |
| 2 Local Provider | 代码完成 | headless sidecar、loopback token、隔离 worker、持久事件、取消/继续、稳定错误码、分环节检测、FineSub 原生 Key、原生 runtime/model bootstrap | Windows NVIDIA 真机完整媒体验收 |
| 3 Projector/文档 | 完成 | stable/final fixture 投影、严格行数校验、words/low confidence、rev/history/original、peaks、任务完成自动投影 | 真媒体质量验收随 GPU 演练执行 |
| 4 Wails/React | 代码完成 | 可折叠侧边栏、页面/组件/CSS 分层、环境诊断、逐项 Key 设置、原生偏好与窗口状态、登录/合并库/自动同步、旧 Nonoka 视频库迁移、任务恢复、编辑器、JASSUB、SRT/ASS/视频导出 | Windows 安装包视觉/快捷键验收 |
| 5 Cloud Provider | 已部署并验收 | 独立 `modal_backend`、哈希 Key、次数/并发、字幕 Volume、R2 音频与中止、任务发现、FineSub GPU worker、OpenAI 兼容纯文本纠错/翻译、禁用网页搜索、CT2 补丁构建、事件/取消/恢复/产物 | 长时媒体与 Modal 抢占专项压测 |
| 6 双模式产品化 | 端到端完成 | Provider 切换、纯音频提取上传、持久任务列表、进度/取消/结果下载与 SHA-256、本机字幕自动同步、服务端云端限制；真实 Modal GPU→CPU 任务已通过 | Windows NVIDIA 本地链路真机验收 |

## 当前验证

- `python3 scripts/sync_finesub.py check`
- `python3 -m pytest -q`
- `python3 -m scripts.build_finesub_bundle`
- `cd desktop && go test ./...`
- `cd desktop/frontend && npm run typecheck && npm test && npm run build`
- `PYTHONPATH=modal_backend python3 -m pytest -q modal_backend/tests`
- `python3 scripts/modal_e2e.py --repetitions 2 --timeout-minutes 40`

2026-08-24 的真实云端验收使用 20.7 秒合成日语音频，验证了 R2 上传、任务发现、GPU
进度、取消/恢复且不重复扣次、CPU LLM 尾段、四类字幕产物、事件流、媒体库写入与测试数据清理。

Loopback HTTP 鉴权测试在允许本地监听的环境执行；受限沙箱会跳过 socket 部分，但仍执行
恒定时间 token 校验单测。
