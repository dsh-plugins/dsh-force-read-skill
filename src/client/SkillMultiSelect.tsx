/**
 * 多选下拉菜单：触发钮 + 平台菜单（经 dsh-loader 的 `DshMenu` 包装层）。
 *
 * 菜单保持展开直到用户点击外部或按 Escape，因此可以连续勾选；
 * 顶部提供筛选框，底部提供“全选当前结果 / 清空”。
 *
 * @module dsh-force-read-skill/client/SkillMultiSelect
 */
import * as React from 'react';
import { DshMenu as Menu, Icon, type MenuEntry } from '@dsh-plugin/dsh-loader/client';

/** 菜单里的一项 SKILL。 */
export interface SkillOption {
  readonly name: string;
  readonly description?: string;
}

/** {@link SkillMultiSelect} 的属性。 */
export interface SkillMultiSelectProps {
  options: readonly SkillOption[];
  value: readonly string[];
  onChange(skills: string[]): void;
  disabled?: boolean;
  /** 触发钮的无障碍名称。 */
  label: string;
  /** 没有任何已选时的占位文字。 */
  placeholder: string;
  /** 输入框与触发钮的 DOM id 前缀。 */
  idPrefix: string;
}

/** 菜单高度预算，用于决定向上还是向下展开。 */
const MENU_MAX_HEIGHT = 320;
/** 选项超过该数量时才显示筛选框，避免小列表多一行噪声。 */
const FILTER_THRESHOLD = 8;
/** 不在选项里的历史选择：保留在菜单末尾，方便手动移除。 */
const staleGroupId = '__stale__';

/** 一个可多选的 SKILL 下拉菜单。 */
export function SkillMultiSelect({
  options,
  value,
  onChange,
  disabled = false,
  label,
  placeholder,
  idPrefix,
}: SkillMultiSelectProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [side, setSide] = React.useState<'bottom' | 'top'>('bottom');
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const selected = React.useMemo(() => new Set(value), [value]);
  const known = React.useMemo(() => new Set(options.map(option => option.name)), [options]);

  React.useEffect(() => {
    if (!open) {
      setQuery('');
      return undefined;
    }
    const place = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect === undefined) {
        return;
      }
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      setSide(below >= Math.min(MENU_MAX_HEIGHT, above) ? 'bottom' : 'top');
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const search = query.trim().toLocaleLowerCase();
  const matched = options.filter(option => option.name.toLocaleLowerCase().includes(search)
    || (option.description ?? '').toLocaleLowerCase().includes(search));
  const stale = value.filter(name => !known.has(name));

  const toggle = (name: string): void => {
    const next = selected.has(name) ? value.filter(item => item !== name) : [...value, name];
    onChange([...new Set(next)]);
  };

  const items: MenuEntry[] = [];
  for (const option of matched) {
    items.push({
      id: option.name,
      label: <span className="dfrs-opt">
        <span className="dfrs-opt-name">{option.name}</span>
        {option.description !== undefined && <span className="dfrs-opt-desc">{option.description}</span>}
      </span>,
    });
  }
  if (items.length === 0) {
    items.push({ type: 'label', id: '__empty__', text: search === '' ? '该模式当前没有可选的 SKILL' : '没有匹配的 SKILL' });
  }
  if (stale.length > 0) {
    items.push({ type: 'label', id: staleGroupId, text: '已选但该模式当前不可用' });
    for (const name of stale) {
      items.push({ id: name, label: <span className="dfrs-opt"><span className="dfrs-opt-name">{name}</span></span> });
    }
  }
  const footer: MenuEntry[] = matched.length === 0 ? [] : [
    { type: 'separator', id: '__sep__' },
    { id: '__all__', label: `全选当前 ${matched.length} 项` },
    { id: '__none__', label: '清空全部' },
  ];

  const summary = value.length === 0
    ? placeholder
    : value.length <= 2 ? value.join('、') : `${value.slice(0, 2).join('、')} 等 ${value.length} 项`;

  const filterId = `${idPrefix}-filter`;
  return <div className="dfrs-select">
    {options.length > FILTER_THRESHOLD && open && <input
      id={filterId}
      className="dfrs-filter"
      type="search"
      value={query}
      placeholder="筛选 SKILL…"
      aria-label="筛选 SKILL"
      onChange={event => setQuery(event.target.value)}
    />}
    <Menu
      open={open}
      portal
      align="start"
      side={side}
      items={items}
      footer={footer}
      selectedIds={value}
      onSelect={(id: string) => {
        if (id === '__all__') {
          onChange([...new Set([...value, ...matched.map(option => option.name)])]);
          return;
        }
        if (id === '__none__') {
          onChange([]);
          return;
        }
        if (id.startsWith('__')) {
          return;
        }
        toggle(id);
      }}
      onClose={() => setOpen(false)}
      anchor={<button
        ref={triggerRef}
        id={`${idPrefix}-trigger`}
        type="button"
        className="dfrs-trigger"
        disabled={disabled}
        aria-label={`${label}：${summary}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(previous => !previous)}
      >
        <span className="dfrs-trigger-text" data-empty={value.length === 0}>{summary}</span>
        <span className="dfrs-trigger-caret" aria-hidden="true"><Icon name="ChevronDown" size={14}/></span>
      </button>}
    />
  </div>;
}
