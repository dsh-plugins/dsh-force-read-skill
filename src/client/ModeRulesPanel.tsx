/**
 * “按模式设置必读 SKILL”管理面板。
 *
 * 模板为该面板声明了 `field: ['modes']`，因此 loader 会把卡片草稿里
 * `modes` 的当前值与 setter 传进来：面板只改草稿，由卡片的「保存」按钮
 * （和 Ctrl+S）连同修订号一起提交，不再有第二套保存入口。
 *
 * 旧版 loader 不传 `value`/`setValue`，此时退回自带草稿与独立保存。
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

/**
 * loader 新增的草稿绑定；旧版 `ConfigPanelProps` 没有这两个属性，
 * 因此在这里以可选属性声明，运行时再检测。
 */
interface PanelBinding {
  value?: unknown;
  setValue?(value: unknown): void;
}

/** 面板属性：loader 的固定字段加可选草稿绑定。 */
export type ModeRulesPanelProps = ConfigPanelProps & PanelBinding;

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

/** 模式顺序：先按技能目录顺序，再追加草稿里目录未覆盖的模式。 */
function mergeRows(modes: readonly ModeSetting[], catalog: readonly CatalogMode[]): ModeSetting[] {
  const known = new Map(modes.map(mode => [mode.id, mode]));
  return catalog.map(mode => known.get(mode.id) ?? { id: mode.id, enabled: false, skills: [] })
    .concat(modes.filter(mode => !catalog.some(item => item.id === mode.id)));
}

/** 模式的展示名：优先用注册表名称，其次内置中文名，最后回落到 ID。 */
function modeName(mode: { readonly id: string }, info: CatalogMode | undefined): string {
  return info?.name ?? modeLabels[mode.id] ?? mode.id;
}

/** 按模式配置强制阅读 SKILL 的面板。 */
export function ModeRulesPanel({ view, client, value, setValue }: ModeRulesPanelProps): React.ReactElement {
  // loader 传入 setValue 时走草稿绑定：改动进入卡片草稿，随卡片保存。
  const bound = typeof setValue === 'function';
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

  const modes = bound ? readModes(value) : draft;
  const dirty = !bound && JSON.stringify(draft) !== JSON.stringify(saved);

  /** 写回：绑定时写卡片草稿，否则写面板自己的草稿。 */
  const commit = (next: ModeSetting[]): void => {
    if (bound) {
      setValue(next as unknown as ConfigValues);
      return;
    }
    setDraft(next);
  };

  // 未绑定时自行跟踪修订号；绑定时由卡片负责，忽略外部快照变化。
  const seenRevision = React.useRef(view.revision);
  React.useEffect(() => {
    if (bound || view.revision === seenRevision.current) {
      return;
    }
    seenRevision.current = view.revision;
    const next = readModes(view.value.modes);
    setSaved(next);
    setRevision(view.revision);
    setDraft(current => (JSON.stringify(current) === JSON.stringify(saved) ? next : current));
  }, [bound, view, saved]);

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
        setCatalog(Array.isArray(payload?.modes) ? payload.modes : []);
        if (!bound) {
          // 未绑定时补全基线，避免新增模式一出现就被当成未保存修改。
          const baseline = mergeRows(readModes(view.value.modes), Array.isArray(payload?.modes) ? payload.modes : []);
          setSaved(baseline);
          setDraft(baseline);
        }
      }, cause => {
        if (!controller.signal.aborted) {
          setLoadError(cause instanceof Error ? cause.message : String(cause));
          if (!bound) {
            const current = readModes(view.value.modes);
            setDraft(current);
            setSaved(current);
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
    // 目录只在挂载与手动刷新时读取；绑定时草稿变化不应触发重新请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, reload]);

  const update = (id: string, change: Partial<ModeSetting>): void => {
    const exists = modes.some(mode => mode.id === id);
    const next = exists
      ? modes.map(mode => (mode.id === id ? { ...mode, ...change } : mode))
      : [...modes, { id, enabled: false, skills: [], ...change }];
    commit(next);
    setSaveError('');
    setNotice('');
  };

  /** 未绑定时的独立保存。 */
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
    commit(mergeRows(modes, catalog).map(mode => ({ id: mode.id, enabled: false, skills: [] })));
    setNotice('');
    setSaveError('');
  };

  if (loading) {
    return <section className="dfrs-panel"><style>{PANEL_CSS}</style><p className="dfrs-status">正在读取各模式已加载的 SKILL…</p></section>;
  }

  const rows = mergeRows(modes, catalog).map(mode => ({ mode, info: catalog.find(item => item.id === mode.id) }));
  const active = rows.filter(row => row.mode.enabled && row.mode.skills.length > 0).length;

  return <section className="dfrs-panel">
    <style>{PANEL_CSS}</style>
    <div className="dfrs-toolbar">
      <span className="dfrs-grow dfrs-status">共 {rows.length} 个模式，{active} 个生效（已开启且至少选择 1 个 SKILL）。</span>
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
      {bound
        ? <span className="dfrs-grow dfrs-status">改动随本卡片的「保存」一并提交。</span>
        : <>
          <Button variant="primary" small loading={saving} disabled={!dirty || saving} onClick={save}>保存</Button>
          <Button small disabled={!dirty || saving} onClick={discard}>取消修改</Button>
          <span className="dfrs-grow"/>
          {dirty && <span className="dfrs-status">有未保存的修改</span>}
        </>}
      <Button small disabled={saving} onClick={disableAll}>全部关闭</Button>
      {notice !== '' && <span className="dfrs-status" role="status">{notice}</span>}
    </div>
    {saveError !== '' && <p className="dfrs-alert" role="alert">保存失败：{saveError}</p>}
  </section>;
}
