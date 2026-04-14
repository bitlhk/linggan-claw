/**
 * intent-agent.ts — Intent Agent（意图识别 + 路由 + 策略）
 * 
 * L1: 关键词打分（本地，0ms）→ 过滤普通聊天
 * L2: DeepSeek 意图分类（仅 L1 命中时调用）
 * 
 * 返回 true = 已处理，false = 交给 Agent
 */
import type { StreamWriter } from "./stream-writer";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_BASE = "https://api.deepseek.com";

// ═══════════════════════════════════════════════════════
// L1: 关键词打分
// ═══════════════════════════════════════════════════════

// L1 打分器：通用意图模式（不绑定具体 Agent，无需随业务变化维护）
const INTENT_PATTERNS: [RegExp, number][] = [
  // ── 调度意图（定时/周期/提醒）──
  [/定时任务/, 8],
  [/(?:每天|每周|工作日).{0,10}(?:\d{1,2}[点时:：])/, 7],  // "每天10点" 强信号
  [/(?:每隔|每)\s*\d+\s*(?:分钟|小时|天)/, 7],            // "每30分钟" 强信号
  [/定时/, 5], [/每天/, 4], [/每隔/, 5], [/每周/, 4],
  [/提醒我/, 5], [/提醒.{0,6}(?:开会|吃药|打卡|提交|汇报|出发)/, 7], [/cron/i, 6], [/schedule/i, 5],
  // ── 通知意图（发送/推送到渠道）──
  [/(?:发|推|送)(?:到|给|去)?\s*(?:我的?)?\s*(?:微信|企[微业]微信|飞书|webhook)/i, 8],  // "发到微信" 强信号
  [/推送/, 4], [/发到/, 4], [/发给/, 4],
  // ── 任务管理意图（增删查改）──
  [/(?:删除|取消|关闭|停止|暂停|启用|修改).*任务/, 7],
  [/(?:我的|有哪些|列出|查看).*任务/, 6], [/任务列表/, 6],
  // ── 渠道管理意图 ──
  [/哪些渠道/, 6], [/通知渠道/, 5], [/绑定.*微信/, 6], [/解绑/, 5],
  // ── 任务派发意图（"帮我做/生成/分析" — 可能需要专业 Agent）──
  [/帮我.{0,4}(?:做|生成|写|制作|画)/, 5],
  [/(?:能不能|可以|请).{0,4}(?:帮|做|生成|制作)/, 4],
  // ── 弱信号修饰词（单独不够分，配合上面的）──
  [/查/, 1], [/搜/, 1], [/分析/, 1],
];

const SCORE_THRESHOLD = 7;
const SCORE_HIGH_CONFIDENCE = 12; // 高置信度：L2 失败也走平台

export function scorePlatformIntent(msg: string): number {
  let score = 0;
  for (const [pattern, weight] of INTENT_PATTERNS) {
    if (pattern.test(msg)) score += weight;
  }
  return score;
}

// ═══════════════════════════════════════════════════════
// L2: DeepSeek 意图分类
// ═══════════════════════════════════════════════════════

const INTENT_BASE_PROMPT = `你是灵虾平台的 Intent Agent（意图分类器）。分析用户消息，判断是平台操作还是普通对话。

只返回一个 JSON，不要返回其他内容。

【平台操作类型】
创建定时任务：{"type":"schedule_create","name":"简短名称","task":"要执行的具体指令","cron_expr":"cron表达式(分 时 日 月 周)","channel":"推送渠道"}
查询定时任务：{"type":"schedule_list"}
删除定时任务：{"type":"schedule_delete","task_name":"任务名或关键词"}
立即发消息：{"type":"send","channel":"渠道","content":"内容"}
查询渠道：{"type":"channels_query"}
打开专业助手：{"type":"open_agent","agent_id":"助手ID","prefill":"用户原始需求"}
普通对话/AI任务：{"type":"passthrough"}

【渠道】微信=weixin，企业微信=wecom，飞书=feishu，主聊天=conversation
【cron】每天10点半=30 10 * * *，工作日9点=0 9 * * 1-5，每30分钟=*/30 * * * *（最小间隔30分钟）

【路由规则】
- 简单问题（查股价、聊天、翻译、问天气）→ passthrough
- 明确提到某类专业助手 → open_agent
- 判断不了 → passthrough（宁可不路由也不误路由）`;

