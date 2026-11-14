import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultsFor } from '@dsh-plugin/dsh-loader/config';
import { apply } from '../lib/index.js';

const denied = { kind: 'deny', reason: 'You must read those skills that you should read.' };
const allowed = { kind: 'allow' };

/** 每个模式可见的技能目录；用于验证选项按模式作用域取，而不是全局并集。 */
const scoped = {
  standard: ['alpha', 'bar', 'example', 'foo'],
  ptc: ['alpha', 'beta', 'example'],
  minimal: [],
};
const catalog = ['alpha', 'beta', 'bar', 'example', 'foo'];

const registry = {
  defaultId: 'standard',
  list: async () => [
    { id: 'standard', name: '标准', order: 1 },
    { id: 'ptc', name: 'PTC', order: 2 },
    { id: 'minimal', name: '极简', order: 3 },
  ],
  presetForSession: session => session.preset ?? null,
  // standard/PTC 能读 SKILL，极简没有 skill 工具。
  inspectCompositions: () => [
    { id: 'standard', modules: [{ moduleName: '@deepseek-ai/dsh-tool-skill' }] },
    { id: 'ptc', modules: [{ moduleName: '@deepseek-ai/dsh-tool-skill' }, { moduleName: '@deepseek-ai/dsh-tool-executor-ptc' }] },
    { id: 'minimal', modules: [{ moduleName: '@deepseek-ai/dsh-tool-fs' }] },
  ],
  acquireScope: async id => {
    if (!(id in scoped)) {
      throw new Error(`Unknown agent preset: ${id}`);
    }
    return { key: { preset: id }, [Symbol.asyncDispose]: async () => {} };
  },
};

async function mount({ preset = 'standard', seed, presets = registry } = {}) {
  const listeners = new Map();
  const events = [];
  const services = {
    tools: { guard: listener => { services.guardListener = listener; } },
    agentPresets: presets,
  };
  let value;
  const updates = [];
  const operations = new Map();
  const handle = {
    get: () => ({ value, revision: updates.length }),
    update: async (next, revision) => {
      assert.equal(revision, updates.length);
      value = { ...value, ...next };
      updates.push(next);
      return { value, revision: updates.length };
    },
    registerOperation: (id, handler) => {
      operations.set(id, handler);
      return () => operations.delete(id);
    },
  };
  const releases = [];
  await apply({
    dshLoader: {
      config: {
        register(_ctx, template) {
          value = { ...defaultsFor(template.fields), ...seed };
          return handle;
        },
      },
      services: { get: name => services[name] },
      llm: { createUserMessage: message => message },
    },
    skills: {
      list: async options => {
        const id = options?.scope?.preset;
        // 按模式作用域取目录；没有作用域时返回全局目录。
        return (id === undefined ? catalog : scoped[id] ?? []).map(name => ({ name }));
      },
    },
    effect: setup => setup(),
    on: (event, listener) => listeners.set(event, listener),
  });
  // 面板操作需要等到 apply 内部注册完成；上面 apply 已 await，可直接取。
  const session = { preset, snapshotEvents: () => events };
  const agent = { session };
  const exec = overrides => ({ name: 'read', agent, ...overrides });
  return {
    events,
    updates,
    operations,
    get value() { return value; },
    agent,
    check: (name = 'read', overrides) => listeners.get('tools/pre-execute')(exec({ name, ...overrides }), async () => allowed),
    guard: (name = 'read') => services.guardListener(exec({ name })),
    finishSkill: (result, parent) => listeners.get('tools/post-execute')(
      { name: 'skill', agent, parent }, result, async () => ({ kind: 'accept' }),
    ),
    preStep: (messages, next) => listeners.get('agent/pre-step')({ agent, messages, signal: new AbortController().signal }, next),
    catalog: async () => (await operations.get('catalog')({ input: {}, config: { value, revision: updates.length }, signal: new AbortController().signal })).value,
  };
}

function readSkill(events, name, isError, role = 'tool') {
  const sourceEventSeqs = [events.length];
  const message = role === 'tool' ? { role, isError } : { role, content: [{ type: 'tool-result', isError }] };
  events.push(
    { type: 'tool/call', data: { name: 'skill', arguments: JSON.stringify({ name }) } },
    { type: 'tool/result', sourceEventSeqs, data: { message } },
  );
}

