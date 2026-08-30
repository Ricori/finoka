# Finoka 插件开发（API v1）

Finoka 插件在主页左侧的“工具”分组中贡献入口。插件代码、持久数据和缓存相互分离，因此插件可以独立启用、停用、升级和卸载。

## 插件包

`.finoka-plugin` 是一个 ZIP 文件，根目录必须包含 `finoka-plugin.json`。manifest 和所有页面都必须位于压缩包根目录之下；绝对路径、`..`、符号链接和重复文件会被拒绝。

```text
example.finoka-plugin
├─ finoka-plugin.json
└─ ui/
   └─ index.html
```

最小 manifest：

```json
{
  "id": "com.example.subtitle-tools",
  "name": "字幕工具",
  "version": "1.0.0",
  "apiVersion": 1,
  "permissions": ["media.list", "ffmpeg.extract-audio"],
  "contributes": {
    "tools": [
      {
        "id": "cleanup",
        "title": "字幕清理",
        "page": "ui/index.html",
        "order": 100
      }
    ]
  }
}
```

- `id` 和工具 `id` 只能使用小写字母、数字、点、横线和下划线。
- `version` 使用 SemVer。
- 当前仅支持 `apiVersion: 1`。
- `page` 必须是包内相对路径，并以 `.html` 结尾。
- 同一个插件可以贡献多个工具入口。
- `permissions` 只允许列出当前 API 版本认识的宿主能力，未知权限会阻止安装。

API v1 认识的权限：

| 权限 | 能力 |
| --- | --- |
| `media.list` | 列出媒体（ID、标题、时长、尺寸、字幕状态） |
| `media.import` | 把宿主下载到的文件导入媒体库 |
| `media.export-video` | 压制字幕导出 MP4 |
| `document.read` | 读取字幕文档、生成 ASS/SRT |
| `document.write` | 写回字幕文档（带 rev 乐观锁） |
| `subtitle.export` | 通过保存对话框导出字幕文件 |
| `ffmpeg.extract-audio` | 用托管 FFmpeg 导出音频 |
| `tools.yt-dlp` | 执行受控的 yt-dlp 命令 |

权限只在 manifest 里声明，安装时展示在插件管理页；每次调用由 Go 侧再校验一次，停用的插件调用任何能力都会被拒绝。

开发时也可以调用 Go service 的 `Install(path)` 安装未打包目录；桌面 UI 只选择 `.finoka-plugin` 文件。

PowerShell 打包示例：

```powershell
Compress-Archive -Path .\hello-tool\* -DestinationPath .\hello-tool.zip
Rename-Item .\hello-tool.zip hello-tool.finoka-plugin
```

## 页面隔离

工具页面通过 `<iframe sandbox="allow-scripts">` 加载，没有同源权限，也不能访问 Wails bindings。API v1 页面必须是自包含 HTML：CSS 和 JavaScript 应内联，图片可使用 `data:` 或 `blob:`。宿主会注入 CSP，默认禁用网络、外部脚本和本地文件访问。

宿主注入：

```js
window.finoka.post("host.getInfo", {});
```

插件向宿主发送的消息格式：

```json
{
  "source": "finoka-plugin",
  "apiVersion": 1,
  "method": "host.getInfo",
  "params": {}
}
```

宿主目前实现：

