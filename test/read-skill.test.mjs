import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultsFor } from '@dsh-plugin/dsh-loader/config';
import { apply } from '../lib/index.js';

const denied = { kind: 'deny', reason: 'You must read those skills that you should read.' };
const allowed = { kind: 'allow' };

async function mount() {
  const listeners = new Map();
  const events = [];
  let guard;
  let value;
  await apply({
    dshLoader: {
      config: {
        register(_ctx, template) {
          value = defaultsFor(template.fields);
          return { get: () => ({ value }) };
        },
      },
      services: {
        get: () => ({ guard: listener => { guard = listener; } }),
      },
      llm: {
        createUserMessage: message => message,
      },
    },
    effect: setup => setup(),
    on: (event, listener) => listeners.set(event, listener),
  });
  const agent = { session: { snapshotEvents: () => events } };
  return {
    events,
    value,
    check: (name, parent) => listeners.get('tools/pre-execute')({ name, agent, parent }, async () => allowed),
    guard: name => guard({ name, agent }),
    finishSkill: (result, parent) => listeners.get('tools/post-execute')(
      { name: 'skill', agent, parent }, result, async () => ({ kind: 'accept' }),
    ),
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

test('成功读取后放行到下一次成功压缩', async () => {
  const { events, check, guard } = await mount();
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
  value.requiredSkills = ['foo', 'bar'];
  readSkill(events, 'example', false, 'user');
  events.push({ type: 'step/end' });
  assert.deepEqual(await check('read'), denied);
  readSkill(events, 'bar', false, 'user');
  events.push({ type: 'step/end' });
  assert.deepEqual(await check('read'), allowed);

  value.requiredSkills = ['foo'];
  assert.deepEqual(await check('read'), denied);
  value.enabled = false;
  assert.deepEqual(await check('read'), allowed);
});

test('PTC 在正文进入会话后放行其他工具', async () => {
  const { events, check, finishSkill } = await mount();
  const parent = {};
  assert.deepEqual(await check('run_code'), allowed);
  const content = [{ type: 'text', text: '<skill_content name="example">\nExample instructions.\n</skill_content>' }];
  const decision = await finishSkill({ isError: false, content }, parent);
  assert.deepEqual(decision.additionalContexts[0].content, content);
  assert.deepEqual(await check('read', parent), denied);
  events.push({ type: 'user/message', data: decision.additionalContexts[0] });
  assert.deepEqual(await check('read', parent), allowed);
});
