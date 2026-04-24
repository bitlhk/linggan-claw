import express from "express";
import http from "http";
import { existsSync, readdirSync, statSync } from "fs";
import { clawChatLimiter } from "./security";
import { routeTool, type ToolContext } from "./tool_router";
import { buildChatRequestBody, type PermissionProfile } from "./tool_schema";
import {
  requireClawOwner, resolveRuntimeAgentId, appendLogAsync,
  readSessionEpoch, bumpSessionEpoch, lookupSessionRegistry,
  upsertSessionRegistry, clearAgentSessionsCache, isPrivateUrl, APP_ROOT
} from "./helpers";
import { ResponseAccumulator } from "./response-accumulator";
// 2026-04-18: eager import 避免首次 HTTP 聊天冷启动挂死（配合 claw-ws-proxy 保持一致）
import { SseStreamWriter } from "./stream-writer";
import { routeMessage } from "./intent-agent";

export function registerChatStreamRoutes(app: express.Express) {

  // POST /api/claw/chat-stream  { adoptId, message }
  // 直连 Gateway /v1/chat/completions SSE，用 Node http 模块透传（避免 fetch 缓冲问题）
  app.post("/api/claw/chat-stream", clawChatLimiter, async (req, res) => {
    const routeEnterMs = Date.now();
    let { adoptId, message, model, pendingToolContext, epochLabel } = req.body || {};
    if (!adoptId || !message) {
      res.status(400).json({ error: "adoptId and message required" });
      return;
    }

    // 内部 bridge 调用跳过 auth（通过 X-Internal-Key 头）
    const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "lingxia-bridge-2026";
    let claw: any;
    if (req.headers["x-internal-key"] === INTERNAL_KEY) {
      const { getClawByAdoptId } = await import("../db");
      claw = await getClawByAdoptId(String(adoptId));
      if (!claw) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    } else {
      claw = await requireClawOwner(req, res, String(adoptId));
      if (!claw) return;
    }

    // ── Hermes runtime 分叉（lgh-*）────────────────────────────────
    // 仅影响 adoptId 前缀为 "lgh-" 的请求；lgc-* 代码路径 byte-identical
    if (String(adoptId).startsWith("lgh-")) {
      const msgStrForHermes = String(message || "").slice(0, 4000);
      if (msgStrForHermes.trim().length === 0) {
        res.status(400).json({ error: "message is empty" });
        return;
      }
      const { forwardToHermes } = await import("./hermes-bridge");
      await forwardToHermes(
        {
          adoptId: String(claw.adoptId),
          agentId: String(claw.agentId),
          userId: Number(claw.userId),
          hermesPort: (claw as any).hermesPort ?? null,
        },
        msgStrForHermes,
        res,
        {
          // 不传 sessionId 让 bridge 用 makeSessionId(adoptId) 生成固定 session_id
          // 这样跨请求 Hermes state.db 的 conversation history 累积
          model,
          req,  // 传 req 让 bridge 监听 close 事件做 upstream abort
        },
      );
      return;
    }

    // 安全校验：agentId 必须符合预期格式，防止 shell 注入
    const AGENT_ID_RE = /^trial_lgc-[a-z0-9]{4,30}$/;
    if (!AGENT_ID_RE.test(String(claw.agentId || ""))) {
      res.status(400).json({ error: "invalid agent" });
      return;
    }

    // 安全校验：message 长度限制（二次确认，防绕过）
    const msgStr = String(message || "").slice(0, 4000);
    if (msgStr.trim().length === 0) {
      res.status(400).json({ error: "message is empty" });
      return;
    }

    const isSessionResetCmd = ["/new", "/reset"].includes(msgStr.trim());
    if (isSessionResetCmd) {
      // 用 OpenClaw 原生 sessions.reset RPC 重置会话
      // 这样 session key 不变（agent:xxx:main），但内部 sessionId 换了，上下文清空
      // 不需要前端断 WS 重连，HTTP 和 WS 路径自动同步
      try {
        const dbAgentId = String((claw as any).agentId || "").trim();
        const trialAgentId = `trial_${String(adoptId)}`;
        const remoteHomeReset = process.env.CLAW_REMOTE_OPENCLAW_HOME || "/root";
        const trialAgentDirReset = `${remoteHomeReset}/.openclaw/agents/${trialAgentId}`;
        const runtimeAgentIdReset = existsSync(trialAgentDirReset) ? trialAgentId : dbAgentId;
        const sessionKeyReset = `agent:${runtimeAgentIdReset}:main`;

        const { execFileSync } = await import("child_process");
        const remoteHostReset = process.env.CLAW_REMOTE_HOST || "127.0.0.1";
        const gatewayPortReset = parseInt(process.env.CLAW_GATEWAY_PORT || "18789", 10);
        const gatewayTokenReset = process.env.CLAW_GATEWAY_TOKEN || "";

        execFileSync("openclaw", [
          "gateway", "call", "sessions.reset",
          "--url", `ws://${remoteHostReset}:${gatewayPortReset}`,
          "--token", gatewayTokenReset,
          "--params", JSON.stringify({ key: sessionKeyReset, reason: "new" }),
          "--json",
        ], { timeout: 8000, encoding: "utf8" });

        // 同时也升级灵虾的 epoch（保留向后兼容，老的注册表机制还在用）
        const epoch = bumpSessionEpoch(String(adoptId));
        res.status(200).json({ ok: true, reset: true, epoch, sessionKey: sessionKeyReset });
        return;
      } catch (e: any) {
        console.error("[reset] failed:", e?.message || e);
        res.status(500).json({ error: "reset failed: " + (e?.message || String(e)) });
        return;
      }
    }

    // /help command: return help text locally
    if (msgStr.trim().toLowerCase() === "/help" || msgStr.trim().toLowerCase() === "/commands") {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      const helpText = "## \u53ef\u7528\u547d\u4ee4\n\n" +
        "| \u547d\u4ee4 | \u8bf4\u660e |\n|---|---|\n" +
        "| `/help` | \u67e5\u770b\u53ef\u7528\u547d\u4ee4 |\n" +
        "| `/status` | \u67e5\u770b\u5f53\u524d\u72b6\u6001 |\n" +
        "| `/tools` | \u67e5\u770b\u53ef\u7528\u5de5\u5177 |\n" +
        "| `/model` | \u5207\u6362\u6a21\u578b |\n" +
        "| `/dreaming status` | \u67e5\u770b\u68a6\u5883\u8bb0\u5fc6\u72b6\u6001 |\n" +
        "| `/context` | \u67e5\u770b\u4e0a\u4e0b\u6587\u4fe1\u606f |\n" +
        "| `/usage` | \u67e5\u770b\u7528\u91cf\u7edf\u8ba1 |\n" +
        "| `/whoami` | \u67e5\u770b\u5f53\u524d\u8eab\u4efd |\n" +
        "| `/new` | \u5f00\u542f\u65b0\u4f1a\u8bdd |\n" +
        "| `/reset` | \u91cd\u7f6e\u4f1a\u8bdd\u4e0a\u4e0b\u6587 |\n" +
        "| `/think` | \u6df1\u5ea6\u601d\u8003\u6a21\u5f0f |\n" +
        "| `/fast` | \u5feb\u901f\u6a21\u5f0f |\n" +
        "| `/compact` | \u538b\u7f29\u4e0a\u4e0b\u6587 |\n" +
        "| `/tasks` | \u67e5\u770b\u4efb\u52a1\u5217\u8868 |\n\n" +
        "> \ud83d\udca1 \u4e5f\u53ef\u4ee5\u76f4\u63a5\u7528\u81ea\u7136\u8bed\u8a00\u8ddf\u6211\u5bf9\u8bdd\uff0c\u6211\u4f1a\u81ea\u52a8\u8c03\u7528\u5408\u9002\u7684\u5de5\u5177\u3002";
      const chunk = { choices: [{ delta: { content: helpText }, index: 0 }] };
      res.write("data: " + JSON.stringify(chunk) + "\n\n");
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // /dreaming 命令拦截
    const dreamingMatch = msgStr.trim().match(/^\/dreaming(?:\s+(status|on|off|help))?$/);
    if (dreamingMatch) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
      try {
        const dbAgentId = String((claw as any).agentId || "").trim();
        const trialAgentId = `trial_${String(adoptId)}`;
        const remoteHome = process.env.CLAW_REMOTE_OPENCLAW_HOME || "/root";
        const trialAgentDir = `${remoteHome}/.openclaw/agents/${trialAgentId}`;
        const runtimeAgentId = existsSync(trialAgentDir) ? trialAgentId : dbAgentId;
        const { execSync } = await import("child_process");
        const raw = execSync("openclaw memory status --json 2>/dev/null || openclaw memory status 2>/dev/null", { timeout: 8000, encoding: "utf8" });
        let agentBlock = "";
        try {
          const parsed = JSON.parse(raw);
          const agents = Array.isArray(parsed) ? parsed : parsed?.agents ?? [];
          const entry = agents.find((e: any) => e.agentId === runtimeAgentId);
          if (entry) {
            const dr = entry.dreaming || {};
            const lines = [
              "\ud83c\udf19 **Dreaming \u72b6\u6001** (" + runtimeAgentId + ")\n",
              "- \u72b6\u6001: " + (dr.enabled ? "\u2705 \u5df2\u542f\u7528" : "\u274c \u672a\u542f\u7528"),
            ];
            if (dr.frequency) lines.push("- \u9891\u7387: `" + dr.frequency + "`");
            lines.push("- \u77ed\u671f\u8bb0\u5fc6: " + (entry.recallStore?.entries ?? 0) + " \u6761");
            lines.push("- \u5df2\u63d0\u5347: " + (entry.recallStore?.promoted ?? 0) + " \u6761");
            lines.push("- \u7d22\u5f15: " + (entry.indexed?.files ?? 0) + "/" + (entry.indexed?.totalFiles ?? 0) + " \u6587\u4ef6");
            lines.push("\n\ud83d\udca1 \u68a6\u5883\u7cfb\u7edf\u6bcf\u5929\u51cc\u6668 3:00 \u81ea\u52a8\u8fd0\u884c\uff0c\u5c06\u77ed\u671f\u8bb0\u5fc6\u63d0\u70bc\u4e3a\u957f\u671f\u8bb0\u5fc6\u3002");
            agentBlock = lines.join("\n");
          }
        } catch {
          // fallback: parse text output
          const blocks = raw.split("\n\n");
          const matched = blocks.find((b: string) => b.includes(runtimeAgentId));
          agentBlock = matched ? matched.trim() : raw.slice(0, 800);
        }
        if (!agentBlock) agentBlock = "\u672a\u627e\u5230\u5f53\u524d\u4ee3\u7406\u7684\u8bb0\u5fc6\u72b6\u6001\u3002\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002";
        const chunk = { choices: [{ delta: { content: agentBlock }, index: 0 }] };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        res.write("data: [DONE]\n\n");
      } catch (e: any) {
        const errChunk = { choices: [{ delta: { content: "\u67e5\u8be2 Dreaming \u72b6\u6001\u5931\u8d25: " + (e?.message || "unknown") }, index: 0 }] };
        res.write(`data: ${JSON.stringify(errChunk)}\n\n`);
        res.write("data: [DONE]\n\n");
      }
      res.end();
      return;
    }

    // ── 斜杠命令白名单：非白名单的 / 开头消息去掉斜杠再透传 ──
    const ALLOWED_SLASH = new Set([
      "/help", "/commands", "/status", "/tools",
      "/whoami", "/id", "/context", "/usage", "/tasks",
      "/dreaming",
      "/new", "/reset",
      "/think", "/fast", "/stop", "/compact",
      "/btw",
      "/model",
    ]);
    const trimmedMsg = msgStr.trim();
    if (trimmedMsg.startsWith("/")) {
      const slashCmd = trimmedMsg.split(/\s/)[0].toLowerCase();
      if (!ALLOWED_SLASH.has(slashCmd)) {
        // 非白名单斜杠命令：去掉开头的 / 再透传，避免触发 Gateway 原生命令
        appendLogAsync("claw-blocked-slash.log", {
          ts: new Date().toISOString(),
          adoptId: String(adoptId),
          userId: Number((claw as any).userId || 0),
          blocked: slashCmd,
          original: trimmedMsg.slice(0, 200),
        });
        // 将 /xxx 转为普通文本透传，用户不受影响
        message = trimmedMsg.slice(1);
      }
    }

    // SSRF 防护：拦截 message 里直接包含内网 URL 的尝试
    const urlPattern = /https?:\/\/([^\s"'<>]+)/gi;
    const urlMatches = msgStr.match(urlPattern) || [];
    for (const u of urlMatches) {
      if (isPrivateUrl(u)) {
        res.status(400).json({ error: "不支持访问内网地址" });
        return;
      }
    }

    // 最小执行审计：记录谁在什么子虾上发起了什么请求（消息截断）
    appendLogAsync("claw-exec.log", {
      ts: new Date().toISOString(),
      event: "chat_stream_request",
      adoptId: String(adoptId),
      agentId: String((claw as any).agentId || ""),
      userId: Number((claw as any).userId || 0),
      permissionProfile: String((claw as any).permissionProfile || "starter"),
      message: String(message || "").slice(0, 500),
    });


    const remoteHost = process.env.CLAW_REMOTE_HOST || "127.0.0.1";
    const remoteHome = process.env.CLAW_REMOTE_OPENCLAW_HOME || "/root";
    // ── 平台意图路由：打分 → 分类 → 执行（统一 StreamWriter）──
    {
      const sseWriter = new SseStreamWriter(res);
      sseWriter.init();
      const handled = await routeMessage(String(adoptId), msgStr, sseWriter);
      if (handled) return;
      // 未命中：继续走 Agent，但 SSE headers 已发，后续 Gateway 代理不需要再发
    }

    const gatewayPort = parseInt(process.env.CLAW_GATEWAY_PORT || "18789", 10);
    const gatewayToken = process.env.CLAW_GATEWAY_TOKEN || "";
    const rawProfile = String((claw as any).permissionProfile || "starter");
    const permissionProfile: PermissionProfile =
      rawProfile === "plus" || rawProfile === "internal" ? rawProfile : "starter";

    // 前端传入的模型 ID，白名单校验后通过 x-openclaw-model header 生效
    const ALLOWED_CLAW_MODELS = new Set(["glm5/glm-5", "glm5/glm-5.1", "deepseek/deepseek-chat", "maas/deepseek-v4-flash", "deepseek/deepseek-v4-pro"]);
    const reqModel = (typeof model === "string" && model.trim()) ? model.trim() : "";
    const backendModel = (reqModel && ALLOWED_CLAW_MODELS.has(reqModel)) ? reqModel : "";

    // 品牌配置：从 DB 读取 AI 身份
    let brandSystemPrompt: string | undefined;
    try {
      const { getBrandConfig } = await import("./brand");
      const brand = await getBrandConfig();
      brandSystemPrompt = brand.systemPrompt;
    } catch {}

    // Phase 2 方案 D：如果上一轮是 agent 回复，用户端传来 pendingToolContext
    //   将之注入 gateway messages 数组，openclaw 可读到 agent 结论做 follow-up
    const body = JSON.stringify(
      buildChatRequestBody({
        message,
        permissionProfile,
        brandSystemPrompt,
        pendingToolContext: pendingToolContext && typeof pendingToolContext === "object"
          ? {
              agentName: String(pendingToolContext.agentName || "agent").slice(0, 64),
              content: String(pendingToolContext.content || "").slice(0, 8000),
            }
          : null,
      })
    );
    if (pendingToolContext && typeof pendingToolContext === "object") {
      console.log("[CTX-INJECT] adoptId=" + adoptId + " agentName=" + String(pendingToolContext.agentName || "").slice(0, 40) + " contentLen=" + String(pendingToolContext.content || "").length);
    }

    // DEBUG: 验证 tools 是否注入
    try {
      const bodyParsed = JSON.parse(body);
      console.log("[DEBUG] tools in body:", JSON.stringify(bodyParsed.tools || 'none'));
      console.log("[DEBUG] permissionProfile:", permissionProfile);
    } catch(e) {}

    const startedAt = Date.now();
    const gatewayRequestStartMs = Date.now();
    let upstreamFirstChunkMs: number | null = null;
    let upstreamBytes = 0;
    let upstreamPreview = "";

    // SSE 响应头（intent-agent 可能已设过，重复设置无害）
    if (!res.headersSent) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
    }
    res.write(`data: ${JSON.stringify({ __perf: { routeEnterMs, gatewayRequestStartMs } })}\n\n`);

    // ── 平台级记忆：缓冲响应用于偏好提取 ──
    const chatUserId = Number((claw as any).userId || 0);
    const memAcc = new ResponseAccumulator(chatUserId, 'main-chat', msgStr);

    // 用 Node 原生 http 模块直接管道，零缓冲
    const httpMod = await import("http");
        const epoch = readSessionEpoch(String(adoptId));
        const dbAgentId = String((claw as any).agentId || "").trim();
        const trialAgentId = `trial_${String(adoptId)}`;
        const trialAgentDir = `${remoteHome}/.openclaw/agents/${trialAgentId}`;
        const runtimeAgentId = existsSync(trialAgentDir) ? trialAgentId : dbAgentId;

        // ── Session key 计算 ─────────────────────────────────────────
        // 三种来源：
        //   1) epochLabel（显式 label 隔离，协作子任务/会话嵌入场景用）
        //      → sessionKey = agent:{agent}:main:{safeLabel}，不走 registry，每次稳定
        //      → 跟主聊天的 e{epoch} 物理隔离，不污染主聊天 sandbox/记忆
        //   2) 注册表命中（epoch 复用已存在的 session key）
        //   3) 数字 epoch fallback（标准主聊天路径）
        let sessionKey: string;
        if (epochLabel && typeof epochLabel === "string" && epochLabel.trim().length > 0) {
          const safeLabel = epochLabel.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
          sessionKey = `agent:${runtimeAgentId}:main:${safeLabel}`;
        } else {
          const found = lookupSessionRegistry(String(adoptId), runtimeAgentId, epoch);
          if (found) {
            sessionKey = found;
          } else {
            // 关键修复：epoch 变更后必须使用新 session key，避免复用旧上下文
            // epoch=0 保持历史兼容；epoch>0 使用分代 key 实现真正"新会话"
            sessionKey = epoch > 0
              ? `agent:${runtimeAgentId}:main:e${epoch}`
              : `agent:${runtimeAgentId}:main`;
            upsertSessionRegistry(String(adoptId), runtimeAgentId, sessionKey, epoch);
          }
        }

const options = {
      hostname: remoteHost,
      port: gatewayPort,
      path: "/v1/chat/completions",
      method: "POST",
      timeout: 0,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "Authorization": `Bearer ${gatewayToken}`,
        "x-openclaw-agent-id": runtimeAgentId,
        "x-openclaw-session-key": sessionKey,
        ...(backendModel ? { "x-openclaw-model": backendModel } : {}),
      },
    };

    // ── 工具代理层：拦截高危 tool_call，走 routeTool ────────────────
    const remoteHomeLocal = process.env.CLAW_REMOTE_OPENCLAW_HOME || "/root";
    const toolCtx: ToolContext = {
      adoptId: String(adoptId),
      agentId: runtimeAgentId,
      userId: Number((claw as any).userId || 0),
      permissionProfile: String((claw as any).permissionProfile || "starter") as ToolContext["permissionProfile"],
      sessionKey,
      workspaceDir: `${remoteHomeLocal}/.openclaw/workspace-${runtimeAgentId}`,
      sendEvent: (event: string, data: object) => writeEvent(event, data),  // 传入 SSE 写函数，供 routeTool 发送进度事件
    };
    const suppressedToolResults = new Set<string>();
    let lastSSEEventAt = Date.now(); // 任意 SSE 事件的最后时间戳
    let lastContentDeltaAt = Date.now(); // 最后一次收到 content delta 的时间
    let recentContentBuffer = ""; // 最近的文本片段（用于推断工具类型）
    let activeToolHeartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let activeToolName = ""; // 当前执行中工具名
    let gatewayToolDetected = false; // 是否已检测到 Gateway 内部工具执行

    // 记录任意 SSE 事件，更新 lastEventAt
    const touchLastEvent = () => { lastSSEEventAt = Date.now(); };

    // 根据最近文本推断 Gateway 正在执行的内部工具
    const inferGatewayTool = (text: string): string | null => {
      const t = text.toLowerCase();
      if (/搜索|search|查找|查询|查.*一下|查清|looking.?up|searching|找.*一下|帮.*找|让我.*查|让我.*找|看看.*最新|了解.*最新/i.test(t)) return "web_search";
      if (/fetch|抓取|获取网页|访问.*网|打开.*链接|reading.*url/i.test(t)) return "web_fetch";
      if (/记忆|memory|回忆|之前.*说|earlier.*mention|上次.*聊/i.test(t)) return "memory_search";
      if (/阅读|read.*file|查看.*文件|读取/i.test(t)) return "read";
      return null; // 无法推断具体工具时不显示（Gateway 静默大概率是搜索）
    };

    // Gateway 内部工具空白检测
    let lastAnyDeltaAt = Date.now(); // 最后一次收到任何 delta
    let gatewayGapInterval: ReturnType<typeof setInterval> | null = null;
    const GAP_THRESHOLD_MS = 6000; // 6 秒无任何 delta → 触发
    const INITIAL_GRACE_MS = 3000; // 请求开始后 3 秒内不检测（连接建立阶段）
    const startGatewayGapDetection = () => {
      if (gatewayGapInterval) return;
      gatewayGapInterval = setInterval(() => {
        if (res.writableEnded) { stopGatewayGapDetection(); return; }
        // 请求刚开始的前几秒不检测
        if (Date.now() - startedAt < INITIAL_GRACE_MS) return;
        const gap = Date.now() - lastAnyDeltaAt;
        // 仅在非 exec tool_call 期间检测
        if (activeToolName) return;
        if (gap >= GAP_THRESHOLD_MS && !gatewayToolDetected) {
          const inferred = inferGatewayTool(recentContentBuffer);
          gatewayToolDetected = true;
          const toolId = `gw_${Date.now()}`;
          writeEvent("tool_call", { id: toolId, name: inferred, arguments: "{}", _gateway: true });
        }
      }, 2000);
    };

    const stopGatewayGapDetection = () => {
      if (gatewayGapInterval) { clearInterval(gatewayGapInterval); gatewayGapInterval = null; }
      if (gatewayToolDetected) {
        // Gateway 工具执行结束：发送 tool_result（标记为 gateway 内部完成）
        writeEvent("tool_result", {
          tool_call_id: `gw_done`,
          result: "",
          is_error: false,
          _gateway: true,
          executor: "gateway",
        });
        gatewayToolDetected = false;
      }
    };

    // 发送 agent_status heartbeat
    const sendHeartbeat = () => {
      if (activeToolName) {
        writeEvent("agent_status", {
          kind: "heartbeat",
          tool: activeToolName,
          elapsedMs: Date.now() - startedAt,
        });
      }
    };

    // 启动工具心跳：每 10 秒检查一次，10 秒无任何事件则发 heartbeat
    const startToolHeartbeat = (name: string) => {
      activeToolName = name;
      if (activeToolHeartbeatInterval) clearInterval(activeToolHeartbeatInterval);
      activeToolHeartbeatInterval = setInterval(() => {
        if (Date.now() - lastSSEEventAt >= 10_000) {
          sendHeartbeat();
        }
      }, 10_000);
    };

    // 停止心跳
    const stopToolHeartbeat = () => {
      if (activeToolHeartbeatInterval) {
        clearInterval(activeToolHeartbeatInterval);
        activeToolHeartbeatInterval = null;
      }
      activeToolName = "";
    };

    const writeEvent = (event: string, data: object) => {
      if (!res.writableEnded) {
        touchLastEvent();
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    const writeData = (data: object) => {
      if (!res.writableEnded) {
        touchLastEvent();
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    // ── 全局 SSE keepalive：每 8 秒发一个 SSE comment，防止 Nginx/LB/浏览器超时断链 ──
    // 覆盖场景：模型思考阶段、工具执行结束到下一个 token 之间的静默期
    const sseKeepaliveInterval = setInterval(() => {
      if (!res.writableEnded) {
        // SSE comment 格式（: 开头），客户端不处理，但能保持连接活跃
        res.write(": keepalive\n\n");
      }
    }, 8000);

    const proxyReq = httpMod.request(options, async (proxyRes) => {
      let buffer = "";
      // 启动 Gateway 内部工具空白检测
      // startGatewayGapDetection(); // disabled — HTTP gap detection unreliable, will replace with WSS

      proxyRes.on("data", async (chunk: Buffer) => {
        if (upstreamFirstChunkMs === null) {
          upstreamFirstChunkMs = Date.now();
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ __perf: { upstreamFirstChunkMs } })}\n\n`);
          }
        }
        upstreamBytes += chunk.length;
        if (upstreamPreview.length < 1200) {
          upstreamPreview += chunk.toString("utf8").slice(0, 1200 - upstreamPreview.length);
        }

        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          let line = rawLine;

          if (line.startsWith(":")) {
            if (!res.writableEnded) res.write(line + "\n");
            continue;
          }

          let eventName = "";
          if (line.startsWith("event: ")) {
            eventName = line.slice(7).trim();
            const dataLineIdx = lines.indexOf(rawLine) + 1;
            if (dataLineIdx < lines.length) {
              line = lines[dataLineIdx];
            } else {
              continue;
            }
          }

          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === "[DONE]") {
            writeData({ __done: true });
            continue;
          }

          try {
            const chunk = JSON.parse(dataStr);

            // ── tool_call：通过 routeTool 统一处理（带 5 分钟超时）──────────
            if (eventName === "tool_call") {
              const req = {
                id: String(chunk.id || ""),
                name: String(chunk.name || ""),
                arguments: String(chunk.arguments || "{}"),
              };
              // 先把 tool_call 转发给前端，让 UI 显示工具调用卡片
              writeEvent("tool_call", { id: req.id, name: req.name, arguments: req.arguments });
              const TOOL_EXEC_TIMEOUT_MS = 300_000; // 5 分钟超时
              startToolHeartbeat(req.name); // 开始心跳追踪
              let result;
              try {
                result = await Promise.race([
                  routeTool(toolCtx, req),
                  new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("tool_timeout")), TOOL_EXEC_TIMEOUT_MS)
                  ),
                ]);
              } catch (err: any) {
                const isTimeout = err?.message === "tool_timeout";
                stopToolHeartbeat(); // 失败也停心跳
                writeEvent("tool_result", {
                  tool_call_id: req.id,
                  result: isTimeout
                    ? `[执行超时] 工具 "${req.name}" 运行超过 5 分钟被系统中断，请尝试减少任务规模或重试。`
                    : `[工具执行异常] ${err?.message ?? String(err)}`,
                  is_error: true,
                  exitCode: isTimeout ? 124 : 1,
                  truncated: false,
                  durationMs: TOOL_EXEC_TIMEOUT_MS,
                  suppressedOriginalResult: true,
                  executor: "timeout",
                  policyDenyReason: isTimeout ? "tool_timeout" : "execution_error",
                  requestId: toolCtx.adoptId,
                });
                continue;
              }
              stopToolHeartbeat(); // 执行完毕，停心跳
              suppressedToolResults.add(result.toolCallId);
              writeEvent("tool_result", {
                tool_call_id:             result.toolCallId,
                result:                   result.output,
                is_error:                 !result.ok,
                exitCode:                 result.exitCode,
                truncated:                result.truncated,
                durationMs:               result.meta.durationMs,
                suppressedOriginalResult: result.suppressedOriginalResult,
                auditId:                  result.auditId,
                requestId:                toolCtx.adoptId,
                executor:                 result.executor,
                policyDenyReason:         result.policyDenyReason,
                outputFiles:              result.outputFiles ?? [],
              });
              continue;
            }

            // ── tool_result：跳过已由 routeTool 注入的 ─────────────────
            if (eventName === "tool_result") {
              const toolCallId = String(chunk.tool_call_id || "");
              if (suppressedToolResults.has(toolCallId)) continue;
              writeEvent("tool_result", chunk);
              continue;
            }

            // ── 其他所有事件透传 ────────────────────────────────────────
            if (eventName) {
              writeEvent(eventName, chunk);
            } else {
              // 检测 content / reasoning_content delta：追踪活跃时间
              const delta = chunk?.choices?.[0]?.delta;
              const content = typeof delta?.content === "string" ? delta.content
                : Array.isArray(delta?.content) ? delta.content.map((c: any) => c?.text || "").join("") : "";
              const reasoning = typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "";
              // 任何 delta（content 或 reasoning_content）都算活跃
              if (content || reasoning) {
                lastAnyDeltaAt = Date.now();
              }
              if (content) {
                memAcc.appendDelta(content);
                lastContentDeltaAt = Date.now();
                recentContentBuffer = (recentContentBuffer + content).slice(-200);
                // 收到 content 说明 Gateway 工具执行完毕
                if (gatewayToolDetected) stopGatewayGapDetection();
              }
              writeData(chunk);
            }
          } catch {
            if (!res.writableEnded) {
              try { res.write(line + "\n"); } catch {}
            }
          }
        }
      });

      proxyRes.on("end", () => {
        memAcc.flush();
          console.log("[BIZ-STREAM] proxyRes ended");
        stopToolHeartbeat(); // 清理心跳 interval
        stopGatewayGapDetection(); // 清理 Gateway 空白检测
        const streamEndMs = Date.now();
        if (!res.writableEnded) {
          // 扫描 workspace 目录（递归 + 含根目录），只推本次流期间新生成的文件
          // 关键：技能/exec 写到根目录的 .html 等产物也要被发现，不只是 output/
          try {
            const wsDir = toolCtx.workspaceDir;
            if (wsDir && existsSync(wsDir)) {
              const allFiles: Array<{ name: string; size: number; path: string }> = [];
              // 跳过这些系统/缓存目录，避免扫描太深
              const SKIP_DIRS = new Set(["skills", "memory", "node_modules", ".git", ".dreams", "dist", "build", ".openclaw"]);
              const scanDir = (dir: string, relBase: string, depth: number) => {
                if (depth > 3) return; // 限制递归深度
                try {
                  for (const entry of readdirSync(dir)) {
                    if (entry.startsWith(".")) continue;
                    if (depth === 0 && SKIP_DIRS.has(entry)) continue;
                    const full = `${dir}/${entry}`;
                    const rel = relBase ? `${relBase}/${entry}` : entry;
                    try {
                      const s = statSync(full);
                      if (s.isFile()) {
                        // 只返回本次流开始后新生成的文件
                        if (s.mtimeMs >= startedAt) {
                          allFiles.push({ name: entry, size: s.size, path: rel });
                        }
                      } else if (s.isDirectory()) {
                        scanDir(full, rel, depth + 1);
                      }
                    } catch {}
                  }
                } catch {}
              };
              scanDir(wsDir, "", 0);
              const sorted = allFiles.sort((a, b) => b.path.localeCompare(a.path));
              if (sorted.length > 0) {
                res.write("event: workspace_files\ndata: " + JSON.stringify({ adoptId: String(adoptId), files: sorted }) + "\n\n");
              }
            }
          } catch {}
          res.write(`data: ${JSON.stringify({ __perf: { streamEndMs } })}\n\n`);
          res.write(`data: ${JSON.stringify({ __stream_end: true })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();  // 关闭 SSE 流
        }
        appendLogAsync("claw-exec-detail.log", {
          ts: new Date().toISOString(),
          event: "chat_stream_response",
          adoptId: String(adoptId),
          agentId: String((claw as any).agentId || ""),
          userId: Number((claw as any).userId || 0),
          permissionProfile: String((claw as any).permissionProfile || "starter"),
          statusCode: Number(proxyRes.statusCode || 0),
          durationMs: streamEndMs - startedAt,
          upstreamFirstChunkMs,
          upstreamBytes,
          preview: upstreamPreview.slice(0, 1000),
        });
      });
    });

      proxyReq.on("timeout", () => { console.log("[BIZ-STREAM] proxyReq TIMEOUT"); });
    proxyReq.on("error", (err) => {
      stopToolHeartbeat();
      stopGatewayGapDetection();
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ __stream_error: true, error: err.message })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    });

    // 客户端断开时取消上游请求
    req.on("close", () => { stopToolHeartbeat(); stopGatewayGapDetection(); clearInterval(sseKeepaliveInterval); proxyReq.destroy(); });

    proxyReq.write(body);
    proxyReq.on("close", () => clearInterval(sseKeepaliveInterval));
    proxyReq.end();
  });

}
