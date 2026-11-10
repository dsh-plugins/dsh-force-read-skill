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
| 强制阅读 SKILL（`enabled`） | 开启 | 模型成功读取符合要求的 SKILL 后，才可调用其他工具。 |
| 指定 SKILL（`requiredSkills`） | 空列表 | 留空时可读取任意 SKILL。填写后，读取列表中的任意一个即可。 |

成功读取后，当前会话放行至下一次成功的上下文压缩。恢复会话时沿用该会话的记录。通过 `/技能名` 注入符合要求的技能正文也可满足要求。

插件豁免 `skill`。程序化工具调用（Programmatic Tool Calling，PTC）预设可通过 `run_code` 读取 SKILL，正文会随下一步请求发送给模型。同一批次内的其他工具调用仍需通过检查。

未满足要求时，工具返回 **You must read those skills that you should read.**

## 构建与测试

```sh
npm ci
npm run typecheck
npm run build
npm test
npm pack --dry-run
```
