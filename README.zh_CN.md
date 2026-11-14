<div align="center">

# DSH Force Read Skill

**要求 DeepSeek Harness 模型先读取 SKILL，再使用其他工具。**

[English](README.md) | 简体中文

</div>

[![持续集成](https://github.com/dsh-plugins/dsh-force-read-skill/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/dsh-plugins/dsh-force-read-skill/actions/workflows/npm-publish.yml)
[![npm 版本](https://img.shields.io/npm/v/@dsh-plugin/dsh-force-read-skill)](https://www.npmjs.com/package/@dsh-plugin/dsh-force-read-skill)

## 安装

在同一个 Web 配置档案中安装 dsh-loader 2.0 和本插件。

```sh
dsh plugin --profile web add "@dsh-plugin/dsh-loader@next"
dsh plugin --profile web add "@dsh-plugin/dsh-force-read-skill"
```

在插件详情页修改配置，保存后立即生效。

| 配置项 | 默认值 | 行为 |
| --- | --- | --- |
| 强制阅读 SKILL（`enabled`） | 开启 | 总开关。关闭后任何模式都不再拦截。 |
| 按模式配置（`modes`） | 每个模式均关闭 | 每个预设（模式）独立的开关与必读列表，在「按模式设置必读 SKILL」面板中编辑。 |

插件详情页会渲染 **按模式设置必读 SKILL** 面板。每个模式一行：一个开关加一个多选下拉菜单，菜单只列出**该模式已加载**的 SKILL；菜单在勾选时保持展开，因此一个模式可以一次选中多个必读项，读取其中任意一个即可放行。开关已开但未选择 SKILL 时仍不强制；若某个模式组合里没有可读取 SKILL 的工具（例如极简模式既无 `skill` 工具也无 PTC 执行器），插件会识别出来并跳过该模式，避免把模型的所有工具调用锁死。

面板维护自己的草稿，点面板上的「保存」写入 config.json，插件立即生效。SKILL 选项按每个模式自己的作用域经预设注册表读取，只在该预设内注册的技能只会出现在对应模式下。「刷新技能列表」重新读取目录，之后安装的 SKILL 无需重启即可出现。

守卫按当前会话生效的预设取用对应设置；无法判定生效预设时不拦截。从 0.1.x / 0.2.x 升级时，旧的平铺列表与按预设列表会自动迁移为按模式设置；已保存但当前不存在的 SKILL 名称保留在配置中，直到手动移除。

成功读取后，当前会话放行至下一次成功的上下文压缩。恢复会话时沿用该会话的记录。通过 `/技能名` 注入符合要求的技能正文也可满足要求。

插件豁免 `skill`。程序化工具调用（Programmatic Tool Calling，PTC）预设可通过 `run_code` 读取 SKILL，正文会随下一步请求发送给模型。同一批次内的其他工具调用仍需通过检查。

除拦截工具调用外，插件还会在宿主注入的 SKILL 目录（`skill-catalog`）之后追加一条提示，列出当前生效模式尚未阅读的必读 SKILL，提醒模型在调用其他工具前先用 `skill` 读取；已读齐或该模式无必读项时不追加。

未满足要求时，工具返回 **You must read those skills that you should read.**

## 构建与测试

```sh
npm ci
npm run typecheck   # 宿主 + 客户端
npm run build       # lib/index.js + lib/client.js
npm test
npm pack --dry-run
```

客户端产物 `lib/client.js` 由 tsdown 打包为 `window.__ModuleLoader__.load({ id, factory })` 闭包，由 `package.json` 的 `exports["./client"]` 与 `dsh.client` 声明；它只负责通过 `ctx.dshLoaderUi.config.registerPanel` 注册配置面板。
