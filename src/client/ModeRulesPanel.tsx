/**
 * “按模式设置必读 SKILL”管理面板。
 *
 * 通过 dsh-loader 的 `registerPanel` 注册（见 `./index.tsx`），由配置卡片渲染。
 * 面板自己维护草稿并按 loader 的修订号保存，因此每个模式的开关与多选结果
 * 都在点“保存”时一次性写入 config.json。
 *
 * @module dsh-force-read-skill/client/ModeRulesPanel
 */
import * as React from 'react';
import {
  Button,
  Icon,
  Scrollbar,
  Switch,
  type ConfigPanelProps,
  type ConfigValues,
} from '@dsh-plugin/dsh-loader/client';
import type { CatalogMode, CatalogPayload, ModeSetting } from '../shared.js';
import { SkillMultiSelect } from './SkillMultiSelect.js';
import { PANEL_CSS } from './styles.js';

/** 与宿主模板一致的配置 ID。 */
const configId = 'dsh-force-read-skill';
/** 读取各模式已加载 SKILL 的只读操作。 */
const catalogOperation = 'catalog';
/** 内置模式的展示名；注册表未提供 name 时使用。 */
const modeLabels: Record<string, string> = {
  standard: '标准',
  ptc: 'PTC',
  minimal: '极简',
  cordis: '创造',
};

/** 把配置里的 `modes` 读成强类型数组，忽略结构不符的项。 */
function readModes(value: unknown): ModeSetting[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const modes: ModeSetting[] = [];
  for (const entry of value as readonly unknown[]) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== 'string' || id === '') {
      continue;
    }
    const skills = Array.isArray(record.skills)
      ? (record.skills as readonly unknown[]).filter((skill): skill is string => typeof skill === 'string')
      : [];
    modes.push({ id, enabled: record.enabled === true, skills });
  }
  return modes;
}

/** 合并草稿与技能目录：目录里有、草稿里没有的模式补一条未启用项。 */
function mergeModes(draft: readonly ModeSetting[], catalog: readonly CatalogMode[]): ModeSetting[] {
  const byId = new Map(draft.map(mode => [mode.id, mode]));
  return catalog.map(mode => byId.get(mode.id) ?? { id: mode.id, enabled: false, skills: [] })
    .concat(draft.filter(mode => !catalog.some(item => item.id === mode.id)));
}

/** 模式的展示名：优先用注册表名称，其次内置中文名，最后回落到 ID。 */
function modeName(mode: { readonly id: string }, info: CatalogMode | undefined): string {
  return info?.name ?? modeLabels[mode.id] ?? mode.id;
}

