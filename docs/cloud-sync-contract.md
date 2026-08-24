# 云端登录、媒体库与字幕同步协议

## 1. 身份与配额

- 桌面端使用业务 Key 登录，HTTP 请求使用 `Authorization: Bearer <key>`。
- 桌面端默认连接已部署的 `https://ricori--finoka-cloud-api.modal.run`，开发时可以覆盖地址。
- Renderer 不读取已保存的 Key；登录、持久化和后续请求由 Go 主进程完成。
- Modal Dict 使用 Key 的 SHA-256 标识作为索引，同时保存明文供管理员 Key 管理页面展示。
  旧版本创建且尚未重新保存的 Key 只有哈希，无法恢复原始明文。
- `ADMIN_TOKEN` 也可作为业务 Key 登录；管理员的 session 余量为 `null`，媒体库、任务列表、
  任务详情与字幕产物接口可查看或操作所有 Key 的视频，且管理员提交任务不扣配额、不受单 Key
  并发限制。普通 Key 仍只可访问自己的 `video_ids`。
- 管理员向 `POST /v1/admin/keys` 提交名称、自定义 Key 与 `remaining`；管理列表会返回完整 Key。
- `remaining` 只在创建新的云端 FineSub 转写任务时扣减一次。
- 同一个 Key 同时最多运行一个云端转写任务。
- 本机完成的字幕上传属于同步，不消耗云端转写次数。

## 2. 媒体库合并

登录后，桌面端同时读取本地 `library.json` 与云端 `/v1/library`。前端按媒体指纹生成
合并视图，但不回写成一份混合记录：匹配的本地卡片显示云端同步状态；只有云端记录而
没有本地源文件时，显示“需要重新定位本地视频”。云端永远不保存客户端绝对路径。

登录或恢复已保存会话时，Go 云端服务还会扫描本地已有 FineSub 文档。云端缺少对应
指纹时只补同步字幕产物；云端已有同指纹记录时跳过，保证会话恢复幂等。补同步继续执行
任务目录边界、产物白名单和 32 MB 总量限制，不上传原视频，也不扣云端转写次数。

## 3. 本地任务自动同步

Local Provider 完成任务并返回 `ArtifactManifest` 后，Go 云端服务：

1. 用固定任务 API 重新取得 manifest。
2. 只接受 `file://` URI，且解析后的文件必须位于 Finoka `tasks/` 下。
3. 只读取 `stable_json`、`raw_srt`、`annotated_csv`、`final_srt`，总计不超过 32 MB。
4. 向 `/v1/library/sync` 上传字幕文本、引擎 commit 和媒体指纹。
5. 服务端按同一 Key 内的指纹覆盖同步版本或创建新记录，不扣配额。

原视频、音频、缩略图和本机路径均不进入这条同步请求。

## 4. 云端 FineSub 限制

- 输入必须是客户端提取并上传的纯音频对象。
- 单个音频最长 2 小时。
- GPU 上的识别仍使用上传音频；纠错与翻译只接收识别文本，服务端固定
  `correction.media=text`。
- 服务端固定 `correction.retrieval=none`，不运行本地网页检索或模型原生网页搜索。
- 视频多模态请求返回 400；旧客户端的 `media=audio` 会兼容归一化为 `text`。
- GPU worker 直接调用仓库固定版本的 `finesub.pipeline.run_pipeline`，不保留旧版算法。
- 云端通过 FineSub 原生 `openai_compat` transport 调用 `gpt-5.6-luna`，不再绑定 Gemini。
- 复用旧 VOD 的两套中转与 Secret：`gz-llm/GZ_LLM_API_KEY` 对应
  `https://gpt-agent.cc/v1`（主），`anthropic/ANTHROPIC_API_KEY` 对应
  `https://codeyu.shop/v1`（备用）。不创建 `finoka-finesub-keys` 或其他 LLM Secret。
- 管理、Hugging Face 与 R2 同样复用 `yt-admin`、`huggingface`、`r2`。
- 云端不使用或上传用户的本地 FineSub Key。

## 5. Modal API

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/v1/session` | 验证 Key，返回余量与进行中数量 |
| GET | `/v1/library` | 返回当前 Key 的云端视频库；管理员返回所有 Key 的视频 |
| POST | `/v1/library/sync` | 保存本机 FineSub 字幕产物 |
| DELETE | `/v1/library/{video_id}` | 删除有权限访问且未在运行的云端字幕、任务记录与产物 |
| POST | `/v1/uploads/init` | 创建音频 Presigned PUT |
| POST | `/v1/tasks` | 校验限制、扣减次数并启动 FineSub worker |
| GET | `/v1/tasks?limit={n}` | 返回当前 Key 的云端任务快照；管理员返回所有 Key 的任务 |
| GET | `/v1/tasks/{id}` | 查询当前 Key 所属任务；管理员可查询任意任务 |
| GET | `/v1/tasks/{id}/events?after={cursor}` | 增量读取阶段、进度和调试事件 |
| POST | `/v1/tasks/{id}/cancel` | 停止当前 Modal 调用并保留断点 |
| POST | `/v1/tasks/{id}/resume` | 从失败、取消或中断状态继续，不重复扣次 |
| POST | `/v1/tasks/{id}/retry` | 与 `resume` 相同的兼容入口 |
| GET | `/v1/admin/keys` | 管理员列出 Key 的名称、完整密钥、余量与任务统计 |
| POST | `/v1/admin/keys` | 管理员用名称、自定义 Key 和绝对余量创建 Key |
| PUT | `/v1/admin/keys/{key_id}` | 管理员修改 Key 名称与绝对余量 |
| DELETE | `/v1/admin/keys/{key_id}` | 管理员吊销 Key；不删除已有视频 |

API 部署最多使用 2 个容器，每个容器允许 20 个并发请求。GPU Worker 通过固定任务目录、
FineSub `resume=True`、Volume `reload/commit` 和任务级 `run_id` 实现跨容器续跑；LLM 阶段从
FineSub 原生窗口与会话 checkpoint 生成心跳进度。关键阶段日志写入 Modal 标准日志和事件流，
不进入桌面端日志界面。

## 6. Patched CTranslate2 构建

FineSub `0.4.1` 固定快照要求带 WT-refine 补丁的 CTranslate2。补丁源码已从旧仓库迁至
`modal_backend/ct2_patches/`，固定上游基线为 `v4.8.1 / 0d8bcd3`。Modal GPU 镜像直接应用
11 个补丁并编译 Linux CUDA wheel，不再依赖未发布的外部 wheel URL；构建末尾必须通过
`return_refine_paths` 接口检查。真实 Modal GPU→CPU 媒体流水线、取消续跑与字幕产物验收已通过。
