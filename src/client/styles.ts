/**
 * 面板样式：与 dsh-loader 的 `dshl-` 类并列，统一 `dfrs-` 前缀，
 * 颜色全部走 shell 主题变量，跟随深浅色。
 *
 * @module dsh-force-read-skill/client/styles
 */
export const PANEL_CSS = `
.dfrs-panel{display:flex;flex-direction:column;gap:12px;min-width:0;font:inherit}
.dfrs-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.dfrs-toolbar .dfrs-grow{flex:1 1 auto;min-width:0}
.dfrs-status{margin:0;color:var(--dsw-alias-label-secondary,GrayText);font-size:12px}
.dfrs-alert{margin:0;color:var(--dsw-alias-status-danger,#d33);font-size:12px;overflow-wrap:anywhere}
.dfrs-notice{margin:0;padding:6px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-1,#8881);color:var(--dsw-alias-label-secondary,GrayText);font-size:12px}
.dfrs-modes{display:flex;flex-direction:column;gap:10px}
.dfrs-mode{border:1px solid var(--dsw-alias-border-l2,#8884);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-width:0}
.dfrs-mode[data-muted=true]{opacity:.72}
.dfrs-mode-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dfrs-mode-name{font-weight:600;overflow-wrap:anywhere}
.dfrs-mode-id{color:var(--dsw-alias-label-tertiary,GrayText);font-size:12px}
.dfrs-badge{padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#8884);color:var(--dsw-alias-label-secondary,GrayText);font-size:11px;line-height:18px}
.dfrs-mode-body{display:flex;flex-direction:column;gap:6px;min-width:0}
.dfrs-select{display:flex;flex-direction:column;gap:6px;min-width:0;max-width:520px}
.dfrs-filter{box-sizing:border-box;width:100%;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:6px;background:var(--dsw-alias-bg-base,Canvas);color:inherit;font:inherit;font-size:12px}
.dfrs-trigger{display:flex;align-items:center;gap:8px;justify-content:space-between;box-sizing:border-box;width:100%;min-height:32px;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#8881);color:inherit;font:inherit;text-align:left;cursor:pointer}
.dfrs-trigger:disabled{opacity:.5;cursor:default}
.dfrs-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,Highlight);outline-offset:-2px}
.dfrs-trigger-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dfrs-trigger-text[data-empty=true]{color:var(--dsw-alias-label-tertiary,GrayText)}
.dfrs-trigger-caret{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary,GrayText)}
.dfrs-opt{display:flex;flex-direction:column;gap:2px;min-width:0;text-align:left}
.dfrs-opt-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dfrs-opt-desc{color:var(--dsw-alias-label-tertiary,GrayText);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px}
.dfrs-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.dfrs-actions .dfrs-grow{flex:1 1 auto}
.dfrs-picked{display:flex;flex-wrap:wrap;gap:4px;min-width:0}
.dfrs-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#8884);font-size:12px}
.dfrs-chip button{border:0;background:transparent;color:inherit;cursor:pointer;padding:0;font:inherit;line-height:1;opacity:.7}
.dfrs-chip button:hover{opacity:1}
`;
