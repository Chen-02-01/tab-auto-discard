# Tab Auto Discard

# 主界面
<img width="437" height="739" alt="image" src="https://github.com/user-attachments/assets/3a15410f-3c57-4e89-9da9-872a531f5698" />
<img width="1107" height="1001" alt="image" src="https://github.com/user-attachments/assets/1bce8e8b-4d98-47ad-9d65-59768bbc253e" />


一个面向 Chrome 99 的轻量扩展：

- 后台标签页超过设定时间未再次查看时，自动执行 `discard`
- 点击被丢弃的标签页时，由浏览器自动重新加载
- 支持站点排除列表
- 支持跳过固定标签页
- 支持跳过正在播放声音的标签页

## 目录说明

- `manifest.json`: 扩展清单
- `background.js`: 定时扫描、记录最近查看时间、自动丢弃
- `rules.js`: 排除规则解析与匹配
- `popup.html`: 快速设置与当前站点排除
- `options.html`: 完整设置页

## 安装方式

1. 打开 `chrome://extensions/`
2. 打开“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择当前目录下的 `tab-auto-discard`

## 排除规则格式

- `example.com`: 匹配 `example.com` 及其子域名
- `*.example.com`: 只匹配子域名
- `*://mail.example.com/*`: 按完整 URL 通配

## 当前实现说明

- 扫描周期为 1 分钟，兼容 Chrome 99 的 `chrome.alarms`
- 为了兼容 Chrome 99，没有依赖较新的 `tab.lastAccessed`
- 排除站点会同时设为 `autoDiscardable: false`，尽量避免被浏览器自身的内存回收策略丢弃
