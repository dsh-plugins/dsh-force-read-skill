import type { CordisContext, HostAPI } from '@dsh-plugin/dsh-loader';
import { defineConfig, type ConfigField, type ConfigValue } from '@dsh-plugin/dsh-loader/config';
import { hasReadSkill, missingSkills, readSkillName, type ContentBlock, type SessionHistory } from './history.js';
import type { CatalogMode, CatalogSkill, ModeSetting } from './shared.js';

export const name = '@dsh-plugin/dsh-force-read-skill';
export const inject = ['dshLoader', 'tools', 'skills'];

const id = 'dsh-force-read-skill';
const denialReason = 'You must read those skills that you should read.';
/** 预设组合里真正能让模型读到 SKILL 正文的插件行。 */
const skillReaders = ['@deepseek-ai/dsh-tool-skill', '@deepseek-ai/dsh-tool-executor-ptc'];
/** config-api 的字段键只接受标识符；旧版预设 ID 可能含 `.` 等字符，迁移时只保留合法键。 */
const keyPattern = /^[A-Za-z_][A-Za-z0-9_-]*$/;
/** 配置面板读取技能目录的操作 ID，需与模板 panels[].operations 一致。 */
const catalogOperation = 'catalog';

interface Preferences {
  /** 总开关；关闭后所有模式都不再拦截。 */
  enabled: boolean;
  /** 各模式的独立设置。 */
  modes: ModeSetting[];
  /** 0.2.x 旧字段：按预设 ID 记录的必读列表；注册后迁移进 modes。 */
  presets?: Record<string, string[]>;
  /** 0.1.x 旧字段：平铺的必读列表；注册后迁移进默认模式。 */
  requiredSkills?: string[];
}

interface PresetRow {
  readonly id: string;
  readonly name?: string;
  readonly order?: number;
  /** 该预设激活失败的原因。 */
  readonly broken?: string;
}

interface CompositionRow {
  readonly id: string;
  readonly modules: readonly { readonly moduleName: string }[];
}

/** agentPresets.acquireScope() 返回的保留租约；释放通过 Symbol.asyncDispose。 */
interface ScopeLease {
  readonly key: object;
}

interface AgentPresets {
  readonly defaultId?: string;
  list(): Promise<readonly PresetRow[]>;
  presetForSession?(session: unknown): string | null;
  composedPreset?(ctx: unknown): string | undefined;
  /** 读取所有保留预设修订的激活插件行；旧版注册表没有该能力。 */
  inspectCompositions?(): readonly CompositionRow[];
  /** 保留某个预设的当前修订，以便按其作用域读取技能目录。 */
  acquireScope?(id?: string): Promise<ScopeLease>;
}

interface SkillSummary {
  readonly name: string;
  readonly description?: string;
  readonly invocation?: { readonly modelInvocable?: boolean };
}

interface Skills {
  list(options?: {
    readonly scope?: unknown;
    readonly cwd?: string;
    readonly signal?: AbortSignal;
  }): Promise<readonly SkillSummary[]>;
}

interface Execution {
  readonly name: string;
  readonly agent?: { readonly session: SessionHistory };
  readonly parent?: object;
  /** 宿主工具调用的执行上下文（preset 作用域），存在时用于推断组合预设。 */
  readonly ctx?: unknown;
}

interface Result {
  readonly isError: boolean;
  readonly content: readonly ContentBlock[];
}

interface Tools {
  guard(check: (exec: Execution) => string | undefined): () => void;
}

/** agent/pre-step 注入用的会话内消息（与宿主 UserMessage 同形的最小结构）。 */
interface CatalogMessage {
  readonly id?: string;
  readonly source?: { readonly kind?: string };
}

interface PreStepPayload {
  readonly agent: { readonly session: SessionHistory };
  readonly messages: readonly CatalogMessage[];
  readonly signal: AbortSignal;
}

type PreStepDecision =
  | { readonly kind: 'reject' }
  | { readonly kind: 'enter'; readonly messages: readonly unknown[] };

type PreDecision =
  | { readonly kind: 'allow' | 'cancel' }
  | { readonly kind: 'ask'; readonly reason?: string }
  | { readonly kind: 'deny'; readonly reason: string };

