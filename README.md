# Modern TODO Desktop

本地优先的现代 TODO 桌面应用。前端使用 React + TypeScript，桌面壳使用 Tauri，数据存储在本机 SQLite。

## 功能

- 任务增删改查
- 无限层级子任务
- 父子任务完成状态联动
- 周任务、月任务规划
- 周/月完成率、未完成数、逾期数统计
- 周/月手写归纳总结
- 自定义无边框桌面窗口

## 开发命令

```bash
npm install
npm run dev
npm test
npm run build
npm run tauri dev
```

## 一键打包

Windows release 打包：

```bash
npm run package:win
```

Windows debug 打包：

```bash
npm run package:win:debug
```

输出目录：

- `src-tauri/target/release/bundle/nsis`
- `src-tauri/target/debug/bundle/nsis`

## 数据目录

运行时数据固定存储在用户 Home 目录下：

```text
~/.modern-todo/todo.sqlite
```

Windows 示例：

```text
C:\Users\<username>\.modern-todo\todo.sqlite
```

如果旧版本曾经把数据库创建在 Tauri 默认 AppData 目录，新版本第一次启动时会在目标文件不存在的前提下复制旧数据库到 `~/.modern-todo/todo.sqlite`。

## 文档

- [离线分发与更新说明](docs/distribution.md)
- [工程目录结构](docs/project-structure.md)

## GitHub 发布更新

配置 GitHub Actions Secrets 后，推送 `v0.1.1` 这类 tag 会自动构建 Windows 安装包、生成 Tauri updater artifacts，并上传 `latest.json` 到 GitHub Release。

生成 updater 签名密钥：

```bash
npm run updater:secrets
```

应用内的“检查更新”会在在线时读取 GitHub Release 的 `latest.json`；离线时会跳过更新检查。
