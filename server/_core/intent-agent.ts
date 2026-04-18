/**
 * intent-agent.ts v2 — LLM 项目经理（替代意图识别）
 *
 * 不做意图分类/维度映射，让 LLM 以 tool calling 模式自主决定：
 *   - passthrough: 交给主聊天 Agent（普通对话）
 *   - dispatch_task: 分发给业务 Agent
 *   - schedule/send/channels: 平台操作
 *
 * 短消息（< 15 字且无关键词）直接 passthrough，不调 LLM。
 */
import type { StreamWriter } from "./stream-writer";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_BASE = "https://api.deepseek.com";

// ── 短消息快速过滤（不调 LLM）──
const DISPATCH_KEYWORDS = /定时|每天|每隔|提醒|发到|微信|飞书|企微|任务|渠道|信贷|债券|理财|保险|PPT|幻灯片|股票|分析|评估|报告|代码|协作/;

function needsProjectManager(msg: string): boolean {
  if (msg.length < 15 && !DISPATCH_KEYWORDS.test(msg)) return false;
  return true;
}

// ── 从 DB 加载可用 Agent 列表 ──
async function loadAgentList(): Promise<{ id: string; name: string; description: string }[]> {
  try {
    const resp = await fetch("http://127.0.0.1:5180/api/claw/business-agents", {
      headers: { "X-Internal-Key": process.env.INTERNAL_API_KEY || "lingxia-bridge-2026" },
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as any;
    return (data?.agents || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      description: (a.description || "").split("\\n\\n")[0].slice(0, 100),
    }));
  } catch { return []; }
}

// ── 项目经理 System Prompt ──
function buildPMSystemPrompt(agents: { id: string; name: string; description: string }[]): string {
  const agentList = agents.map(a => `  - ${a.id}: ${a.name} — ${a.description}`).join("\n");

  return `你是灵虾平台的项目经理。用户发来一条消息，你决定怎么处理。

你有以下工具可用：

1. passthrough — 普通对话、闲聊、简单问题、查天气、翻译等。交给主聊天 AI 处理。
2. dispatch_task — 把任务分发给专业 Agent。可以同时分发多个（并行执行）。
3. create_schedule — 创建定时任务。
4. send_message — 立即发消息到某个渠道（微信/企微/飞书）。
5. list_schedules — 查看已有定时任务。
6. delete_schedule — 删除定时任务。

可用的专业 Agent：
${agentList}

决策原则：
- 简单问题（聊天、翻译、查天气）→ passthrough
- 需要专业能力的（信贷分析、债券、PPT、代码）→ dispatch_task 到对应 Agent
- 跨领域问题 → 拆成多个 dispatch_task，每个发给不同 Agent
- 定时/提醒/推送 → create_schedule 或 send_message
- 不确定时 → passthrough（宁可不分发也不误分发）

dispatch_task 时，prompt 参数要把用户原始需求转述清楚，让目标 Agent 能独立理解和执行。`;
}

// ── Tool 定义 ──
const PM_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "passthrough",
      description: "普通对话，交给主聊天 AI 处理",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "dispatch_task",
      description: "分发任务给专业 Agent。可多次调用实现并行分发。",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "目标 Agent ID" },
          prompt: { type: "string", description: "发给该 Agent 的任务描述" },
        },
        required: ["agent_id", "prompt"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_schedule",
      description: "创建定时任务",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "任务名称" },
          task: { type: "string", description: "要执行的指令" },
          cron_expr: { type: "string", description: "Cron 表达式（分 时 日 月 周）" },
          channel: { type: "string", enum: ["conversation", "weixin", "wecom", "feishu", "webhook"], description: "推送渠道" },
        },
        required: ["name", "task", "cron_expr"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_message",
      description: "立即发消息到指定渠道",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", enum: ["weixin", "wecom", "feishu", "webhook"] },
          content: { type: "string", description: "消息内容" },
        },
        required: ["channel", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_schedules",
      description: "查看已有的定时任务",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_schedule",
      description: "删除定时任务",
      parameters: {
        type: "object",
        properties: {
          task_name: { type: "string", description: "任务名称或关键词" },
        },
        required: ["task_name"],
      },
    },
  },
];

