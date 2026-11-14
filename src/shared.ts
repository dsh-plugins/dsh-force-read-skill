/**
 * 宿主端与客户端共享的纯类型：只做类型导入，运行时不会被打包进任一侧。
 *
 * @module dsh-force-read-skill/shared
 */

/** 一个模式（Agent 预设）的强制阅读设置。 */
export interface ModeSetting {
  /** 模式 ID，取自 agent 预设注册表。 */
  id: string;
  /** 该模式是否强制先读 SKILL。 */
  enabled: boolean;
  /** 必读 SKILL 名称；读取其中任意一个即可。 */
  skills: string[];
}

/** 菜单里的一项 SKILL。 */
export interface CatalogSkill {
  /** Kebab-case 技能名，也是 `skill` 工具的参数。 */
  name: string;
  /** 技能自述，仅用于菜单提示。 */
  description?: string;
}

/** 面板渲染一个模式所需的全部信息。 */
export interface CatalogMode {
  /** 模式 ID。 */
  id: string;
  /** 展示名；缺省时回落到 ID。 */
  name?: string;
  /** 是否为注册表的默认模式。 */
  isDefault: boolean;
  /** 该模式组合里存在可读 SKILL 的工具；false 时不会强制阅读。 */
  canRead: boolean;
  /** 该模式作用域下已加载、且模型可调用的 SKILL。 */
  skills: readonly CatalogSkill[];
  /** 不可用或没有可选项时的说明。 */
  notice?: string;
}

/** `catalog` 只读操作的返回结构。 */
export interface CatalogPayload {
  modes: readonly CatalogMode[];
}
