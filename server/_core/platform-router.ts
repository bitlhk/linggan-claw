/**
 * platform-router.ts — 平台意图路由器
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

const PLATFORM_KEYWORDS: [RegExp, number][] = [
  // 定时类
  [/定时任务/, 8], [/定时/, 5], [/每天/, 4], [/每隔/, 5], [/每周/, 4],
  [/每\d+(?:分钟|小时|天)/, 5], [/工作日/, 4], [/提醒我/, 5],
  [/cron/i, 6], [/schedule/i, 5],
  // 通知/渠道类
  [/微信/, 4], [/飞书/, 4], [/企业微信/, 4], [/企微/, 4],
  [/webhook/i, 4], [/推送/, 4], [/发到/, 4], [/发给/, 4], [/发我/, 4],
  // 任务管理类
  [/删除.*任务/, 7], [/取消.*任务/, 7], [/关闭.*任务/, 7], [/停止.*任务/, 7],
  [/我的.*任务/, 6], [/有哪些.*任务/, 6], [/列出.*任务/, 6], [/任务列表/, 6],
  [/修改.*任务/, 6], [/暂停.*任务/, 6], [/启用.*任务/, 6],
  // 渠道管理
  [/绑定.*微信/, 6], [/解绑/, 5], [/哪些渠道/, 6], [/通知渠道/, 5],
  // 组合模式（时间+频率 = 强定时信号）
  [/(?:每天|每周|工作日).{0,10}(?:\d{1,2}[点时:：])/, 7],
  [/(?:每隔|每)\s*\d+\s*(?:分钟|小时)/, 6],
  // 动作修饰（单独不够，配合上面的）
  [/查/, 1], [/搜/, 1], [/看/, 1], [/分析/, 1], [/汇报/, 2], [/报告/, 1],
];

const SCORE_THRESHOLD = 7;
const SCORE_HIGH_CONFIDENCE = 12; // 高置信度：L2 失败也走平台

export function scorePlatformIntent(msg: string): number {
  let score = 0;
  for (const [pattern, weight] of PLATFORM_KEYWORDS) {
    if (pattern.test(msg)) score += weight;
  }
  return score;
}

// ═══════════════════════════════════════════════════════
// L2: DeepSeek 意图分类
// ═══════════════════════════════════════════════════════

const INTENT_SYSTEM_PROMPT = `你是灵虾平台的意图分类器。用户消息可能是普通聊天，也可能是平台操作指令。

只返回一个 JSON，不要返回其他内容。

创建定时任务：{"type":"schedule_create","name":"简短名称","task":"要执行的具体指令","cron_expr":"cron表达式(分 时 日 月 周)","channel":"推送渠道"}
查询定时任务：{"type":"schedule_list"}
删除定时任务：{"type":"schedule_delete","task_name":"任务名或关键词"}
立即发消息：{"type":"send","channel":"渠道","content":"内容"}
查询渠道：{"type":"channels_query"}
普通聊天/AI任务：{"type":"passthrough"}

渠道：微信=weixin，企业微信=wecom，飞书=feishu，主聊天=conversation
cron：每天10点半=30 10 * * *，工作日9点=0 9 * * 1-5，每30分钟=*/30 * * * *
最小间隔30分钟。`;

export async function classifyIntent(message: string): Promise<any> {
  if (!DEEPSEEK_API_KEY) return { type: "passthrough" };
  try {
    const resp = await fetch(`${DEEPSEEK_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: INTENT_SYSTEM_PROMPT },
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

  // L2: DeepSeek 分类
  writer.writeText("🧠 正在理解你的需求...\n\n");
  const intent = await classifyIntent(message);

  // L2 失败或判定 passthrough
  if (!intent || intent.type === "passthrough") {
    if (score >= SCORE_HIGH_CONFIDENCE) {
      // L1 高分但 L2 失败（DeepSeek 挂了）→ 提示用户重试
      writer.writeText("⚠️ 意图识别暂时不可用，请稍后重试或在侧边栏手动操作。\n");
      writer.writeEnd();
      return true;
    }
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

  // auto: 直接执行
  const { executePlatformIntent } = await import("./platform-intent");
  await executePlatformIntent(adoptId, intent, writer);
  return true;
}