// ── 调用项目经理 LLM ──
async function callProjectManager(
  message: string,
  agents: { id: string; name: string; description: string }[],
): Promise<{ tool: string; args: any }[]> {
  const systemPrompt = buildPMSystemPrompt(agents);

  const resp = await fetch(`${DEEPSEEK_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      tools: PM_TOOLS,
      temperature: 0,
      max_tokens: 500,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) return [{ tool: "passthrough", args: {} }];

  const data = await resp.json() as any;
  const choice = data?.choices?.[0];
  const toolCalls = choice?.message?.tool_calls;

  if (!toolCalls || toolCalls.length === 0) {
    // LLM 没调工具 → 当作 passthrough
    return [{ tool: "passthrough", args: {} }];
  }

  return toolCalls.map((tc: any) => ({
    tool: tc.function?.name || "passthrough",
    args: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
  }));
}

// ── 执行 dispatch_task: 调业务 Agent ──
async function dispatchToAgent(
  adoptId: string,
  agentId: string,
  prompt: string,
  agentName: string,
  writer: StreamWriter,
): Promise<string> {
  const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "lingxia-bridge-2026";

  try {
    const resp = await fetch("http://127.0.0.1:5180/api/claw/business-chat-stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": INTERNAL_KEY,
        "Cookie": `lingxia_session=internal_dispatch_${adoptId}`,
      },
      body: JSON.stringify({
        agentId,
        message: prompt,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!resp.ok || !resp.body) {
      writer.writeText(`\n> ${agentName} 调用失败 (${resp.status})\n`);
      return "";
    }

    // 读取 SSE 流，提取文本
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let result = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
        try {
          const d = JSON.parse(line.slice(6));
          const content = d?.choices?.[0]?.delta?.content;
          if (content) result += content;
        } catch {}
      }
    }

    return result;
  } catch (e: any) {
    writer.writeText(`\n> ${agentName} 调用超时或失败\n`);
    return "";
  }
}

// ── 主路由入口（对外接口不变）──
// 灰度发布：只对指定 adoptId 启用 PM
const PM_ENABLED_ADOPT_IDS = new Set(["lgc-ofnmjm4joj"]);

// Phase 1 强制路由：仅对特定 adoptId 生效，命中正则跳过 PM LLM 直接 dispatch
const FORCE_ROUTE_ADOPT_IDS = new Set(["lgc-ofnmjm4joj"]);
const FORCE_ROUTE_MAP: Array<{ pattern: RegExp; agentId: string }> = [
  // 顶部优先匹配，均走 Hermes（发 __hermes_tool 事件，被原生 ToolCallCard 渲染）
  // EV 理财
  { pattern: /电池|EV理财|新能源.*保险|新能源.*理财|电动车.*理财|动力电池|全损|残值|梯次利用/, agentId: "task-claim-ev" },
  // 信贷风控
  { pattern: /信贷|贷款|征信|风控|贷前调查|贷后管理|三表分析|担保物|五级分类|风险定价/, agentId: "task-credit-risk" },
  // 债券投研
  { pattern: /债券|国开债|国债|信用债|中债估值|收益率曲线|久期|违约预警/, agentId: "task-bond" },
  // 个人理财
  { pattern: /资产配置|理财规划|家庭财务|税费规划|基金.*配置|家庭.*资产/, agentId: "task-my-wealth" },
  // 深度求索 / 复杂任务拆解
  { pattern: /深度分析|深度求索|拆解.*任务|复杂.*任务|帮我规划|深度思考/, agentId: "task-trace" },
];

function matchForceRoute(message: string): { agentId: string } | null {
  for (const rule of FORCE_ROUTE_MAP) {
    if (rule.pattern.test(message)) return { agentId: rule.agentId };
  }
  return null;
}


// 旧版 L1+L2 意图路由（其他用户用这个）
async function oldRouteMessage(adoptId: string, message: string, writer: StreamWriter): Promise<boolean> {
  const OLD_PATS: [RegExp, number][] = [
    [/定时任务/, 8], [/定时/, 5], [/每天/, 4], [/每隔/, 5], [/每周/, 4],
    [/提醒我/, 5], [/cron/i, 6], [/schedule/i, 5],
    [/(?:发|推|送)(?:到|给|去)?\s*(?:我的?)?\s*(?:微信|企微|飞书|webhook)/i, 8],
    [/推送/, 4], [/发到/, 4], [/发给/, 4],
    [/(?:删除|取消|关闭|停止).*任务/, 7],
    [/(?:我的|有哪些|列出|查看).*任务/, 6], [/任务列表/, 6],
    [/哪些渠道/, 6], [/通知渠道/, 5], [/绑定.*微信/, 6],
  ];
  let score = 0;
  for (const [p, w] of OLD_PATS) { if (p.test(message)) score += w; }
  if (score < 7) return false;
  const intent = await classifyIntent(message);
  if (!intent || intent.type === "passthrough") return false;
  writer.writeText("🧠 正在理解你的需求...\n\n");
  const { executePlatformIntent } = await import("./intent-executor");
  await executePlatformIntent(adoptId, intent, writer);
  return true;
}

export async function routeMessage(
  adoptId: string,
  message: string,
  writer: StreamWriter,
): Promise<boolean> {
  // Phase 1 强制路由：特定 adoptId + 正则命中 → 跳过所有门禁直接 dispatch
  let forcedActions: { tool: string; args: any }[] | null = null;
  if (FORCE_ROUTE_ADOPT_IDS.has(adoptId)) {
    const m = matchForceRoute(message);
    if (m) {
      console.log("[FORCE-ROUTE] adoptId=" + adoptId + " -> " + m.agentId);
      forcedActions = [{ tool: "dispatch_task", args: { agent_id: m.agentId, prompt: message } }];
    }
  }

  if (!forcedActions) {
    // 灰度发布：非白名单用户走旧版 L1+L2
    if (!PM_ENABLED_ADOPT_IDS.has(adoptId)) {
      return oldRouteMessage(adoptId, message, writer);
    }

    // 短消息快速通过，不调 LLM
    if (!needsProjectManager(message)) return false;

    // L1 最小门禁：当前只放行"理财+选股"组合进 Agent Team，其他走旧版
    const hasWealth = /资产配置|理财规划|家庭财务|\d+\s*万.*(投资|配置|理财|规划)/.test(message);
    const hasStock = /选股|A股|个股|股票.*(推荐|挑|选|买)/.test(message);
    if (!(hasWealth && hasStock)) {
      console.log("[PM-L1] 未命中理财+选股组合，走旧版路由");
      return oldRouteMessage(adoptId, message, writer);
    }
    console.log("[PM-L1] 命中理财+选股组合，进 Agent Team");
    if (!DEEPSEEK_API_KEY) return false;
  }

  // 加载可用 Agent 列表
  const agents = await loadAgentList();

  // 调项目经理（强制路由时跳过）
  let actions: { tool: string; args: any }[];
  if (forcedActions) {
    actions = forcedActions;
  } else {
    try {
      actions = await callProjectManager(message, agents);
    } catch (e: any) {
      console.warn("[PM] project manager error:", e?.message?.slice(0, 80));
      return false; // 失败 → passthrough
    }
  }

  // 全是 passthrough → 交给主聊天
  if (actions.every(a => a.tool === "passthrough")) return false;

  // 收集 dispatch_task 和平台操作
  const dispatches = actions.filter(a => a.tool === "dispatch_task");
  const platformOps = actions.filter(a => a.tool !== "dispatch_task" && a.tool !== "passthrough");

  // 先执行平台操作（schedule/send 等）
  if (platformOps.length > 0) {
    const { executePlatformIntent } = await import("./intent-executor");
    for (const op of platformOps) {
      // 映射 tool name → intent type
      const typeMap: Record<string, string> = {
        create_schedule: "schedule_create",
        list_schedules: "schedule_list",
        delete_schedule: "schedule_delete",
        send_message: "send",
      };
      const intent = { type: typeMap[op.tool] || op.tool, ...op.args };
      await executePlatformIntent(adoptId, intent, writer);
    }
  }

  // Agent dispatch with tool_call cards
    // Agent Team dispatch with structured events
  if (dispatches.length > 0) {
    const agentMap = new Map(agents.map(a => [a.id, a.name]));

    // Single-agent: inline toolCall conveys status, no placeholder text.
    // Multi-agent: keep text placeholder (bubble then receives PM summary).
    const singleAgent = dispatches.length === 1;
    if (!singleAgent) {
      writer.writeText("🤖 已拆解为 " + dispatches.length + " 个子任务，并行执行中...");
    }

    // Send agent_dispatch event (frontend creates AgentTaskCards)
    const taskDefs = dispatches.map((d, i) => ({
      id: "pm_" + i + "_" + Date.now(),
      agentId: d.args.agent_id,
      name: agentMap.get(d.args.agent_id) || d.args.agent_id,
      prompt: (d.args.prompt || "").slice(0, 100),
    }));
    // Phase 1 新增：单 agent 场景发 bind_agent 事件，前端给气泡打 fromAgent 标签
    if (singleAgent) {
      writer.writeRaw({ _event: "bind_agent", agentId: taskDefs[0].agentId, agentName: taskDefs[0].name });
    }
    writer.writeRaw({ _event: "agent_dispatch", agents: taskDefs });

    // Parallel execution with event forwarding
    const startTime = Date.now();
    const results = await Promise.all(
      dispatches.map(async (d, i) => {
        const taskId = taskDefs[i].id;
        const name = agentMap.get(d.args.agent_id) || d.args.agent_id;

        // Dispatch and read SSE, forwarding tool events
        const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "lingxia-bridge-2026";
        let resolvedUserId = 0;
        try {
          const { getClawByAdoptId } = await import("../db/claw");
          const claw = await getClawByAdoptId(adoptId);
          resolvedUserId = claw?.userId || 0;
        } catch {}

        let result = "";
        const taskStartMs = Date.now();
        // FIFO stack for matching hermes tool.completed (no id) back to tool.started id
        const toolIdStack: string[] = [];
        try {
          const resp = await fetch("http://127.0.0.1:5180/api/claw/business-chat-stream", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Internal-Key": INTERNAL_KEY,
              "X-Internal-User-Id": String(resolvedUserId || 0),
            },
            body: JSON.stringify({ agentId: d.args.agent_id, message: d.args.prompt }),
            signal: AbortSignal.timeout(300000),
          });

          if (!resp.ok || !resp.body) {
            writer.writeRaw({ _event: "agent_complete", taskId, result: "调用失败 (" + resp.status + ")", durationMs: Date.now() - taskStartMs });
            return { name, result: "" };
          }

          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                const content = ev?.choices?.[0]?.delta?.content;
                if (content) {
                  result += content;
                  if (singleAgent) writer.writeText(content);
                }
                // Forward hermes tool events as openclaw-native tool_call / tool_result
                // 使用 _gateway=false 触发可折叠的 ToolCallCard（与 openclaw tool use 视觉一致）
                if (ev?.__hermes_tool === "started") {
                  const toolId = String(ev.id || `agent_tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
                  toolIdStack.push(toolId);
                  writer.writeRaw({
                    _event: "tool_call",
                    id: toolId,
                    name: String(ev.name || "tool"),
                    arguments: ev.preview ? JSON.stringify({ preview: String(ev.preview) }) : "",
                  });
                }
                if (ev?.__hermes_tool === "completed") {
                  const toolId = toolIdStack.shift() || "";
                  writer.writeRaw({
                    _event: "tool_result",
                    tool_call_id: toolId,
                    result: "",
                    is_error: Boolean(ev.is_error),
                    durationMs: Number(ev.durationMs || Math.round((ev.duration || 0) * 1000)),
                  });
                }
              } catch {}
            }
          }
        } catch (e) {
          console.warn("[PM-DISPATCH] error:", (e as Error)?.message?.slice(0, 60));
        }

        // Send agent_complete. Single-agent: result already streamed into bubble, only send status+duration.
        writer.writeRaw({ _event: "agent_complete", taskId, result: singleAgent ? "" : result.slice(0, 2000), durationMs: Date.now() - taskStartMs });
        return { name, agentId: d.args.agent_id, result };
      }),
    );

    // PM summary
    if (results.length > 1 && results.some(r => r.result)) {
      try {
        const summaryPrompt = results
          .filter(r => r.result)
          .map(r => "[" + r.name + "]:\n" + r.result.slice(0, 1500))
          .join("\n\n---\n\n");
        const summaryResp = await fetch(DEEPSEEK_BASE + "/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + DEEPSEEK_API_KEY },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
              { role: "system", content: "你是综合分析师。基于多个专业智能体的分析结果，写一份简洁的综合方案。用中文，500字内。重点突出各智能体结论的关联和综合建议。" },
              { role: "user", content: summaryPrompt },
            ],
            temperature: 0.3,
            max_tokens: 800,
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (summaryResp.ok) {
          const sd = await summaryResp.json();
          const st = sd?.choices?.[0]?.message?.content || "";
          if (st) writer.writeText("\n\n📋 **综合方案**\n\n" + st);
        }
      } catch (e) {
        console.warn("[PM] summary failed:", (e as Error)?.message?.slice(0, 60));
      }
    } else if (results.length === 1 && results[0].result) {
      writer.writeText("\n\n" + results[0].result);
    }
  }

  writer.writeEnd();
  return true;
}

// ── 兼容旧接口（策略层保留）──
export type ApprovalPolicy = "auto" | "confirm" | "review";
export function getIntentPolicy(_type: string): ApprovalPolicy { return "auto"; }
export function scorePlatformIntent(_msg: string): number { return 0; }
export async function classifyIntent(_msg: string): Promise<any> { return { type: "passthrough" }; }