test('按模式开关：关闭该模式后不拦截，其他模式不受影响', async () => {
  const { events, value, check, guard } = await mount();
  value.modes = [
    { id: 'standard', enabled: true, skills: ['example'] },
    { id: 'ptc', enabled: false, skills: ['example'] },
  ];
  assert.deepEqual(await check('read'), denied);
  assert.equal(guard('read'), denied.reason);
  assert.deepEqual(await check('skill'), allowed);

  readSkill(events, 'example', false);
  events.push({ type: 'step/end' });
  assert.deepEqual(await check('read'), allowed);
});

test('模式未启用时不拦截，即使配置了必读列表', async () => {
  const { value, check } = await mount({ preset: 'ptc' });
  value.modes = [
    { id: 'standard', enabled: true, skills: ['alpha'] },
    { id: 'ptc', enabled: false, skills: ['beta'] },
  ];
  assert.deepEqual(await check('read'), allowed);
});

test('总开关关闭后所有模式都不拦截', async () => {
  const { value, check } = await mount();
  value.modes = [{ id: 'standard', enabled: true, skills: ['alpha'] }];
  assert.deepEqual(await check('read'), denied);
  value.enabled = false;
  assert.deepEqual(await check('read'), allowed);
});

test('模式开启但列表为空时不拦截', async () => {
  const { value, check } = await mount();
  value.modes = [{ id: 'standard', enabled: true, skills: [] }];
  assert.deepEqual(await check('read'), allowed);
});

test('列表匹配任一名称，成功后放行到下一次成功压缩', async () => {
  const { events, value, check } = await mount();
  value.modes = [{ id: 'standard', enabled: true, skills: ['foo', 'bar'] }];
  assert.deepEqual(await check('read'), denied);
  readSkill(events, 'example', false);
  events.push({ type: 'step/end' });
  assert.deepEqual(await check('read'), denied);
  readSkill(events, 'bar', false);
  events.push({ type: 'step/end' });
  assert.deepEqual(await check('read'), allowed);
  events.push({ type: 'compaction/end', data: { error: 'x' } });
  assert.deepEqual(await check('read'), allowed);
  events.push({ type: 'compaction/end', data: {} });
  assert.deepEqual(await check('read'), denied);
});

test('没有 skill 工具的模式（极简）跳过拦截', async () => {
  const { value, check } = await mount({ preset: 'minimal' });
  value.modes = [{ id: 'minimal', enabled: true, skills: ['alpha'] }];
  assert.deepEqual(await check('read'), allowed);
});

test('无法解析预设时放行；注册表缺失时退化为标准分组', async () => {
  const { value, check } = await mount({ preset: null });
  value.modes = [{ id: 'standard', enabled: true, skills: ['alpha'] }];
  assert.deepEqual(await check('read'), denied);

  const listeners = new Map();
  let plainValue;
  const plainServices = { tools: { guard: () => () => {} } };
  await apply({
    dshLoader: {
      config: {
        register(_ctx, template) {
          plainValue = defaultsFor(template.fields);
          return {
            get: () => ({ value: plainValue, revision: 0 }),
            update: async () => ({ value: plainValue, revision: 0 }),
            registerOperation: () => () => {},
          };
        },
      },
      services: { get: name => plainServices[name] },
      llm: { createUserMessage: message => message },
    },
    skills: { list: async () => catalog.map(name => ({ name })) },
    effect: setup => setup(),
    on: (event, listener) => listeners.set(event, listener),
  });
  const exec = { name: 'read', agent: { session: { snapshotEvents: () => [] } } };
  plainValue.modes = [{ id: 'standard', enabled: true, skills: ['alpha'] }];
  assert.deepEqual(await listeners.get('tools/pre-execute')(exec, async () => allowed), allowed);
});

test('PTC 在正文进入会话后放行其他工具', async () => {
  const { events, value, check, finishSkill } = await mount({ preset: 'ptc' });
  value.modes = [{ id: 'ptc', enabled: true, skills: ['example'] }];
  const parent = {};
  assert.deepEqual(await check('run_code'), allowed);
  const content = [{ type: 'text', text: '<skill_content name="example">\nExample instructions.\n</skill_content>' }];
  const decision = await finishSkill({ isError: false, content }, parent);
  assert.deepEqual(decision.additionalContexts?.[0]?.content, content);
  assert.deepEqual(await check('read', { parent }), denied);
  events.push({ type: 'user/message', data: decision.additionalContexts[0] });
  assert.deepEqual(await check('read', { parent }), allowed);
});