type PostDecision =
  | { readonly kind: 'accept'; readonly content?: readonly ContentBlock[]; readonly value?: unknown; readonly additionalContexts?: readonly unknown[] }
  | { readonly kind: 'block'; readonly feedback: readonly ContentBlock[] };

interface CatalogOperationContext {
  readonly signal: AbortSignal;
}

interface PluginContext extends CordisContext {
  readonly dshLoader: HostAPI;
  readonly skills: Skills;
  on(event: 'tools/pre-execute', listener: (exec: Execution, next: () => Promise<PreDecision>) => Promise<PreDecision>, options?: { prepend?: boolean }): () => void;
  on(event: 'tools/post-execute', listener: (exec: Execution, result: Result, next: () => Promise<PostDecision>) => Promise<PostDecision>): () => void;
  on(event: 'agent/pre-step', listener: (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>, options?: { prepend?: boolean }): () => void;
}

/** 读取注册表中的预设清单；服务缺失时退化为仅标准分组。list() 返回 Promise，必须 await。 */
async function rosterOf(presets: AgentPresets | undefined): Promise<readonly PresetRow[]> {
  try {
    const roster = await presets?.list() ?? [];
    return roster.length === 0 ? [{ id: 'standard' }] : roster;
  } catch (error) {
    console.warn(`[${id}] agent-preset registry unavailable, falling back to the standard group:`, error);
    return [{ id: 'standard' }];
  }
}

/** 推断本次工具调用生效的预设：会话投影 → 组合上下文 → 注册表默认值。 */
function resolvePreset(presets: AgentPresets | undefined, exec: Execution): string | undefined {
  try {
    return presets?.presetForSession?.(exec.agent?.session)
      ?? (exec.ctx === undefined ? undefined : presets?.composedPreset?.(exec.ctx))
      ?? presets?.defaultId;
  } catch (error) {
    console.warn(`[${id}] failed to resolve the active agent preset:`, error);
    return undefined;
  }
}

/** 只保留模型可调用的技能，按名称排序后交给面板。 */
function catalogSkills(skills: readonly SkillSummary[]): CatalogSkill[] {
  return [...skills]
    .filter(skill => skill.invocation?.modelInvocable !== false)
    .map(skill => ({ name: skill.name, ...(skill.description === undefined ? {} : { description: skill.description }) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 释放 acquireScope() 的租约；宿主未提供该符号时直接返回。 */
async function releaseLease(lease: ScopeLease | undefined): Promise<void> {
  const symbol = (Symbol as { asyncDispose?: symbol }).asyncDispose;
  if (lease === undefined || symbol === undefined) {
    return;
  }
  const dispose = (lease as unknown as Record<symbol, unknown>)[symbol];
  if (typeof dispose === 'function') {
    await (dispose as () => Promise<void>).call(lease);
  }
}

/** 注册阅读要求，并在工具请求进入权限检查前执行校验。 */
export async function apply(ctx: PluginContext): Promise<void> {
  const loader = ctx.dshLoader;
  const presets = loader.services.get('agentPresets') as AgentPresets | undefined;
  const roster = await rosterOf(presets);

  // 0.2.x 的 presets 用预设 ID 当字段键；非法键无法声明，其历史值只能丢弃。
  const legacyFields: ConfigField[] = roster.filter(preset => keyPattern.test(preset.id)).map(preset => ({
    type: 'array',
    key: preset.id,
    label: preset.name ?? preset.id,
    description: '旧版字段，注册后自动迁移到模式配置。',
    default: [] as string[],
    item: { type: 'text', label: 'SKILL 名称' },
  }));

  const preferences = await loader.config.register<Preferences>(ctx, defineConfig({
    id,
    packageName: name,
    title: '强制阅读 SKILL',
    description: '按模式分别设置是否强制阅读 SKILL，以及必读的 SKILL 列表。',
    fields: [
      {
        type: 'boolean',
        key: 'enabled',
        label: '强制阅读 SKILL',
        default: true,
        description: '总开关。关闭后任何模式都不再拦截；单个模式是否生效由下方管理面板控制。',
      },
      {
        type: 'array',
        key: 'modes',
        label: '按模式配置',
        description: '每个模式独立的开关与必读列表；由下方管理面板编辑。',
        hidden: true,
        item: {
          type: 'object',
          label: '模式',
          fields: [
            { type: 'text', key: 'id', label: '模式 ID', required: true },
            { type: 'boolean', key: 'enabled', label: '强制阅读', default: false },
            {
              type: 'array',
              key: 'skills',
              label: '必读 SKILL',
              default: [] as string[],
              item: { type: 'text', label: 'SKILL 名称' },
            },
          ],
        },
      },
      {
        type: 'object',
        key: 'presets',
        label: '旧版按预设配置',
        description: '0.2.x 遗留字段，仅用于升级时迁移。',
        hidden: true,
        fields: legacyFields,
      },
      {
        type: 'array',
        key: 'requiredSkills',
        label: '旧版必读 SKILL',
        description: '0.1.x 遗留字段，仅用于升级时迁移。',
        hidden: true,
        default: [] as string[],
        item: { type: 'text', label: 'SKILL 名称' },
      },
    ],
    panels: [{
      id: 'mode-rules',
      title: '按模式设置必读 SKILL',
      description: '每个模式单独开关，并从该模式已加载的 SKILL 中多选必读项；改动随本卡片的「保存」一并提交。',
      custom: true,
      // 绑定 modes 字段：面板直接编辑卡片草稿，与卡片共用一次保存与修订号。
      field: ['modes'],
      fields: [],
      operations: [{ id: catalogOperation, readOnly: true }],
    }],
  }));

  await migrateLegacy(preferences, presets?.defaultId);

  /** 技能目录的 cwd：用宿主的默认工作目录，以便包含项目级 `.dsh/skills`。 */
  const workingDirectory = loader.services.get('workingDirectory') as { readonly defaultDirectory?: unknown } | undefined;
  const cwd = typeof workingDirectory?.defaultDirectory === 'string' ? workingDirectory.defaultDirectory : undefined;

  const missingModes = new Set<string>();
  let readable: Map<string, boolean> | undefined;
  let readableFixed = false;

  /** 重新读取各模式组合里是否包含可读 SKILL 的工具。 */
  const refreshReadable = (): void => {
    try {
      const rows = presets?.inspectCompositions?.();
      if (rows === undefined) {
        readableFixed = true;
        return;
      }
      const next = new Map<string, boolean>();
      for (const row of rows) {
        next.set(row.id, (next.get(row.id) ?? false) || row.modules.some(module => skillReaders.includes(module.moduleName)));
      }
      readable = next;
      readableFixed = true;
    } catch (error) {
      console.warn(`[${id}] failed to inspect preset compositions:`, error);
      readableFixed = true;
    }
  };
  refreshReadable();

  /**
   * 该模式能否读到 SKILL 正文。无法判定时按“可以”处理，保持旧行为；
   * 明确不能读的模式跳过强制，避免把模型的所有工具调用锁死。
   */
  const canReadMode = (preset: string): boolean => {
    const known = readable?.get(preset);
    if (known !== undefined) {
      return known;
    }
    if (!missingModes.has(preset) && !readableFixed) {
      refreshReadable();
      const refreshed = readable?.get(preset);
      if (refreshed !== undefined) {
        return refreshed;
      }
    }
    missingModes.add(preset);
    return true;
  };

  /** 取该模式作用域下已加载的 SKILL；租约必须在 finally 释放。 */
  const listModeSkills = async (preset: string, signal?: AbortSignal): Promise<CatalogSkill[]> => {
    const lease = await presets?.acquireScope?.(preset);
    try {
      const skills = await ctx.skills.list({
        ...(lease === undefined ? {} : { scope: lease.key }),
        ...(cwd === undefined ? {} : { cwd }),
        ...(signal === undefined ? {} : { signal }),
      });
      return catalogSkills(skills);
    } finally {
      await releaseLease(lease);
    }
  };

  const describeMode = async (preset: PresetRow, defaultId: string | undefined, signal?: AbortSignal): Promise<CatalogMode> => {
    const isDefault = preset.id === defaultId;
    const canRead = canReadMode(preset.id);
    if (preset.broken !== undefined) {
      return { id: preset.id, ...(preset.name === undefined ? {} : { name: preset.name }), isDefault, canRead, skills: [], notice: `模式激活失败：${preset.broken}` };
    }
    const notices: string[] = [];
    if (!canRead) {
      notices.push('该模式没有可读取 SKILL 的工具（skill 或 PTC），不会强制阅读。');
    }
    let skills: CatalogSkill[] = [];
    try {
      skills = await listModeSkills(preset.id, signal);
    } catch (error) {
      notices.push(`读取技能目录失败：${error instanceof Error ? error.message : String(error)}`);
    }
    if (skills.length === 0 && notices.length === 0) {
      notices.push('该模式当前没有已加载的 SKILL，无法配置必读项。');
    }
    return {
      id: preset.id,
      ...(preset.name === undefined ? {} : { name: preset.name }),
      isDefault,
      canRead,
      skills,
      ...(notices.length === 0 ? {} : { notice: notices.join(' ') }),
    };
  };

  const catalogAll = async (signal?: AbortSignal): Promise<CatalogMode[]> => {
    missingModes.clear();
    readableFixed = false;
    refreshReadable();
    const rows = await rosterOf(presets);
    const defaultId = presets?.defaultId;
    const modes: CatalogMode[] = [];
    for (const row of rows) {
      signal?.throwIfAborted();
      modes.push(await describeMode(row, defaultId, signal));
    }
    return modes;
  };

  // 面板的只读数据源：各模式当前已加载的 SKILL。
  preferences.registerOperation(catalogOperation, async ({ signal }: CatalogOperationContext) => ({
    value: { modes: await catalogAll(signal) } as unknown as ConfigValue,
  }));

  const modeOf = (value: Preferences, preset: string | undefined): ModeSetting | undefined =>
    preset === undefined ? undefined : value.modes?.find(mode => mode.id === preset);

  /** 取本次调用应当强制阅读的 SKILL；空数组表示该模式不强制。 */
  const requiredFor = (exec: Execution, includeSkillTool = false): readonly string[] | undefined => {
    const value = preferences.get().value;
    if (!value.enabled || !exec.agent || (!includeSkillTool && exec.name === 'skill') || exec.name === 'run_code') {
      return undefined;
    }
    const preset = resolvePreset(presets, exec);
    // 无法判定预设时不拦截，避免误判锁死；模式未启用或列表为空同样不强制。
    if (preset === undefined) {
      return [];
    }
    const mode = modeOf(value, preset);
    if (mode === undefined || !mode.enabled || !canReadMode(preset)) {
      return [];
    }
    return mode.skills ?? [];
  };

  const check = (exec: Execution): string | undefined => {
    const required = requiredFor(exec);
    if (required === undefined || required.length === 0) {
      return undefined;
    }
    if (hasReadSkill(exec.agent!.session, required)) {
      return undefined;
    }
    return denialReason;
  };

  /** 取当前会话生效预设下尚未阅读的必读 SKILL；无可注入项时返回空数组。 */
  const reminderMissing = (agent: { session: SessionHistory }, preset: string | undefined): readonly string[] => {
    const value = preferences.get().value;
    if (!value.enabled) {
      return [];
    }
    const mode = modeOf(value, preset);
    if (preset === undefined || mode === undefined || !mode.enabled || !canReadMode(preset)) {
      return [];
    }
    const required = mode.skills ?? [];
    if (required.length === 0) {
      return [];
    }
    return missingSkills(agent.session, required);
  };

  // 先于权限询问拒绝调用，并在宿主的最终检查中再次执行同一规则。
  ctx.effect(() => ctx.on('tools/pre-execute', async (exec, next) => {
    const reason = check(exec);
    return reason === undefined ? next() : { kind: 'deny', reason };
  }, { prepend: true }), `${id}:check`);
  const tools = loader.services.get('tools') as Tools;
  ctx.effect(() => tools.guard(check), `${id}:guard`);

  // 紧跟宿主注入的 skill-catalog，附一条「必须先阅读」提示并列出未读的必读 SKILL。
  // agent/pre-step 是瀑布事件：后注册者的 next() 先返回裸决策，先注册者在后处理阶段才追加
  // catalog。本插件等 dshLoader 就绪后激活，注册必然晚于 tool-skill；必须用 prepend 把
  // 监听器排到链首，才能在 await next() 拿到的决策里看见 catalog 并把提醒插到其后。
  ctx.effect(() => ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next();
    if (decision.kind !== 'enter') {
      return decision;
    }
    const preset = resolvePreset(presets, { name: 'skill', agent, ctx: undefined });
    const missing = reminderMissing(agent, preset);
    if (missing.length === 0) {
      return decision;
    }
    const messages = decision.messages as readonly CatalogMessage[];
    const catalogIndex = messages.findIndex((message) => message.source?.kind === 'skill-catalog');
    if (catalogIndex === -1) {
      return decision;
    }
    const text = [
      '<system-reminder>',
      'You must read the following skill(s) with the `skill` tool before calling any other tool:',
      ...missing.map((name) => `- \`${name}\``),
      'Any one of them satisfies the requirement for this agent preset.',
      '</system-reminder>',
    ].join('\n');
    // v4 会话格式拒绝 kind: 'plugin'，要求生产者自有的 source kind（同 agent-instructions）。
    const reminder = loader.llm.createUserMessage({
      source: { kind: id, form: 'reminder' },
      content: [{ type: 'text', text }],
    });
    const injected = [...decision.messages];
    injected.splice(catalogIndex + 1, 0, reminder);
    return { ...decision, messages: injected };
  }, { prepend: true }), `${id}:catalog-reminder`);

  ctx.effect(() => ctx.on('tools/post-execute', async (exec, result, next) => {
    if (!exec.agent || !exec.parent || exec.name !== 'skill' || result.isError) {
      return next();
    }
    const required = requiredFor(exec, true);
    if (required === undefined) {
      return next();
    }
    const decision = await next();
    if (decision.kind !== 'accept' || Object.hasOwn(decision, 'value')) {
      return decision;
    }
    const content = decision.content ?? result.content;
    const skill = readSkillName(content);
    if (skill === undefined || (required.length !== 0 && !required.includes(skill))
      || hasReadSkill(exec.agent.session, required)) {
      return decision;
    }

    // PTC 的子调用结果只交给程序。附加正文后，模型可在下一步直接读取。
    const instructions = loader.llm.createUserMessage({
      source: { kind: 'skill-invocation', name: skill, form: 'instructions' },
      content,
    });
    return { ...decision, additionalContexts: [...decision.additionalContexts ?? [], instructions] };
  }), `${id}:deliver-ptc-skill`);
}

/** 把 0.1.x / 0.2.x 的旧字段合并进 modes，并清空旧字段。 */
async function migrateLegacy(
  preferences: { get(): { value: Preferences; revision: number }; update(value: Partial<Preferences>, revision?: number): Promise<unknown> },
  defaultPreset: string | undefined,
): Promise<void> {
  const snapshot = preferences.get();
  const legacy = new Map<string, string[]>();
  const collect = (modeId: string, skills: readonly string[] | undefined): void => {
    const names = (skills ?? []).filter((skill): skill is string => typeof skill === 'string' && skill.trim() !== '');
    if (names.length === 0) {
      return;
    }
    legacy.set(modeId, [...new Set([...(legacy.get(modeId) ?? []), ...names])]);
  };
  for (const [modeId, skills] of Object.entries(snapshot.value.presets ?? {})) {
    collect(modeId, Array.isArray(skills) ? skills : []);
  }
  collect(defaultPreset ?? 'standard', snapshot.value.requiredSkills);
  const stale = Object.keys(snapshot.value.presets ?? {}).length > 0 || (snapshot.value.requiredSkills?.length ?? 0) > 0;
  if (legacy.size === 0 && !stale) {
    return;
  }
  const modes = [...(snapshot.value.modes ?? [])];
  for (const [modeId, skills] of legacy) {
    const index = modes.findIndex(mode => mode.id === modeId);
    const current = index === -1 ? undefined : modes[index];
    if (current === undefined) {
      modes.push({ id: modeId, enabled: true, skills });
      continue;
    }
    modes[index] = { ...current, enabled: true, skills: [...new Set([...(current.skills ?? []), ...skills])] };
  }
  try {
    await preferences.update({ modes, presets: {}, requiredSkills: [] }, snapshot.revision);
  } catch (error) {
    console.warn(`[${id}] failed to migrate legacy settings:`, error);
  }
}
