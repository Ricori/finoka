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
- `ui.openPluginManager`：返回插件管理页面。
- `media.list`：需要 `media.list` 权限，返回媒体 ID、标题、时长、画面尺寸和字幕状态，不返回本地路径。
- `ffmpeg.extractAudio`：需要 `ffmpeg.extract-audio` 权限。参数为 `{ mediaId, format }`，其中格式只能是 `wav`、`flac`、`mp3` 或 `m4a`。Finoka 负责解析输入、选择输出位置、构造 FFmpeg 参数和原子发布结果。
- `tools.runYtDLP`：需要 `tools.yt-dlp` 和 `media.import` 权限。插件传入 `{ url, args }`，自行决定受支持的 yt-dlp 参数；Finoka 解析项目托管的 yt-dlp/FFmpeg、让用户选择输出位置，并在命令成功后自动导入媒体库。yt-dlp 以 Python wheel 形式安装，因此该能力同时依赖 Finoka 的 Python 运行时。

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

API v1 暂不执行插件原生进程，也不开放任意 FFmpeg 参数、媒体路径或字幕文档写入。后续 Runtime API 会沿用同一 manifest 和安装生命周期，以独立进程 JSON-RPC 接入；在权限、任务取消、临时目录和输出 artifact 契约稳定之前，不应让插件直接取得任意 Wails service。

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
