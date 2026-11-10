import type { CordisContext, HostAPI } from '@dsh-plugin/dsh-loader';
import { defineConfig } from '@dsh-plugin/dsh-loader/config';
import { hasReadSkill, readSkillName, type ContentBlock, type SessionHistory } from './history.js';

export const name = '@dsh-plugin/dsh-force-read-skill';
export const inject = ['dshLoader', 'tools'];

const id = 'dsh-force-read-skill';
const denialReason = 'You must read those skills that you should read.';

interface Preferences {
  enabled: boolean;
  requiredSkills: string[];
}

interface Execution {
  readonly name: string;
  readonly agent?: { readonly session: SessionHistory };
  readonly parent?: object;
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
  on(event: 'tools/pre-execute', listener: (exec: Execution, next: () => Promise<PreDecision>) => Promise<PreDecision>, options?: { prepend?: boolean }): () => void;
  on(event: 'tools/post-execute', listener: (exec: Execution, result: Result, next: () => Promise<PostDecision>) => Promise<PostDecision>): () => void;
}

/** 注册阅读要求，并在工具请求进入权限检查前执行校验。 */
export async function apply(ctx: PluginContext): Promise<void> {
  const loader = ctx.dshLoader;
  const preferences = await loader.config.register<Preferences>(ctx, defineConfig({
    id,
    packageName: name,
    title: '强制阅读 SKILL',
    fields: [
      { type: 'boolean', key: 'enabled', label: '强制阅读 SKILL', default: true },
      {
        type: 'array',
        key: 'requiredSkills',
        label: '指定 SKILL',
        description: '读取其中任意一个即可。留空时可读取任意 SKILL。',
        default: [],
        item: { type: 'text', label: 'SKILL 名称', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
      },
    ],
  }));

  const check = (exec: Execution): string | undefined => {
    const { enabled, requiredSkills } = preferences.get().value;
    if (!enabled || !exec.agent || exec.name === 'skill' || exec.name === 'run_code') {
      return undefined;
    }
    if (hasReadSkill(exec.agent.session, requiredSkills)) {
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
    const { enabled, requiredSkills } = preferences.get().value;
    if (!enabled) {
      return next();
    }
    const decision = await next();
    if (decision.kind !== 'accept' || Object.hasOwn(decision, 'value')) {
      return decision;
    }
    const content = decision.content ?? result.content;
    const skill = readSkillName(content);
    if (skill === undefined || (requiredSkills.length !== 0 && !requiredSkills.includes(skill))
      || hasReadSkill(exec.agent.session, requiredSkills)) {
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
