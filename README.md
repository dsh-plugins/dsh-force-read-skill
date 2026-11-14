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
| Require skill reading (`enabled`) | Enabled | Master switch. When off, no mode is blocked. |
| Per-mode settings (`modes`) | Every mode off | Each preset (mode) has its own switch and required list, edited in the "required skills per mode" panel. |

The plugin details page renders a **required skills per mode** panel. Every mode gets a switch and a multi-select dropdown that lists only the skills already loaded **in that mode**; the dropdown stays open while you tick entries, so one mode can require several skills at once. Reading any one of them satisfies the requirement. A mode that is switched on but has no selected skill still does not block anything, and a mode without a readable skill surface (for example the minimal mode, which ships no `skill` tool and no PTC executor) is detected and never blocked, so the guard cannot deadlock an agent.

The panel does not save on its own: it edits the card's draft, so its changes are committed by the card's **Save** button (or `Ctrl+S`) together with the master switch, under the same revision check, and the card's "cancel" / "restore defaults" apply to it too. This needs dsh-loader with panel field binding (`panel.field`); on a loader without it the panel falls back to its own Save button. Skill options are read from each mode's own scope through the preset registry, so a skill registered inside a preset shows up for that preset only. "Refresh skill list" re-reads the catalog, so skills installed later appear without a restart.

The guard uses the settings of the preset active in the current session; when the active preset cannot be determined, calls are not blocked. Upgrading from 0.1.x or 0.2.x migrates the old flat/preset-scoped lists into the per-mode settings. Saved skill names that no longer exist stay in the configuration until removed manually.

A successful read applies to the current session, including resumed sessions, until the next successful context compaction. A `/skill-name` invocation that injects eligible skill instructions also satisfies the requirement.

The `skill` tool is exempt. Programmatic Tool Calling (PTC) presets can read through `run_code` and receive the instructions in the next model request. Other tool calls in the same batch still undergo the check.

Beyond blocking calls, the plugin also appends a reminder right after the injected skill catalog (`skill-catalog`), listing the preset's required skills the model has not read yet and telling it to call `skill` before any other tool. Once every required skill is read — or when the active preset has no required list — no reminder is added.

Rejected calls return **You must read those skills that you should read.**

## Build and test

```sh
npm ci
npm run typecheck   # host + client
npm run build       # lib/index.js + lib/client.js
npm test
npm pack --dry-run
```

The client half (`lib/client.js`) is a tsdown-built `window.__ModuleLoader__.load({ id, factory })` closure; `package.json` declares it under `exports["./client"]` and `dsh.client`, and it only registers the configuration panel through `ctx.dshLoaderUi.config.registerPanel`.
