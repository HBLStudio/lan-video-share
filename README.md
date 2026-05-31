# LAN Video Share

把 Windows 上指定目录里的视频通过局域网 Web 地址共享出去，手机、平板、电脑都可以用浏览器访问、查看和播放。

## 使用方法

1. 安装 Node.js 18 或更新版本。
2. 在本项目目录运行：

```powershell
npm start -- "D:\Videos"
```

也可以指定端口：

```powershell
npm start -- "D:\Videos" --port 8080
```

启动后终端会显示类似地址：

```text
Local:   http://localhost:8080
Network: http://192.168.1.23:8080
```

让 iPhone 和电脑连接同一个 Wi-Fi，然后在 iPhone Safari 打开 `Network` 地址即可。

## 可选访问口令

如果只是家庭局域网可以不设置。需要简单限制访问时：

```powershell
$env:SHARE_TOKEN="123456"
npm start -- "D:\Videos"
```

访问时使用：

```text
http://192.168.1.23:8080/?token=123456
```

## 支持的视频格式

默认会显示：`.mp4`、`.m4v`、`.mov`、`.webm`、`.mkv`、`.avi`、`.wmv`、`.flv`、`.ts`、`.m3u8`。

iPhone Safari 对 `.mp4`、`.m4v`、`.mov` 支持最好；`.mkv`、`.avi` 等格式可能能列出来，但浏览器不一定能直接播放。

## 手机操作

- 点视频卡片即可播放。
- 播放结束会自动切到下一个视频。
- “全屏播放”会在未选择视频时先播放列表第一个视频，再按视频宽高尝试锁定横屏或竖屏。iPhone Safari 不允许网页强制锁屏方向，所以需要手动旋转兜底。
- 会在本机浏览器里记住播放进度，下次打开同一个视频会自动从上次位置前几秒继续。
- 看完 90% 以上或播放结束的视频会标记为“已看”，并排到列表后面。
- 可以收藏和拉黑视频；收藏优先显示，拉黑默认隐藏，可用“显示拉黑”恢复。收藏和拉黑保存在服务端本地 `data/preferences.json`，同一个局域网服务下多台设备共享。
- 视频列表会懒加载预览图；长按视频卡片会从视频中段播放静音短预览，松手停止。
- Supports PWA install: add the page to the phone home screen to open it like a standalone app. The service worker caches only the app shell, not videos or API data.

## 注意事项

- 这个服务适合在可信局域网内使用，不建议直接暴露到公网。
- 播放进度和已看状态仍保存在每台设备自己的浏览器里；收藏和拉黑状态保存在服务端本地 `data/preferences.json`，`data/` 默认不提交到 Git。
- Windows 防火墙可能会询问是否允许 Node.js 通过网络，允许后其他设备才能访问。
- 视频播放和拖动进度条依赖 HTTP Range 请求，本项目已支持。
