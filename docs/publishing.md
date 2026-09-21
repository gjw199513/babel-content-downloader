# 0.1.26 发布操作清单

本页记录 GitHub 首次发布流程。公开仓库为 [gjw199513/babel-content-downloader](https://github.com/gjw199513/babel-content-downloader)；首版通过 GitHub Release 分发，不要求先发布到 npm 或浏览器商店。

## 仓库内容

将 `babel-content-downloader-source-0.1.26.zip` 解压后的 `babel-content-downloader/` **内部内容**作为仓库根目录，即根目录应直接看到 README.md、package.json、LICENSE 和源码目录。

源码包已经排除 `.audit/`、`node_modules/`、`dist/`、`releases/`、本机配置和采集结果。不要直接上传开发机器整个项目目录。保留 MIT LICENSE、THIRD_PARTY.md、CHANGELOG.md 与 docs/。

源码仓库不依赖发行附件才能阅读 README。不要为还没有发布的 npm 包或扩展商店页面填写虚构安装链接。

## Release 附件

发布版本可以命名为 `v0.1.26`，标记为早期版本，并上传交付目录的以下文件：

- `babel-content-downloader-0.1.26.tgz`
- `babel-content-downloader-extension-0.1.26.zip`
- `babel-content-downloader-source-0.1.26.zip`
- `README.md`、`INSTALL.md`
- `EXTENSION-INSTALL.md`
- `release-manifest.json`、`verification.json`、`SHA256SUMS`

Release 页面应将 `babel-content-downloader-extension-0.1.26.zip` 标为普通用户的浏览器扩展下载项，明确“不需要源码包”。不要把源码 ZIP 放在扩展 ZIP 之前作为默认安装路径。当前说明用“下载、解压、加载已解压的扩展程序”；Chrome Web Store 一键安装完成前，不写“直接点击 ZIP 安装”。后续商店工作见 [发布路线图](release-roadmap.md)。

`README.md` 是发行包旁的使用入口；其中 `docs/` 相对链接可在源码包解压后的仓库根目录使用。`INSTALL.md` 的深入文档链接以在旁边解压源码包为前提。使用说明不需要依赖发布服务器才能查看。

上传前在该目录执行：

```sh
shasum -a 256 -c SHA256SUMS
```

所有行应为 `OK`。校验值必须来自这次文档更新后的最终交付物，不要混用之前生成的 0.1.26 候选包。本版为 0.1.26，新增五语言宽屏概览页、独立设置页、浏览器语言自动匹配和完整 README。发布时请使用同一版全部附件。

清单中的 `published` 与 `source_url` 必须对应实际 GitHub Release 和公开仓库。若发布前修改任何附件或远程地址，应重新生成发行包与 SHA256SUMS；不要声称旧校验文件仍适用。`bootstrap-manifest.json` 始终是模板，不能作为已发布下载清单。

## 可复制的发布说明

> ### Babel Content Downloader v0.1.26
>
> 让本地 AI Agent 将公开文章、论文、视频和播客保存为可阅读、观看、收听的本地资料。
>
> - 宽屏概览页、独立设置页与完整 README 支持英语、简体中文、繁体中文、日语、韩语；界面默认跟随浏览器语言，无匹配时使用英文，也可手动切换并记住选择。
> - 普通网页使用统一正文提取，支持浏览器回退。
> - 支持文章与配图、音视频、已有字幕和受支持的 PDF／附件保存。
> - 可提取视频音频、选择格式与片段，任务自建页面默认静音。
> - 提供任务查询、取消、恢复和文件完整性记录。
> - 源码采用 MIT 许可证，运行时和资料保存在本机。
>
> 首版推荐 macOS + Chrome + 本地 MCP Agent。请先阅读仓库 README，按“运行时、扩展、Agent”三个部分接入。音视频需要 yt-dlp、FFmpeg 和 ffprobe。
>
> 15 个登记来源不等于全平台完整兼容。X、Reddit、小红书、公众号、GitHub Markdown blob 及字幕完成状态仍有已知限制，详见 README 和首版说明。
>
> 验证基线：当前完整测试结果见 verification.json；安装包可独立启动 MCP；源码包可重新构建。真实浏览器样本与包级验证的边界已记录在验证文件中。
>
> 下载运行时 TGZ 和正式扩展 ZIP 即可安装；需要开发时下载源码 ZIP。所有附件的 SHA256 校验值见 SHA256SUMS。

## 发布后手动检查

1. 打开远程仓库首页，确认 README 正常展示且 docs 链接可打开。
2. 确认发布附件的文件名与安装命令相同，下载后校验摘要。
3. 用一台干净环境按 README 安装，先测一篇公开文章，再测一条短音视频。
4. 把测试未覆盖的系统或平台保留为未验证，不把源码路由登记当作使用验收。

可用 [使用与测试手册](usage-guide.md) 中的测试表与反馈模板收集首批使用问题。
