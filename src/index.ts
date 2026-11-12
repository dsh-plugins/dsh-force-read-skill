import type { CordisContext, HostAPI } from '@dsh-plugin/dsh-loader';
import { defineConfig, type ConfigField } from '@dsh-plugin/dsh-loader/config';
import { hasReadSkill, readSkillName, type ContentBlock, type SessionHistory } from './history.js';

export const name = '@dsh-plugin/dsh-force-read-skill';
export const inject = ['dshLoader', 'tools', 'skills'];

const id = 'dsh-force-read-skill';
const denialReason = 'You must read those skills that you should read.';

interface Preferences {
  enabled: boolean;
  /** 0.1.x 旧字段；注册后迁移进 presets，守卫不再读取。 */
  requiredSkills?: string[];
  /** 每个预设独立的必读列表；缺省或空数组 = 该预设不强制阅读。 */
  presets: Record<string, string[]>;
}

interface AgentPresets {
  readonly defaultId?: string;
  list(): readonly { readonly id: string; readonly name?: string; readonly order?: number }[];
  presetForSession?(session: unknown): string | null;
  composedPreset?(ctx: unknown): string | undefined;
}

interface Skills {
  list(options?: { readonly scope?: unknown }): Promise<readonly { readonly name: string }[]>;
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

type PreDecision =
  | { readonly kind: 'allow' | 'cancel' }
  | { readonly kind: 'ask'; readonly reason?: string }
  | { readonly kind: 'deny'; readonly reason: string };

type PostDecision =
  | { readonly kind: 'accept'; readonly content?: readonly ContentBlock[]; readonly value?: unknown; readonly additionalContexts?: readonly unknown[] }
  | { readonly kind: 'block'; readonly feedback: readonly ContentBlock[] };

interface PluginContext extends CordisContext {
  readonly dshLoader: HostAPI;
  readonly skills: Skills;
  on(event: 'tools/pre-execute', listener: (exec: Execution, next: () => Promise<PreDecision>) => Promise<PreDecision>, options?: { prepend?: boolean }): () => void;
  on(event: 'tools/post-execute', listener: (exec: Execution, result: Result, next: () => Promise<PostDecision>) => Promise<PostDecision>): () => void;
}

/** 读取注册表中的预设清单；服务缺失时退化为仅标准分组。 */
function rosterOf(presets: AgentPresets | undefined): readonly { id: string; name?: string }[] {
  try {
    const roster = presets?.list() ?? [];
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

/** 注册阅读要求，并在工具请求进入权限检查前执行校验。 */
export async function apply(ctx: PluginContext): Promise<void> {
  const loader = ctx.dshLoader;
  const presets = loader.services.get('agentPresets') as AgentPresets | undefined;
  const roster = rosterOf(presets);
  const catalog = await ctx.skills.list().catch((error: unknown) => {
    console.warn(`[${id}] skill catalog unavailable, falling back to empty options:`, error);
    return [] as readonly { name: string }[];
  });
  const options = [...new Set(catalog.map(skill => skill.name))].sort()
    .map(skill => ({ label: skill, value: skill }));

  const presetFields: ConfigField[] = options.length === 0 ? [] : roster.map(preset => ({
    type: 'multiselect',
    key: preset.id,
    label: preset.name ?? preset.id,
    description: '读取其中任意一个即可。留空时该预设不强制阅读 SKILL。选项为当前已加载的 SKILL；新增的 SKILL 重启后才会出现在选项中。',
    default: [] as string[],
    options,
  }));

  const preferences = await loader.config.register<Preferences>(ctx, defineConfig({
    id,
    packageName: name,
    title: '强制阅读 SKILL',
    fields: [
      { type: 'boolean', key: 'enabled', label: '强制阅读 SKILL', default: true },
      {
        type: 'object',
        key: 'presets',
        label: '按预设指定必读 SKILL',
        description: '每个预设（模式）独立配置必读 SKILL；守卫按当前会话生效的预设取用对应列表。',
        collapsible: true,
        fields: presetFields,
      },
    ],
  }));

  // 迁移 0.1.x 的平铺 requiredSkills：合并进默认预设分组并清空旧字段。
  const snapshot = preferences.get();
  const legacy = snapshot.value.requiredSkills;
  if (Array.isArray(legacy) && legacy.length !== 0) {
    const defaultPreset = presets?.defaultId ?? 'standard';
    try {
      await preferences.update({
        presets: {
          ...snapshot.value.presets,
          [defaultPreset]: [...new Set([...(snapshot.value.presets?.[defaultPreset] ?? []), ...legacy])],
        },
        requiredSkills: [],
      }, snapshot.revision);
    } catch (error) {
      console.warn(`[${id}] failed to migrate legacy requiredSkills:`, error);
    }
  }

  const requiredFor = (exec: Execution, includeSkillTool = false): readonly string[] | undefined => {
    const value = preferences.get().value;
    if (!value.enabled || !exec.agent || (!includeSkillTool && exec.name === 'skill') || exec.name === 'run_code') {
      return undefined;
    }
    const preset = resolvePreset(presets, exec);
    // 无法判定预设时不拦截，避免误判锁死；分组缺省或为空表示不强制。
    if (preset === undefined) {
      return [];
    }
    return value.presets?.[preset] ?? [];
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

  // 先于权限询问拒绝调用，并在宿主的最终检查中再次执行同一规则。
  ctx.effect(() => ctx.on('tools/pre-execute', async (exec, next) => {
    const reason = check(exec);
    return reason === undefined ? next() : { kind: 'deny', reason };
  }, { prepend: true }), `${id}:check`);
  const tools = loader.services.get('tools') as Tools;
  ctx.effect(() => tools.guard(check), `${id}:guard`);

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
