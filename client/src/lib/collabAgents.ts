/**
 * COLLAB_AGENTS — 主聊天 + 协作 ChatBox 共享的"专业助手"规则匹配
 *
 * 用法：在 chat 流程里检测用户输入 → matchCollabAgent(text) → 命中后弹推荐卡片
 *      点击卡片可跳到 CollabDrawer 对应 task panel（写 sessionStorage("collab_prefill")）
 *
 * 演示前 5 条规则，对应 5 个常见专业场景。新增请追加，pattern 用 i 标志。
 */

export interface CollabAgent {
  pattern: RegExp;
  id: string;       // task-xxx 业务 agent id（business_agents.id）
  name: string;     // 显示名
  emoji: string;    // 卡片头部 icon
}

export const COLLAB_AGENTS: CollabAgent[] = [
  { pattern: /HTML.*幻灯片|网页.*演示|slides/i,                                          id: "task-slides",      name: "灵匠 · 幻灯片（HTML）",       emoji: "🎨" },
  { pattern: /PPT|幻灯片|演示文稿|路演.*材料|做个.*演示/i,                                id: "task-ppt",         name: "灵匠 · 幻灯片（PPT）",        emoji: "📊" },
  { pattern: /股票分析|选股|个股.*分析|K线|技术面.*分析|股票助手/i,                         id: "task-stock",       name: "灵犀 · 股票分析",             emoji: "📈" },
  { pattern: /理赔|车险|定损|全损|残值|动力电池|新能源.*保险|电动车.*理赔|梯次利用/i,        id: "task-claim-ev",    name: "灵犀 · EV 理赔决策助手",      emoji: "🔋" },
  { pattern: /信贷|贷款|征信|风控|贷前调查|贷后管理|三表分析|担保物|五级分类|风险定价/i,     id: "task-credit-risk", name: "灵犀 · 智贷决策助手",         emoji: "🏦" },
];

/**
 * 在文本里查找命中的专业助手
 * @returns 命中的 agent 或 null
 */
export function matchCollabAgent(text: string): CollabAgent | null {
  return COLLAB_AGENTS.find((a) => a.pattern.test(text)) || null;
}

/**
 * 推荐卡片的 markdown 内容
 */
export function buildCollabSuggestionMd(agent: CollabAgent): string {
  return `> 💡 **检测到专业需求，推荐使用：**\n>\n> ${agent.emoji} **${agent.name}**\n>\n> _点击下方按钮打开助手，或选择继续在主对话中处理。_`;
}
