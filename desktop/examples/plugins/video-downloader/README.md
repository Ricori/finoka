# 视频下载 Demo

下载公开的 YouTube / Twitch 视频，完成后自动导入 Finoka 媒体库。这是内置「视频下载」插件的同源示例：页面代码与内置版本一致，只有 manifest 的 id、名称和发布者不同。

它演示的是一个长任务插件需要处理的全部环节：

- 用 `tools.runYtDLP` 组织受控的 yt-dlp 参数
- 实时进度条与 yt-dlp 日志
- 中途取消
- 保存 YouTube 登录 Cookie，以及在页面被销毁后重新接管正在进行的任务

## 运行要求

先在 Finoka 的「运行环境」里安装 **FFmpeg**，以及「视频下载工具」分组（yt-dlp、aria2c、Node.js、PO Token 生成器）。

不装 PO Token 相关组件也能用，但 YouTube 只对携带 PO token 的请求返回可用格式，实际表现是**短视频能下完、稍长的会中途 403 失败**。文档 [PLUGINS.md](../../../docs/PLUGINS.md) 的「YouTube 的四道门禁」一节解释了为什么这几样缺一不可。

## 打包

在此目录执行：

```powershell
Compress-Archive -Path .\finoka-plugin.json,.\ui -DestinationPath .\video-downloader.zip
Rename-Item .\video-downloader.zip video-downloader.finoka-plugin
```

然后在 Finoka 左侧「工具 → 插件管理」选择生成的 `.finoka-plugin` 文件。

## 用到的宿主能力

| 方法 | 权限 | 用途 |
| --- | --- | --- |
| `tools.runYtDLP` | `tools.yt-dlp` + `media.import` | 下载并导入媒体库 |
| `downloader.cancel` | `tools.yt-dlp` | 结束正在跑的下载 |
| `downloader.log` / `downloader.clearLog` | `tools.yt-dlp` | 取回、清空宿主留存的日志 |
| `downloader.settings` | `tools.cookies` | 查询 Cookie 状态、还缺哪些工具、是否有任务在跑 |
| `downloader.saveCookies` / `downloader.clearCookies` | `tools.cookies` | 保存、清除登录 Cookie |

Cookie 是**只写**的：页面能保存、清除、查询「配没配、几条」，但永远读不回来。每个插件的 jar 存在自己的 `plugin-data/<id>/` 下，互相不可见。

## 值得抄的两个点

**下载状态归宿主管。** 插件页是 iframe，用户切走页面就会被销毁，页面自己的状态一点都留不下。所以：

- 挂载时用 `downloader.settings` 的 `downloadRunning` 判断是否要接管进度条、禁用下载按钮
- 挂载时用 `downloader.log` 把这一轮已经发生的日志补回来 —— 事件只能带来「此刻之后」的内容

**清空要清到宿主。** 「清除日志」同时清掉宿主留存的缓冲；只清 DOM 的话，下次切走再回来日志会原样回来。