test('旧版 requiredSkills 与 presets 迁移进 modes 并清空旧字段', async () => {
  const { value, updates, check } = await mount({
    seed: { requiredSkills: ['foo', 'bar'], presets: { ptc: ['beta'], standard: ['bar'] } },
  });
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].modes, [
    { id: 'ptc', enabled: true, skills: ['beta'] },
    { id: 'standard', enabled: true, skills: ['bar', 'foo'] },
  ]);
  assert.deepEqual(updates[0].requiredSkills, []);
  assert.deepEqual(updates[0].presets, {});
  assert.deepEqual(value.modes.find(mode => mode.id === 'standard').skills, ['bar', 'foo']);
  assert.deepEqual(await check('read'), denied);
});

test('catalog 按模式作用域列出已加载 SKILL，并标记能否读取', async () => {
  const { catalog } = await mount();
  const { modes } = await catalog();
  assert.deepEqual(modes.map(mode => mode.id), ['standard', 'ptc', 'minimal']);
  assert.deepEqual(modes[0].skills.map(skill => skill.name), ['alpha', 'bar', 'example', 'foo']);
  assert.deepEqual(modes[1].skills.map(skill => skill.name), ['alpha', 'beta', 'example']);
  assert.deepEqual(modes[2].skills, []);
  assert.equal(modes[0].canRead, true);
  assert.equal(modes[1].canRead, true);
  assert.equal(modes[2].canRead, false);
  assert.equal(modes[0].isDefault, true);
  assert.match(modes[2].notice, /没有已加载的 SKILL|不会强制阅读/);
});

test('catalog 释放每个模式的租约，未知模式只标记该模式', async () => {
  const released = [];
  const scopedPresets = {
    ...registry,
    list: async () => [
      { id: 'standard', name: '标准' },
      { id: 'ghost', name: '幽灵' },
    ],
    acquireScope: async id => {
      released.push(id);
      if (id === 'ghost') {
        throw new Error('Unknown agent preset: ghost');
      }
      return { key: { preset: id }, [Symbol.asyncDispose]: async () => { released.push(`dispose:${id}`); } };
    },
  };
  const { catalog } = await mount({ presets: scopedPresets });
  const { modes } = await catalog();
  assert.deepEqual(modes.map(mode => mode.id), ['standard', 'ghost']);
  assert.deepEqual(released, ['standard', 'dispose:standard', 'ghost']);
  assert.match(modes[1].notice, /读取技能目录失败/);
  assert.deepEqual(modes[0].skills.map(skill => skill.name), ['alpha', 'bar', 'example', 'foo']);
});

test('紧跟 skill-catalog 注入未读必读 SKILL 提示，读齐后不再注入', async () => {
  const { events, value, preStep } = await mount();
  value.modes = [{ id: 'standard', enabled: true, skills: ['foo', 'bar'] }];
  const catalogMessage = { id: 'c1', role: 'user', source: { kind: 'skill-catalog' }, content: [] };
  const prior = { id: 'c0', role: 'user', source: { kind: 'user' }, content: [] };
  const base = { kind: 'enter', messages: [prior, catalogMessage] };

  const withReminder = await preStep(base.messages, async () => base);
  assert.equal(withReminder.kind, 'enter');
  assert.equal(withReminder.messages.length, 3);
  assert.equal(withReminder.messages[1], catalogMessage);
  const reminder = withReminder.messages[2];
  assert.equal(reminder.source.kind, 'dsh-force-read-skill');
  const text = reminder.content[0].text;
  assert.match(text, /must read the following skill/);
  assert.match(text, /`foo`/);
  assert.match(text, /`bar`/);

  readSkill(events, 'bar', false);
  events.push({ type: 'step/end' });
  const clean = await preStep(base.messages, async () => base);
  assert.deepEqual(clean.messages, base.messages);

  const noCatalog = { kind: 'enter', messages: [prior] };
  const noCatalogOut = await preStep(noCatalog.messages, async () => noCatalog);
  assert.equal(noCatalogOut.messages.length, 1);
  const rejected = { kind: 'reject' };
  assert.deepEqual(await preStep(base.messages, async () => rejected), rejected);
});
