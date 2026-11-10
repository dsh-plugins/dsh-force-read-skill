<div align="center">

# DSH Force Read Skill

**Require a DeepSeek Harness model to read a skill before using other tools.**

English | [简体中文](README.zh_CN.md)

</div>

[![CI](https://github.com/dsh-plugins/dsh-force-read-skill/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/dsh-plugins/dsh-force-read-skill/actions/workflows/npm-publish.yml)
[![npm](https://img.shields.io/npm/v/@dsh-plugin/dsh-force-read-skill)](https://www.npmjs.com/package/@dsh-plugin/dsh-force-read-skill)

## Install

Install dsh-loader 2.0 and the plugin in the same Web profile.

```sh
dsh plugin --profile web add "@dsh-plugin/dsh-loader@next"
dsh plugin --profile web add "@dsh-plugin/dsh-force-read-skill"
```

Edit and save the configuration on the plugin details page. Saved changes take effect immediately.

| Setting | Default | Behavior |
| --- | --- | --- |
| Require skill reading (`enabled`) | Enabled | Reject other tool calls until the model reads an eligible skill. |
| Required skills (`requiredSkills`) | Empty list | An empty list accepts any skill. Otherwise, the model must read one skill from the list. |

A successful read applies to the current session, including resumed sessions, until the next successful context compaction. A `/skill-name` invocation that injects eligible skill instructions also satisfies the requirement.

The `skill` tool is exempt. Programmatic Tool Calling (PTC) presets can read through `run_code` and receive the instructions in the next model request. Other tool calls in the same batch still undergo the check.

Rejected calls return **You must read those skills that you should read.**

## Build and test

```sh
npm ci
npm run typecheck
npm run build
npm test
npm pack --dry-run
```