- `host.getInfo`：返回主题、locale、插件 ID 和工具 ID。
- `ui.openPluginManager` / `ui.openLibrary` / `ui.openRuntime`：切到对应的宿主页面，无返回值。
- `media.list`：需要 `media.list` 权限，返回媒体 ID、标题、时长、画面尺寸和字幕状态，不返回本地路径。
- `document.read`：需要 `document.read` 权限。参数 `{ mediaId }`，返回该媒体的字幕文档（`rev`、`subtitles`、`tracks`、`track_meta` 等，即编辑器打开的那一份）。
- `document.save`：需要 `document.write` 权限。参数 `{ mediaId, document }`，宿主只取 `rev`、`subtitles`、`tracks`、`track_meta`、`title` 五个字段写回，返回保存后的文档。
- `subtitle.ass` / `subtitle.srt`：需要 `document.read` 权限。参数 `{ mediaId, t0?, t1?, lang? }`，返回 `{ text, rev }`。字幕由宿主用编辑器那条拼装管线现拼，因此与编辑器导出的逐字相同；给了 `t0`/`t1` 就裁成区间并把时间轴平移到 0，`lang` 只对 SRT 有效（`both` / `zh` / `ja`）。
- `subtitle.save`：需要 `subtitle.export` 权限。参数 `{ fileName, content }`，宿主弹保存对话框并落盘，返回最终路径；用户取消时返回空串。扩展名只接受 `.ass` 和 `.srt`，目录由对话框决定。
- `media.exportVideo`：需要 `media.export-video` 权限。参数 `{ mediaId, ass, fileName?, t0?, t1?, height? }`，宿主用托管的 FFmpeg 把 ASS 压制进视频，返回 `{ path, format, size }`。编码参数（CRF 21、preset medium、AAC 192k）由宿主固定，`height` 只能是 0（原分辨率）或 240–4320。压制期间宿主会向页面推送 `media.progress` 消息（`{ done, total }`，单位秒）。
- `ffmpeg.extractAudio`：需要 `ffmpeg.extract-audio` 权限。参数为 `{ mediaId, format }`，其中格式只能是 `wav`、`flac`、`mp3` 或 `m4a`。Finoka 负责解析输入、选择输出位置、构造 FFmpeg 参数和原子发布结果。
- `tools.runYtDLP`：需要 `tools.yt-dlp` 和 `media.import` 权限。插件传入 `{ url, args }`，自行决定受支持的 yt-dlp 参数；Finoka 解析项目托管的 yt-dlp/FFmpeg、让用户选择输出位置，并在命令成功后自动导入媒体库。yt-dlp 以 Python wheel 形式安装，因此该能力同时依赖 Finoka 的 Python 运行时。

字幕文档能力有几条固定规则：

- 媒体一律用 `media.list` 给的 ID 定位，插件永远拿不到本地路径；字幕文档由本地 Provider 提供，sidecar 没起来时这些调用会失败而不是读到半份文档。
- `document.save` 必须带上读到的 `rev`。编辑器同时保存过同一份文档时 rev 已经前进，宿主返回 `revision_conflict`，插件应重新读一次再改。
- 宿主会校验句子形状（`t0`/`t1` 有限且 `t1 >= t0`，`ja`/`zh` 是文本），但不认识的字段（词级时间、置信度）原样带过去，因此「读—改—写」不会丢数据。
- `subtitle.save` 与 `media.exportVideo` 的落盘位置永远由保存对话框决定，插件给的文件名只当默认值用，路径部分会被剥掉。

`tools.runYtDLP` 当前只接受公开的 YouTube、youtu.be 和 Twitch HTTPS 地址，并且只允许以下参数：

- `--no-playlist`、`--newline`、`--embed-metadata`
- `-f` / `--format`：最佳、最高 1080p、最高 720p 三种预定义 selector
- `--merge-output-format mp4`、`--remux-video mp4`
- `-N` / `--concurrent-fragments`：`1`、`2`、`4` 或 `8`

输出参数、FFmpeg 路径和 URL 由宿主追加。`--exec`、Cookie、配置文件、外部下载器和任意输出路径等参数会被拒绝。

带返回值的调用应传入请求 ID：

```js
window.finoka.post("media.list", {}, "request-1");

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.source !== "finoka-host" || message.method !== "rpc.result") return;
  if (message.id === "request-1") console.log(message.result, message.error);
});
```

API v1 暂不执行插件原生进程，也不开放任意 FFmpeg 参数或媒体路径。后续 Runtime API 会沿用同一 manifest 和安装生命周期，以独立进程 JSON-RPC 接入；在权限、任务取消、临时目录和输出 artifact 契约稳定之前，不应让插件直接取得任意 Wails service。

## 安装布局和生命周期

```text
FinokaData/
├─ plugins/<id>/current.json
├─ plugins/<id>/versions/<version>/
├─ plugin-data/<id>/
└─ plugin-registry.json
```

- 安装先解压到 staging，完整校验后再原子发布。
- 安装新版本通过 `current.json` 切换活动版本。
- 停用只隐藏菜单入口，代码和数据仍保留。
- 卸载可以选择保留或删除 `plugin-data/<id>`。
- 插件变化通过 `plugins:changed` 事件同步到所有前端状态。

可运行示例：

- `desktop/examples/plugins/hello-tool`：最小 UI、媒体列表与 FFmpeg 音频导出。
- `desktop/examples/plugins/video-downloader`：插件自行组织 yt-dlp 参数，下载公开的 YouTube/Twitch 视频并自动导入媒体库。
- `desktop/examples/plugins/subtitle-studio`：读取字幕文档、批量替换后带 rev 写回，导出 ASS/SRT 并压制视频。
