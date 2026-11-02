# Raycast Store submission notes / Raycast 商店上架说明

## Current status / 当前状态

This project has a 512×512 PNG icon, MIT license, npm lockfile and a passing distribution build. It has **not** been submitted to the Raycast Store. The `author` field still says `local`: replace it with the actual **Raycast account username**, which may differ from the GitHub username. The package name remains `drama-ratings` to preserve the locally installed extension identity and existing preferences.

当前项目具备 512×512 PNG 图标、MIT 许可、npm 锁文件和可通过的构建；**尚未提交 Raycast 商店**。`author` 仍是 `local`，需要改为实际的 **Raycast 用户名**（不一定与 GitHub 用户名相同）。内部包名保留 `drama-ratings`，以避免更改已安装扩展的身份和配置。

## Before submitting / 提交前

1. Check Raycast's current [preparation guide](https://developers.raycast.com/basics/prepare-an-extension-for-store) and [extension guidelines](https://manual.raycast.com/extensions-guidelines). Verify the latest API version, platform declaration, categories, command metadata, English copy, accessibility, lint and distribution build.
2. Add a changelog using the format in the preparation guide. Use Raycast's **Capture Window** command for Store screenshots; the guide recommends at least three and permits up to six (2000×1250 PNG). Remove all API keys, share codes and personal information from screenshots.
3. Verify the terms and distribution rights for every provider. In particular, check Douban/ApiZero, OMDb, TMDB, Telegram, and cloud-share services; check that the channel-search feature and any default channel list are acceptable for the Store. A personal-use API key or this repository's MIT license does not grant rights to redistribute third-party metadata or guarantee Store approval.
4. Test the actual distributed extension in Raycast using valid keys, in both languages, and document any limitations. The Store review may require changes.

1. 阅读 Raycast 最新的[上架准备](https://developers.raycast.com/basics/prepare-an-extension-for-store)和[扩展规范](https://manual.raycast.com/extensions-guidelines)，核对 API 版本、平台、分类、命令信息、英文文案、无障碍、代码检查及分发构建。
2. 按官方格式增加更新日志，用 Raycast 的 **Capture Window** 截图。官方建议至少 3 张、最多 6 张，规格为 2000×1250 PNG；截图不能包含密钥、分享提取码或个人信息。
3. 核查各服务条款和分发权利，尤其是豆瓣/ApiZero、OMDb、TMDB、Telegram 和网盘服务；并确认频道搜索及默认频道列表符合商店规则。个人使用密钥与本仓库的 MIT 许可不等于第三方数据的再分发授权，也不保证审核通过。
4. 使用有效密钥在 Raycast 实测分发版的中英文界面和完整流程。官方审核可能要求修改。

## Submission / 提交方式

The [official publishing guide](https://developers.raycast.com/basics/publish-an-extension) says to run `npm run build`, add `"publish": "npx @raycast/api@latest publish"` to `scripts` if needed, and run `npm run publish`. The tool authenticates with GitHub and opens a pull request to `raycast/extensions`; review and merge are required before automatic Store publication. Alternatively, fork the official repository, add the extension, and open a PR manually. Publishing this separate GitHub repository alone does not list the extension in the Store.

根据[官方发布指南](https://developers.raycast.com/basics/publish-an-extension)，先运行 `npm run build`；如果没有发布脚本，可在 `scripts` 中添加 `"publish": "npx @raycast/api@latest publish"`，再运行 `npm run publish`。发布工具需要 GitHub 授权，并向 `raycast/extensions` 提交 PR；官方审核合并后才会自动上架。也可 fork 官方仓库并手动提交 PR。将本项目上传到独立 GitHub 仓库并不等于商店上架。
