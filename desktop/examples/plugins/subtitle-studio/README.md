# 字幕工作台 Demo

这个插件演示 API v1 的字幕文档能力：读取一份字幕文档、批量替换文本后带 rev 写回、拿到与编辑器逐字相同的 ASS/SRT，再用宿主的 FFmpeg 把字幕压制进视频。

## 运行要求

- 媒体库里至少有一个已经跑出字幕文档的视频（列表里只列 `documentAvailable` 的条目）。
- 字幕文档由本地 Provider（sidecar）提供，所以需要 Finoka 的 Python 运行时已就绪。
- 压制视频需要在“运行环境”里装好 FFmpeg。

## 申请的权限

| 权限 | 用途 |
| --- | --- |
| `media.list` | 列出媒体，拿到 mediaId 和字幕文档状态 |
| `document.read` | 读取字幕文档、生成 ASS/SRT |
| `document.write` | 把替换结果写回字幕文档 |
| `subtitle.export` | 通过保存对话框导出 `.ass` / `.srt` |
| `media.export-video` | 压制字幕导出 MP4 |

## 打包

在此目录执行：

```powershell
Compress-Archive -Path .\finoka-plugin.json,.\ui -DestinationPath .\subtitle-studio.zip
Rename-Item .\subtitle-studio.zip subtitle-studio.finoka-plugin
```

然后在 Finoka 左侧“工具 → 插件管理”选择生成的 `.finoka-plugin` 文件。

## 写回的乐观锁

`document.save` 必须带上读文档时拿到的 `rev`。编辑器在这期间保存过同一份文档时，rev 已经前进，宿主会返回 `revision_conflict` 而不是覆盖——插件应当重新 `document.read` 再做一次替换。
