/**
 * claw-ws-proxy.ts v3 — WebSocket 代理：浏览器 ↔ 灵虾 ↔ OpenClaw Gateway
 *
 * Gateway 事件格式（已验证）：
 *   event="agent" stream="assistant" data.delta="文本"              → 流式内容
 *   event="agent" stream="tool"     data.phase="start"             → 工具调用开始
 *   event="agent" stream="tool"     data.phase="update"            → 工具执行中（可忽略）
 *   event="agent" stream="tool"     data.phase="result"            → 工具调用完成（无实际输出）
 *   event="agent" stream="item"     data.phase="start/update/end"  → UI 展示条目（含 progressText）
 *   event="agent" stream="command_output" data.phase="delta"       → 命令输出流
 *   event="agent" stream="command_output" data.phase="end"         → 命令输出结束（含 output/exitCode/durationMs）
 *   event="agent" stream="lifecycle" data.phase="start/end"        → 运行生命周期
 *   event="chat"  state="final"                                    → 完成信号
 */

import { IncomingMessage } from "http";
import { existsSync, readdirSync, statSync } from "fs";
import { Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { createHash, generateKeyPairSync, sign, randomUUID } from "crypto";
import { createContext } from "./context";
import { readSessionEpoch } from "./helpers";

// ── Ed25519 设备身份（进程级复用）──
const ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const { publicKey: _pub, privateKey: _priv } = generateKeyPairSync("ed25519");
const _spki = _pub.export({ type: "spki", format: "der" });
const _raw = _spki.subarray(ED25519_PREFIX.length);
const b64u = (b: Buffer) => b.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
const DEV_PUB = b64u(_raw);
const DEV_ID = createHash("sha256").update(_raw).digest("hex");

const GW_URL = `ws://127.0.0.1:${process.env.CLAW_GATEWAY_PORT || "18789"}`;
const GW_TOKEN = process.env.CLAW_GATEWAY_TOKEN || "";
const SCOPES = ["operator.admin", "operator.read", "operator.write"];

function signPayload(nonce: string) {
  const t = Date.now();
  const p = ["v2", DEV_ID, "openclaw-control-ui", "ui", "operator", SCOPES.join(","), String(t), GW_TOKEN, nonce].join("|");
  return { sig: b64u(sign(null, Buffer.from(p, "utf8"), _priv)), t };
}

export function registerWSProxy(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== "/api/claw/ws") return;

    try {
      const fakeRes = { setHeader: () => {}, getHeader: () => undefined } as any;
      const ctx = await createContext({ req: req as any, res: fakeRes, info: {} as any });
      if (!ctx.user) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }

      const adoptId = url.searchParams.get("adoptId") || "";
      if (!adoptId) { socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"); socket.destroy(); return; }

      const { getClawByAdoptId } = await import("../db");
      const claw = await getClawByAdoptId(adoptId);
      if (!claw || claw.userId !== ctx.user.id) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }

      const { existsSync } = await import("fs");
      const home = process.env.CLAW_REMOTE_OPENCLAW_HOME || "/root";
      const dbAgent = String((claw as any).agentId || "").trim();
      const trialId = `trial_${adoptId}`;
      const agentId = existsSync(`${home}/.openclaw/agents/${trialId}`) ? trialId : dbAgent;

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, { adoptId, agentId, userId: ctx.user!.id });
      });
    } catch (err) {
      console.error("[WS] upgrade error:", err);
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n"); socket.destroy();
    }
  });

  wss.on("connection", (client: WebSocket, _req: IncomingMessage, meta: { adoptId: string; agentId: string; userId: number }) => {
    console.log("[WS] connected:", meta.adoptId);

    let gw: WebSocket | null = null;
    let ready = false;
    let sessionKey: string | null = null;
    let pending: string[] = [];
    let lastUserSendMs: number = 0;

    // 追踪当前工具调用的命令输出（toolCallId → output buffer）
    const cmdOutputBuffers = new Map<string, string>();

    const sendToClient = (data: object) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    };

    gw = new WebSocket(GW_URL, { headers: { Origin: "http://127.0.0.1:5180" } });

    gw.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        // ── Gateway 握手 ──
        if (msg.event === "connect.challenge") {
          const n = msg.payload.nonce;
          const { sig, t } = signPayload(n);
          gw!.send(JSON.stringify({
            type: "req", id: randomUUID(), method: "connect",
            params: {
              minProtocol: 3, maxProtocol: 3,
              client: { id: "openclaw-control-ui", version: "1.0.0", platform: "lingxia", mode: "ui" },
              role: "operator", scopes: SCOPES, auth: { token: GW_TOKEN },
              device: { id: DEV_ID, publicKey: DEV_PUB, signature: sig, signedAt: t, nonce: n },
              caps: ["tool-events"],
            },
          }));
          return;
        }

        // ── Session 创建成功（必须在认证成功判断之前，否则会无限循环）──
        if (msg.type === "res" && msg.id === "init-session" && msg.ok) {
          sessionKey = msg.payload?.key;
          ready = true;
          console.log("[WS] ready:", meta.adoptId, "session:", sessionKey);
          sendToClient({ type: "connected", agentId: meta.agentId, sessionKey });
          for (const p of pending) gw!.send(p);
          pending = [];
          return;
        }

        // ── 认证成功 → 复用 main session（保持上下文跨 WS 重连延续） ──
        // 关键：根据 sessionEpoch 选 key，与 HTTP claw-chat.ts 保持一致
        // epoch=0 → agent:xxx:main（旧默认）
        // epoch>0 → agent:xxx:main:e{epoch}（reset 后用新 key 实现真正"新会话"）
        if (msg.type === "res" && msg.ok === true && !ready) {
          const epoch = readSessionEpoch(meta.adoptId);
          const mainSessionKey = epoch > 0
            ? `agent:${meta.agentId}:main:e${epoch}`
            : `agent:${meta.agentId}:main`;
          console.log("[WS] using session:", mainSessionKey, "epoch:", epoch);
          gw!.send(JSON.stringify({ type: "req", id: "init-session", method: "sessions.create", params: { agentId: meta.agentId, key: mainSessionKey } }));
          return;
        }

        // ── 认证/创建失败 ──
        if (msg.type === "res" && msg.ok === false && !ready) {
          console.error("[WS] gateway error:", msg.error?.message);
          sendToClient({ type: "error", message: msg.error?.message || "Gateway error" });
          client.close();
          return;
        }

        // ── 跳过噪声事件 ──
        if (msg.event === "health" || msg.event === "tick" || msg.event === "heartbeat") return;

        // ── 转换 gateway agent 事件 → 前端格式 ──
        if (msg.type === "event" && msg.event === "agent") {
          const p = msg.payload || {};
          const stream = p.stream || "";
          const data = p.data || {};

          // ── 流式文本 ──
          if (stream === "assistant" && data.delta) {
            sendToClient({
              choices: [{ index: 0, delta: { content: data.delta }, finish_reason: null }],
            });
            return;
          }

          // ── 工具调用开始（tool stream，唯一的 tool_call 卡片来源）──
          if (stream === "tool" && data.phase === "start") {
            const tcId = data.toolCallId || `tc_${Date.now()}`;
            cmdOutputBuffers.set(tcId, ""); // 初始化输出缓冲
            sendToClient({
              _event: "tool_call",
              id: tcId,
              name: data.name || "tool",
              arguments: JSON.stringify(data.args || {}),
            });
            return;
          }

          // ── 工具调用完成（tool stream result）──
          // 注意：实际输出在 command_output.end 里，这里只标记完成
          if (stream === "tool" && data.phase === "result") {
            const tcId = data.toolCallId || "";
            const buffered = cmdOutputBuffers.get(tcId) || "";
            cmdOutputBuffers.delete(tcId);
            sendToClient({
              _event: "tool_result",
              tool_call_id: tcId,
              result: buffered || (typeof data.result === "string" ? data.result : ""),
              is_error: Boolean(data.isError),
            });
            return;
          }

          // ── 命令输出流（增量）──
          if (stream === "command_output" && data.phase === "delta") {
            const tcId = data.toolCallId || "";
            if (tcId && cmdOutputBuffers.has(tcId)) {
              cmdOutputBuffers.set(tcId, (cmdOutputBuffers.get(tcId) || "") + (data.output || ""));
            }
            return;
          }

          // ── 命令输出结束（含完整结果）──
          if (stream === "command_output" && data.phase === "end") {
            const tcId = data.toolCallId || "";
            // 用完整输出覆盖缓冲（如果有）
            if (tcId && data.output) {
              cmdOutputBuffers.set(tcId, data.output);
            }
            // 不在这里发 tool_result，等 tool.phase=result 统一发
            return;
          }

          // ── item 事件：用于前端状态文字（不重复发 tool_call）──
          if (stream === "item" && data.phase === "update" && data.progressText) {
            sendToClient({ __status: data.progressText });
            return;
          }
          // item start/end 不再发 tool_call/tool_result（已由 tool stream 处理）
          if (stream === "item") return;

          // ── tool update（忽略）──
          if (stream === "tool" && data.phase === "update") return;

          // ── 运行结束 ──
          if (stream === "lifecycle" && data.phase === "end") {
            // 扫描 workspace 目录，找出本次对话产生的新文件，触发前端预览/下载按钮
            try {
              const remoteHome = process.env.CLAW_REMOTE_OPENCLAW_HOME || "/root";
              const wsDir = `${remoteHome}/.openclaw/workspace-${meta.agentId}`;
              if (existsSync(wsDir) && lastUserSendMs > 0) {
                const SKIP_DIRS = new Set(["skills", "memory", "node_modules", ".git", ".dreams", "dist", "build", ".openclaw"]);
                const newFiles: Array<{ name: string; size: number; path: string }> = [];
                const scanDir = (dir: string, relBase: string, depth: number) => {
                  if (depth > 3) return;
                  try {
                    for (const entry of readdirSync(dir)) {
                      if (entry.startsWith(".")) continue;
                      if (depth === 0 && SKIP_DIRS.has(entry)) continue;
                      const full = `${dir}/${entry}`;
                      const rel = relBase ? `${relBase}/${entry}` : entry;
                      try {
                        const s = statSync(full);
                        if (s.isFile()) {
                          if (s.mtimeMs >= lastUserSendMs - 1000) {
                            newFiles.push({ name: entry, size: s.size, path: rel });
                          }
                        } else if (s.isDirectory()) {
                          scanDir(full, rel, depth + 1);
                        }
                      } catch {}
                    }
                  } catch {}
                };
                scanDir(wsDir, "", 0);
                if (newFiles.length > 0) {
                  // 用 _event 标记，前端 Home.tsx 已经在监听 workspace_files
                  sendToClient({ _event: "workspace_files", adoptId: meta.adoptId, files: newFiles });
                }
              }
            } catch (e) {
              console.error("[WS] workspace scan error:", e);
            }

            sendToClient({ __stream_end: true });
            sendToClient({
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            });
            return;
          }
          return;
        }

        // ── chat final 事件 ──
        if (msg.type === "event" && msg.event === "chat" && msg.payload?.state === "final") {
          sendToClient({
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          });
          return;
        }

        // ── sessions.send 响应 ──
        if (msg.type === "res" && msg.ok === true && ready) return;

        // ── 其他 RPC 错误 ──
        if (msg.type === "res" && msg.ok === false && ready) {
          sendToClient({ error: msg.error?.message || "RPC error" });
        }
      } catch (e) {
        console.error("[WS] parse error:", e);
      }
    });

    // ── 心跳：每 30 秒向浏览器发 ping，防止长任务期间 WS 空闲断连 ──
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const startHeartbeat = () => {
      if (heartbeatTimer) return;
      heartbeatTimer = setInterval(() => {
        if (client.readyState === WebSocket.OPEN) {
          client.ping();
        }
      }, 30000);
    };
    const stopHeartbeat = () => {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    };

    gw.on("open", () => { console.log("[WS-GW] opened for", meta.adoptId); startHeartbeat(); });
    gw.on("error", (e) => { console.error("[WS] gw error:", meta.adoptId, e.message); });
    gw.on("close", (code) => {
      if (client.readyState === WebSocket.OPEN) client.close(code);
    });

    // ── 浏览器消息 ──
    client.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "chat" && sessionKey) {
          lastUserSendMs = Date.now();
          const rpc = JSON.stringify({
            type: "req", id: randomUUID(), method: "sessions.send",
            params: { key: sessionKey, message: msg.message },
          });
          if (ready && gw?.readyState === WebSocket.OPEN) gw.send(rpc);
          else pending.push(rpc);
        }
      } catch {}
    });

    client.on("close", () => { console.log("[WS] disconnected:", meta.adoptId); stopHeartbeat(); gw?.close(); });
    client.on("error", () => { stopHeartbeat(); gw?.close(); });
  });

  console.log("[WS-PROXY] registered at /api/claw/ws");
}
