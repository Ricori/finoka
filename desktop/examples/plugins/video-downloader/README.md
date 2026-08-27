# YouTube / Twitch 下载器 Demo

这个插件演示由插件自行组织 yt-dlp 命令参数，同时复用 Finoka 托管的 yt-dlp、FFmpeg、保存对话框和媒体库导入能力。

## 运行要求

先在 Finoka 的“运行环境”页面安装：

- FFmpeg
- 可选工具 yt-dlp

Demo 支持公开的 YouTube 视频、Twitch VOD 和 Twitch Clips。它不读取浏览器 Cookie，也不支持会员、订阅者限定或其他需要账户认证的内容。

## 打包

在此目录执行：

```powershell
Compress-Archive -Path .\finoka-plugin.json,.\ui -DestinationPath .\video-downloader.zip
Rename-Item .\video-downloader.zip video-downloader.finoka-plugin
```

然后在 Finoka 左侧“工具 → 插件管理”选择生成的 `.finoka-plugin` 文件。

## 调用协议

页面构造参数：

```js
window.finoka.post("tools.runYtDLP", {
  url: "https://www.youtube.com/watch?v=example",
  args: [
    "-f", "bv*[height<=1080]+ba/b[height<=1080]",
    "--merge-output-format", "mp4",
    "--remux-video", "mp4",
    "-N", "4"
  ]
}, "download-1");
```

Finoka 会追加 `--no-playlist`、`--ffmpeg-location`、MP4 输出约束、`-o` 和经过白名单验证的 URL。下载成功后宿主自动调用媒体库导入，并通过 `rpc.result` 返回新媒体的 ID、标题、时长和尺寸。