/** 按模式配置强制阅读 SKILL 的面板。 */
export function ModeRulesPanel({ view, client }: ConfigPanelProps): React.ReactElement {
  const [saved, setSaved] = React.useState<ModeSetting[]>(() => readModes(view.value.modes));
  const [revision, setRevision] = React.useState(view.revision);
  const [draft, setDraft] = React.useState<ModeSetting[]>(saved);
  const [catalog, setCatalog] = React.useState<readonly CatalogMode[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState('');
  const [saveError, setSaveError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [reload, setReload] = React.useState(0);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  // 外部保存（其他标签页或卡片的“恢复默认值”）后同步；正在编辑时不覆盖草稿。
  const seenRevision = React.useRef(view.revision);
  React.useEffect(() => {
    if (view.revision === seenRevision.current) {
      return;
    }
    seenRevision.current = view.revision;
    const next = mergeModes(readModes(view.value.modes), catalog);
    setSaved(next);
    setRevision(view.revision);
    setDraft(current => (JSON.stringify(current) === JSON.stringify(saved) ? next : current));
  }, [view, saved, catalog]);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    void client.invoke(configId, catalogOperation, { input: {} }, controller.signal)
      .then(result => {
        if (controller.signal.aborted) {
          return;
        }
        const payload = result.value as unknown as CatalogPayload | undefined;
        const modes = Array.isArray(payload?.modes) ? payload.modes : [];
        // 目录里新增的模式以未启用项补进基线，避免一进页面就显示“有未保存的修改”。
        const baseline = mergeModes(readModes(view.value.modes), modes);
        setCatalog(modes);
        setSaved(baseline);
        setDraft(baseline);
      }, cause => {
        if (!controller.signal.aborted) {
          setLoadError(cause instanceof Error ? cause.message : String(cause));
          const current = readModes(view.value.modes);
          setDraft(current);
          setSaved(current);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
    // view 只用于取初始草稿；保存后的值由 setSaved/setDraft 维护，避免每次输入都重新请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, reload]);

  const update = (id: string, change: Partial<ModeSetting>): void => {
    setDraft(current => current.map(mode => mode.id === id ? { ...mode, ...change } : mode));
    setSaveError('');
    setNotice('');
  };

  const save = (): void => {
    setSaving(true);
    setSaveError('');
    setNotice('');
    void client.update(configId, { modes: draft } as unknown as ConfigValues, revision).then(result => {
      const next = readModes(result.value.modes);
      seenRevision.current = result.revision;
      setSaved(next);
      setDraft(next);
      setRevision(result.revision);
      setNotice('已保存，插件立即生效。');
    }, cause => {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => setSaving(false));
  };

  const discard = (): void => {
    setDraft(saved);
    setSaveError('');
    setNotice('');
  };

  const disableAll = (): void => {
    setDraft(current => current.map(mode => ({ id: mode.id, enabled: false, skills: [] })));
    setNotice('');
    setSaveError('');
  };

  if (loading) {
    return <section className="dfrs-panel"><style>{PANEL_CSS}</style><p className="dfrs-status">正在读取各模式已加载的 SKILL…</p></section>;
  }

  const rows = draft.map(mode => ({ mode, info: catalog.find(item => item.id === mode.id) }));
  const active = draft.filter(mode => mode.enabled && mode.skills.length > 0).length;

  return <section className="dfrs-panel">
    <style>{PANEL_CSS}</style>
    <div className="dfrs-toolbar">
      <span className="dfrs-grow dfrs-status">共 {draft.length} 个模式，{active} 个生效（已开启且至少选择 1 个 SKILL）。</span>
      <Button small icon="Refresh" onClick={() => setReload(value => value + 1)}>刷新技能列表</Button>
    </div>
    {loadError !== '' && <p className="dfrs-alert" role="alert">读取技能目录失败：{loadError}</p>}
    <Scrollbar style={{ maxHeight: 420 }} aria-label="按模式配置必读 SKILL">
      <div className="dfrs-modes">
        {rows.map(({ mode, info }) => {
          const available = info?.skills ?? [];
          const blocked = info !== undefined && !info.canRead;
          const enabled = mode.enabled && !blocked;
          const name = modeName(mode, info);
          return <div className="dfrs-mode" key={mode.id} data-muted={!enabled}>
            <div className="dfrs-mode-head">
              <Switch
                checked={enabled}
                disabled={blocked}
                aria-label={`${name}：强制阅读 SKILL`}
                onChange={event => update(mode.id, { enabled: event.target.checked })}
              />
              <span className="dfrs-mode-name">{name}</span>
              {info?.isDefault === true && <span className="dfrs-badge">默认模式</span>}
              {name !== mode.id && <span className="dfrs-mode-id">{mode.id}</span>}
            </div>
            <div className="dfrs-mode-body">
              <SkillMultiSelect
                idPrefix={`dfrs-${mode.id.replace(/[^A-Za-z0-9_-]/g, '-')}`}
                label={`${name} 的必读 SKILL`}
                placeholder={available.length === 0 ? '该模式没有可选的 SKILL' : '未选择（该模式不强制阅读）'}
                options={available}
                value={mode.skills}
                disabled={!enabled || available.length === 0}
                onChange={skills => update(mode.id, { skills })}
              />
              {mode.skills.length > 0 && <div className="dfrs-picked">
                {mode.skills.map(skill => <span className="dfrs-chip" key={skill}>
                  {skill}
                  <button type="button" aria-label={`移除 ${skill}`} onClick={() => update(mode.id, { skills: mode.skills.filter(item => item !== skill) })}>×</button>
                </span>)}
              </div>}
              {blocked && <p className="dfrs-notice"><Icon name="Warning" size={12}/> 该模式没有可读取 SKILL 的工具（skill 或 PTC），不会强制阅读。</p>}
              {!blocked && info?.notice !== undefined && <p className="dfrs-notice">{info.notice}</p>}
              {!blocked && enabled && available.length > 0 && mode.skills.length === 0 && <p className="dfrs-notice">已开启但未选择 SKILL：该模式仍不会强制阅读。</p>}
            </div>
          </div>;
        })}
        {rows.length === 0 && <p className="dfrs-status">没有读到任何 Agent 模式；请确认 agent 预设注册表已加载。</p>}
      </div>
    </Scrollbar>
    <div className="dfrs-actions">
      <Button variant="primary" small loading={saving} disabled={!dirty || saving} onClick={save}>保存</Button>
      <Button small disabled={!dirty || saving} onClick={discard}>取消修改</Button>
      <Button small disabled={saving} onClick={disableAll}>全部关闭</Button>
      <span className="dfrs-grow"/>
      {dirty && <span className="dfrs-status">有未保存的修改</span>}
      {notice !== '' && <span className="dfrs-status" role="status">{notice}</span>}
    </div>
    {saveError !== '' && <p className="dfrs-alert" role="alert">保存失败：{saveError}</p>}
  </section>;
}