/** 从 DB 加载可用 Agent 列表，拼入 prompt */
async function buildIntentPrompt(): Promise<string> {
  let agentSection = "";
  try {
    const resp = await fetch("http://127.0.0.1:5180/api/claw/business-agents", {
      headers: { "X-Internal-Key": process.env.INTERNAL_API_KEY || "lingxia-bridge-2026" },
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) {
      const data = await resp.json() as any;
      const agents = Array.isArray(data?.agents) ? data.agents : [];
      if (agents.length > 0) {
        agentSection = "\n\n【可用的专业助手】\n" +
          agents.map((a: any) => `- ${a.id}: ${a.name} — ${(a.description || "").slice(0, 60)}`).join("\n") +
          "\n\n当用户需求明确匹配某个助手的能力时，返回 open_agent。";
      }
    }
  } catch {}
  return INTENT_BASE_PROMPT + agentSection;
}

export async function classifyIntent(message: string): Promise<any> {
  if (!DEEPSEEK_API_KEY) return { type: "passthrough" };
  try {
    const systemPrompt = await buildIntentPrompt();
    const resp = await fetch(`${DEEPSEEK_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        temperature: 0,
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════
// 策略层（P0: 全部 auto，接口预留）
// ═══════════════════════════════════════════════════════

export type ApprovalPolicy = "auto" | "confirm" | "review";

const INTENT_POLICIES: Record<string, ApprovalPolicy> = {
  schedule_create: "auto",
  schedule_list:   "auto",
  schedule_delete: "auto",
  channels_query:  "auto",
  send:            "auto",
};

export function getIntentPolicy(intentType: string): ApprovalPolicy {
  return INTENT_POLICIES[intentType] || "auto";
}

// ═══════════════════════════════════════════════════════
// 主路由入口
// ═══════════════════════════════════════════════════════

/**
 * 尝试将消息路由到平台层处理。
 * @returns true = 已处理（调用方不要再转 Agent），false = 不是平台意图（交给 Agent）
 */
export async function routeMessage(
  adoptId: string,
  message: string,
  writer: StreamWriter,
): Promise<boolean> {
  const score = scorePlatformIntent(message);
  if (score < SCORE_THRESHOLD) return false;

  // L2: DeepSeek 分类（不提前写提示，等确认是平台意图后再写）
  const intent = await classifyIntent(message);

  // L2 失败或判定 passthrough
  if (!intent || intent.type === "passthrough") {
    // L1 高分但 L2 失败/passthrough → 回退给 Agent（不阻断用户对话）
    // 之前的做法是 return true 阻断，但这会导致普通聊天被吃掉
    // L1 低分 + L2 passthrough → 不是平台操作，回退给 Agent
    // 关键：不能吃掉消息！返回 false 让调用方转发给 Agent
    return false;
  }

  // 策略检查（P0 全部 auto）
  const policy = getIntentPolicy(intent.type);
  if (policy === "confirm") {
    // P1: 确认模式，先存 pending intent，返回确认卡片
    writer.writeText("⚠️ 此操作需要确认（功能开发中）\n");
    writer.writeEnd();
    return true;
  }
  if (policy === "review") {
    writer.writeText("⚠️ 此操作需要管理员审批（功能开发中）\n");
    writer.writeEnd();
    return true;
  }

  // auto: 确认是平台意图后再提示
  writer.writeText("🧠 正在理解你的需求...\n\n");
  const { executePlatformIntent } = await import("./intent-executor");
  await executePlatformIntent(adoptId, intent, writer);
  return true;
}
