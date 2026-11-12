const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ContentBlock {
  readonly type: string;
  readonly text?: string;
}

interface ToolResultBlock extends ContentBlock {
  readonly isError?: boolean;
}

type SessionEvent =
  | { readonly type: 'step/end' }
  | { readonly type: 'compaction/end'; readonly data: { readonly error?: string } }
  | { readonly type: 'tool/call'; readonly data: { readonly name: string; readonly arguments: string } }
  | {
      readonly type: 'tool/result';
      readonly sourceEventSeqs?: readonly number[];
      readonly data: {
        readonly message: {
          readonly role: string;
          readonly isError?: boolean;
          readonly content: readonly ToolResultBlock[];
        };
      };
    }
  | {
      readonly type: 'user/message';
      readonly data: {
        readonly source: { readonly kind: string; readonly form?: string };
        readonly content: readonly ContentBlock[];
      };
    };

export interface SessionHistory {
  readonly events?: readonly SessionEvent[];
  snapshotEvents?(): readonly SessionEvent[];
}

/** 从完整的技能正文提取宿主渲染的名称。 */
export function readSkillName(content: readonly ContentBlock[]): string | undefined {
  for (const block of content) {
    if (block.type !== 'text' || !block.text?.trimEnd().endsWith('</skill_content>')) {
      continue;
    }
    const name = /^<skill_content name="([^"]+)">\r?\n/.exec(block.text)?.[1];
    if (name !== undefined && skillNamePattern.test(name)) {
      return name;
    }
  }
  return undefined;
}

/** 查找最近一次成功压缩后已交付给模型的技能读取结果。 */
export function hasReadSkill(session: SessionHistory, requiredSkills: readonly string[]): boolean {
  return missingSkills(session, requiredSkills).length === 0;
}

/** 列出尚未阅读的必读技能；requiredSkills 为空（任意一个即可）时无法枚举未读项，返回空数组。 */
export function missingSkills(session: SessionHistory, requiredSkills: readonly string[]): readonly string[] {
  if (requiredSkills.length === 0) {
    return [];
  }
  return hasReadSkillInternal(session, requiredSkills) ? [] : requiredSkills;
}

function hasReadSkillInternal(session: SessionHistory, requiredSkills: readonly string[]): boolean {
  const events = session.snapshotEvents?.() ?? session.events ?? [];
  let previousStep = false;

  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.type === 'compaction/end' && event.data.error === undefined) {
      return false;
    }
    if (event.type === 'step/end') {
      previousStep = true;
      continue;
    }

    let name: string | undefined;
    if (event.type === 'user/message' && event.data.source.kind === 'skill-invocation'
      && event.data.source.form === 'instructions') {
      name = readSkillName(event.data.content);
    } else if (previousStep && event.type === 'tool/result') {
      const callSeq = event.sourceEventSeqs?.[0];
      const call = callSeq === undefined ? undefined : events[callSeq];
      if (call?.type !== 'tool/call' || call.data.name !== 'skill') {
        continue;
      }
      const message = event.data.message;
      const result = message.role === 'tool' ? message : message.content[0];
      if (result?.isError !== false) {
        continue;
      }
      // DSH 可能将长正文写入溢出文件。成功结果确认读取，原始调用保留技能名称。
      try {
        const args: { name?: unknown } | null = JSON.parse(call.data.arguments);
        if (typeof args?.name === 'string' && skillNamePattern.test(args.name)) {
          name = args.name;
        }
      } catch {
        continue;
      }
    }
    if (name !== undefined && (requiredSkills.length === 0 || requiredSkills.includes(name))) {
      return true;
    }
  }
  return false;
}
