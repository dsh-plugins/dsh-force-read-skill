/**
 * 客户端入口：注册“按模式设置必读 SKILL”管理面板。
 *
 * 只做注册，不挂载任何全局 DOM；`ctx.effect` 保证插件卸载或热重载时回收注册。
 *
 * @module dsh-force-read-skill/client
 */
import { ModeRulesPanel } from './ModeRulesPanel.js';

export const name = '@dsh-plugin/dsh-force-read-skill';
export const inject = ['dshLoaderUi'];

/** 最小的客户端上下文表面：Cordis 的 effect 与 loader 的 UI 服务。 */
interface ClientContext {
  dshLoaderUi: {
    config: {
      registerPanel(owner: ClientContext, options: {
        id: string;
        configId: string;
        component: typeof ModeRulesPanel;
      }): () => void;
    };
  };
  effect(fn: () => (() => void) | void): unknown;
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.dshLoaderUi.config.registerPanel(ctx, {
    id: 'mode-rules',
    configId: 'dsh-force-read-skill',
    component: ModeRulesPanel,
  }));
}
