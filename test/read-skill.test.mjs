import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultsFor } from '@dsh-plugin/dsh-loader/config';
import { apply } from '../lib/index.js';

const denied = { kind: 'deny', reason: 'You must read those skills that you should read.' };
const allowed = { kind: 'allow' };
const catalog = ['alpha', 'beta', 'bar', 'example', 'foo'];

const registry = {
  defaultId: 'standard',
  list: async () => [
    { id: 'standard', name: '标准', order: 1 },
    { id: 'ptc', name: 'PTC', order: 2 },
    { id: 'minimal', name: '极简', order: 3 },
  ],
  presetForSession: session => session.preset ?? null,
};

async function mount({ preset = 'standard', seed } = {}) {
  const listeners = new Map();
  const events = [];
  const services = {
    tools: { guard: listener => { services.guardListener = listener; } },
    agentPresets: registry,
  };
  let value;
  const updates = [];
  const handle = {
    get: () => ({ value, revision: updates.length }),
    update: async (next, revision) => {
      assert.equal(revision, updates.length);
      value = { ...value, ...next };
      updates.push(next);
      return { value, revision: updates.length };
    },
  };
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
    skills: { list: async () => catalog.map(name => ({ name })) },
    effect: setup => setup(),
    on: (event, listener) => listeners.set(event, listener),
  });
  const session = { preset, snapshotEvents: () => events };
  const agent = { session };
  const exec = overrides => ({ name: 'read', agent, ...overrides });
  return {
    events,
    updates,
    get value() { return value; },
    agent,
    check: (name = 'read', overrides) => listeners.get('tools/pre-execute')(exec({ name, ...overrides }), async () => allowed),
    guard: (name = 'read') => services.guardListener(exec({ name })),
    finishSkill: (result, parent) => listeners.get('tools/post-execute')(
      { name: 'skill', agent, parent }, result, async () => ({ kind: 'accept' }),
    ),
    preStep: (messages, next) => listeners.get('agent/pre-step')({ agent, messages, signal: new AbortController().signal }, next),
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

test('按默认预设分组要求阅读，成功读取后放行到下一次成功压缩', async () => {
  const { events, value, check, guard } = await mount();
  value.presets.standard = ['example'];
  assert.deepEqual(await check('read'), denied);
  assert.equal(guard('read'), denied.reason);
  assert.deepEqual(await check('skill'), allowed);

  readSkill(events, 'example', true);
  events.push({ type: 'step/end' });
  assert.deepEqual(await check('read'), denied);

  readSkill(events, 'example', false);
  assert.deepEqual(await check('read'), denied);
  events.push({ type: 'step/end' });
  assert.deepEqual(await check('read'), allowed);
  events.push({ type: 'compaction/end', data: { error: 'example' } });
  assert.deepEqual(await check('read'), allowed);
  events.push({ type: 'compaction/end', data: {} });
  assert.deepEqual(await check('read'), denied);
});

test('列表匹配任一名称，配置保存后立即生效', async () => {
  const { events, value, check } = await mount();
  value.presets.standard = ['foo', 'bar'];
  readSkill(events, 'example', false, 'user');
  events.push({ type: 'step/end' });
  assert.deepEqual(await check('read'), denied);
  readSkill(events, 'bar', false, 'user');
  events.push({ type: 'step/end' });
  assert.deepEqual(await check('read'), allowed);

  value.presets.standard = ['foo'];
  assert.deepEqual(await check('read'), denied);
  value.enabled = false;
  assert.deepEqual(await check('read'), allowed);
});

test('会话预设取用对应分组，其他分组互不影响', async () => {
  const { events, value, check } = await mount({ preset: 'ptc' });
  value.presets.standard = ['alpha'];
  value.presets.ptc = ['beta'];
  assert.deepEqual(await check('read'), denied);
  readSkill(events, 'alpha', false);
  events.push({ type: 'step/end' });
  assert.deepEqual(await check('read'), denied);
  readSkill(events, 'beta', false);
  events.push({ type: 'step/end' });
  assert.deepEqual(await check('read'), allowed);
});

test('分组留空或未配置时不强制阅读', async () => {
  const { value, check } = await mount({ preset: 'minimal' });
  assert.deepEqual(await check('read'), allowed);
  value.presets.minimal = [];
  assert.deepEqual(await check('read'), allowed);
});

test('无法解析预设时回退默认预设；注册表缺失时放行', async () => {
  const { value, check } = await mount({ preset: null });
  value.presets.standard = ['alpha'];
  assert.deepEqual(await check('read'), denied);

  const listeners = new Map();
  let plainValue;
  const plainServices = { tools: { guard: () => () => {} } };
  await apply({
    dshLoader: {
      config: {
        register(_ctx, template) {
          plainValue = defaultsFor(template.fields);
          return { get: () => ({ value: plainValue, revision: 0 }), update: async () => ({ value: plainValue, revision: 0 }) };
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
  plainValue.presets.standard = ['alpha'];
  assert.deepEqual(await listeners.get('tools/pre-execute')(exec, async () => allowed), allowed);
});

test('PTC 在正文进入会话后放行其他工具', async () => {
  const { events, value, check, finishSkill } = await mount({ preset: 'ptc' });
  value.presets.ptc = ['example'];
  const parent = {};
  assert.deepEqual(await check('run_code'), allowed);
  const content = [{ type: 'text', text: '<skill_content name="example">\nExample instructions.\n</skill_content>' }];
  const decision = await finishSkill({ isError: false, content }, parent);
  assert.deepEqual(decision.additionalContexts?.[0]?.content, content);
  assert.deepEqual(await check('read', { parent }), denied);
  events.push({ type: 'user/message', data: decision.additionalContexts[0] });
  assert.deepEqual(await check('read', { parent }), allowed);
});

test('旧版 requiredSkills 迁移进默认预设分组并清空旧字段', async () => {
  const { value, updates, check } = await mount({ seed: { requiredSkills: ['foo'] } });
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].presets, { standard: ['foo'], ptc: [], minimal: [] });
  assert.deepEqual(updates[0].requiredSkills, []);
  assert.deepEqual(value.presets.standard, ['foo']);
  assert.deepEqual(await check('read'), denied);
});

test('紧跟 skill-catalog 注入未读必读 SKILL 提示，读齐后不再注入', async () => {
  const { events, value, preStep } = await mount();
  value.presets.standard = ['foo', 'bar'];
  const catalog = { id: 'c1', role: 'user', source: { kind: 'skill-catalog' }, content: [] };
  const prior = { id: 'c0', role: 'user', source: { kind: 'user' }, content: [] };
  const base = { kind: 'enter', messages: [prior, catalog] };

  // 未读时：在 catalog 之后插入提示，列出未读 SKILL。
  const withReminder = await preStep(base.messages, async () => base);
  assert.equal(withReminder.kind, 'enter');
  assert.equal(withReminder.messages.length, 3);
  assert.equal(withReminder.messages[1], catalog);
  const reminder = withReminder.messages[2];
  assert.equal(reminder.source.kind, 'dsh-force-read-skill');
  const text = reminder.content[0].text;
  assert.match(text, /must read the following skill/);
  assert.match(text, /`foo`/);
  assert.match(text, /`bar`/);

  // 已读其一后：放行，不再注入。
  readSkill(events, 'bar', false);
  events.push({ type: 'step/end' });
  const clean = await preStep(base.messages, async () => base);
  assert.deepEqual(clean.messages, base.messages);

  // 无 catalog 消息时不注入；决策非 enter 时透传。
  const noCatalog = { kind: 'enter', messages: [prior] };
  const noCatalogOut = await preStep(noCatalog.messages, async () => noCatalog);
  assert.equal(noCatalogOut.messages.length, 1);
  const rejected = { kind: 'reject' };
  assert.deepEqual(await preStep(base.messages, async () => rejected), rejected);
});
