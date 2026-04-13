/**
 * Home.tsx — Lingxia (灵虾) Console
 * Renders the sub-claw control panel when accessed via /claw/:adoptId or a lingxia subdomain.
 * The linggan homepage code has been removed (dead code on this server).
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { OpenClawWSClient } from "@/lib/openclaw-ws";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useBrand } from "@/lib/useBrand";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useRoute } from "wouter";
import { SidebarFooter } from "@/components/SidebarFooter";
import { CollabDrawer } from "@/components/CollabDrawer";
import { ChatInput } from "@/components/ChatInput";
import { ChatMessage, type ToolCallEntry } from "@/components/ChatMessage";
import { BrandIcon } from "@/components/BrandIcon";
import { Sidebar, type PageKey } from "@/components/console/Sidebar";
import { TopBar } from "@/components/console/TopBar";
import { MainPanel } from "@/components/console/MainPanel";
import { ChatPage } from "@/components/pages/ChatPage";
import { LINGXIA_SIDEBAR_NAV } from "@/config/navigation";
import { sidebarIconMap } from "@/config/icons";
import { applySettings as applyUiSettings, getSettings, subscribeSettings } from "@/lib/settings";


export default function Home() {
  // 灵虾子域名聊天态（MVP）
  const brand = useBrand();
  const [lingxiaInput, setLingxiaInput] = useState("");
  const [lingxiaMsgs, setLingxiaMsgs] = useState<Array<{ role: "user" | "assistant"; text: string; timeLabel: string; usage?: { input: number; output: number }; model?: string; contextWindow?: number; contextPercent?: number; toolCalls?: import("@/components/ChatMessage").ToolCallEntry[] }>>(() => {
    try { const s = localStorage.getItem("lingxia-chat-history"); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [lingxiaToolCalls, setLingxiaToolCalls] = useState<ToolCallEntry[]>([]);
  const [lingxiaShowToolCalls, setLingxiaShowToolCalls] = useState(true);
  const [lingxiaDisplayName, setLingxiaDisplayName] = useState(brand.name);
  const identityNameRef = useRef<string>("");
  const prettyLingxiaModelName = (modelId: string) => {
    const m = String(modelId || "").trim();
    if (!m) return "default";
    if (m === "modelarts-maas/glm-5" || m === "glm5/glm-5" || m === "glm5/glm-5.1" || m === "modelarts-maas/glm-5.1") return "GLM-5.1";
    if (m.includes("/")) return m.split("/").pop() || m;
    return m;
  };
    const [lingxiaMemoryEnabled, setLingxiaMemoryEnabled] = useState<"yes" | "no">("yes");
  const [lingxiaContextTurns, setLingxiaContextTurns] = useState(20);
  const [lingxiaModelId, setLingxiaModelId] = useState("glm5/glm-5.1");
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 768);
  const [openclawVersion, setOpenclawVersion] = useState("v2026.3.27");
  const [runtimeAgentId, setRuntimeAgentId] = useState("");
  const prettyRuntimeAgentName = (agentId: string) => {
    const s = String(agentId || "").trim();
    if (!s) return "";
    return s.replace(/^trial_/, "").replace(/^lgc-/, "");
  };
  const [activePage, setActivePage] = useState<PageKey>("chat");
  const [collabOpen, setCollabOpen] = useState(false);

  useEffect(() => {
    const initial = getSettings();
    setSidebarCollapsed(initial.navCollapsed);
    setSidebarWidth(initial.navWidth);
    return subscribeSettings((st) => {
      setSidebarCollapsed(st.navCollapsed);
      setSidebarWidth(st.navWidth);
    });
  }, []);

  useEffect(() => {
    applyUiSettings({ navCollapsed: sidebarCollapsed, navWidth: sidebarWidth });
  }, [sidebarCollapsed, sidebarWidth]);
  const [lingxiaOpenSections, setLingxiaOpenSections] = useState<Set<string>>(new Set(["soul"]));
  const toggleLingxiaSection = (s: string) => setLingxiaOpenSections(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  const [lingxiaMemoryContent, setLingxiaMemoryContent] = useState("");
  const [lingxiaMemoryEditing, setLingxiaMemoryEditing] = useState(false);
  const [lingxiaTopSettingsOpen, setLingxiaTopSettingsOpen] = useState(false);

  const { user } = useAuth({ redirectOnUnauthenticated: false });

  // ── adoptId 提取：子域名模式 OR 路径模式 ──
  const currentHost = window.location.hostname.toLowerCase();
  const adoptIdFromHost = useMemo(() => {
    const m = currentHost.match(/^(lgc-[a-z0-9-]+)\.(?:demo\.linggantest\.top|demo\.linggan\.top)$/i);
    return m?.[1] || null;
  }, [currentHost]);
  // 路径模式：/claw/:adoptId
  const [isClawRoute, clawRouteParams] = useRoute("/claw/:adoptId");
  const adoptIdFromPath = isClawRoute ? clawRouteParams?.adoptId || null : null;
  // 合并：子域名优先，路径兜底
  const resolvedAdoptId = adoptIdFromHost || adoptIdFromPath;
  const isLingxiaSubdomain = !!resolvedAdoptId;

  const { data: clawByAdoptId, isLoading: clawByAdoptLoading } = trpc.claw.getByAdoptId.useQuery(
    { adoptId: resolvedAdoptId || "" },
    { enabled: !!resolvedAdoptId, retry: false }
  );
  const { data: clawSettings, refetch: refetchClawSettings } = trpc.claw.getSettings.useQuery(
    { adoptId: resolvedAdoptId || "" },
    { enabled: !!resolvedAdoptId, retry: false }
  );
  const { data: availableModels } = trpc.claw.getAvailableModels.useQuery(undefined, { retry: false, refetchInterval: 30000, refetchOnWindowFocus: true, refetchOnMount: true });
  // 模型兜底：若 lingxiaModelId 为空或不在可用列表，优先选 isDefault 的，否则选第一个
  useEffect(() => {
    if (!availableModels || availableModels.length === 0) return;
    const ids = (availableModels as any[]).map((m: any) => m.id);
    if (!lingxiaModelId || !ids.includes(lingxiaModelId)) {
      const defaultModel = (availableModels as any[]).find((m: any) => m.isDefault);
      setLingxiaModelId(defaultModel ? defaultModel.id : ids[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableModels]);

  const switchModelMutation = trpc.claw.switchModel.useMutation({
    retry: false,
    onSuccess: () => toast.success("模型已切换"),
    onError: (e) => toast.error(e.message || "切换模型失败"),
  });
  const updateClawSettingsMutation = trpc.claw.updateSettings.useMutation({
    retry: false,
    onSuccess: () => {
      refetchClawSettings();
      toast.success("灵虾设置已保存");
    },
  });

  // 流式聊天状态（替换原 tRPC mutation）
  const [lingxiaStreaming, setLingxiaStreaming] = useState(false);
  const lingxiaStreamAbortRef = useRef<AbortController | null>(null);
  const wsClientRef = useRef<OpenClawWSClient | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  // 初始化 WSS 连接（后台自动尝试，不阻塞 UI）
  useEffect(() => {
    if (!resolvedAdoptId) return;
    const apiBase = (import.meta as any).env?.VITE_API_URL || "";
    const ws = new OpenClawWSClient(resolvedAdoptId, apiBase);
    wsClientRef.current = ws;
    ws.connect().then((ok) => { if (ok) setWsConnected(true); });
    return () => { ws.disconnect(); wsClientRef.current = null; setWsConnected(false); };
  }, [resolvedAdoptId]);
  const lingxiaMsgViewportRef = useRef<HTMLDivElement | null>(null);
  const [lingxiaNearBottom, setLingxiaNearBottom] = useState(true);
  // 工具执行显性化状态
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [activeToolStartMs, setActiveToolStartMs] = useState<number | null>(null);
  const [activeToolElapsed, setActiveToolElapsed] = useState(0); // 秒数
  const [activeToolStep, setActiveToolStep] = useState<number | null>(null);    // 第二阶段：当前步骤
  const [activeToolTotal, setActiveToolTotal] = useState<number | null>(null);  // 第二阶段：总步骤
  const [activeToolLabel, setActiveToolLabel] = useState<string | null>(null);  // 第二阶段：当前阶段文案
  const [connStatus, setConnStatus] = useState<'connected' | 'reconnecting' | 'failed'>('connected');
  const lastEventAtRef = useRef<number>(Date.now()); // 追踪最后收到的任意 SSE 事件时间

  // 技能列表
  const { data: lingxiaSkills, refetch: refetchSkills } = trpc.claw.listSkills.useQuery(
    { adoptId: resolvedAdoptId || "" },
    { enabled: !!resolvedAdoptId, retry: false }
  );
  const toggleSkillMutation = trpc.claw.toggleSkill.useMutation({
    onSuccess: () => { refetchSkills(); toast.success("技能已更新"); },
    onError: (e) => toast.error(e.message),
  });
  const upsertPrivateSkillMutation = trpc.claw.upsertPrivateSkill.useMutation({
    onSuccess: () => { refetchSkills(); setLingxiaSkillEditor(null); toast.success("技能已保存"); },
    onError: (e) => toast.error(e.message),
  });
  const deletePrivateSkillMutation = trpc.claw.deletePrivateSkill.useMutation({
    onSuccess: () => { refetchSkills(); toast.success("技能已删除"); },
    onError: (e) => toast.error(e.message),
  });
  const [lingxiaSkillEditor, setLingxiaSkillEditor] = useState<{ id: string; content: string } | null>(null);

  // 记忆
  const { data: lingxiaMemoryData, refetch: refetchMemory } = trpc.claw.getMemory.useQuery(
    { adoptId: resolvedAdoptId || "" },
    { enabled: !!resolvedAdoptId && lingxiaOpenSections.has("memory"), retry: false }
  );
  const updateMemoryMutation = trpc.claw.updateMemory.useMutation({
    onSuccess: () => { setLingxiaMemoryEditing(false); refetchMemory(); toast.success("记忆已保存"); },
    onError: (e) => toast.error(e.message),
  });
  // 同步记忆内容到编辑框
  useEffect(() => {
    if (lingxiaMemoryData?.content !== undefined) setLingxiaMemoryContent(lingxiaMemoryData.content);
  }, [lingxiaMemoryData]);

  // localStorage 会话持久化
  const MSGS_KEY = resolvedAdoptId ? `lgc_msgs_${resolvedAdoptId}` : null;
  useEffect(() => {
    if (!MSGS_KEY) return;
    try {
      const saved = localStorage.getItem(MSGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const normalized = Array.isArray(parsed)
          ? parsed.map((m: any) => ({
              role: m?.role === "assistant" ? "assistant" : "user",
              text: String(m?.text || ""),
              timeLabel: String(m?.timeLabel || new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })),
            }))
          : [];
        setLingxiaMsgs(normalized);
      }
    } catch {}
  }, [MSGS_KEY]);
  useEffect(() => {
    if (!MSGS_KEY) return;
    try {
      if (lingxiaMsgs.length === 0) {
        localStorage.removeItem(MSGS_KEY);
      } else {
        localStorage.setItem(MSGS_KEY, JSON.stringify(lingxiaMsgs.slice(-100)));
      }
    } catch {}
  }, [lingxiaMsgs, MSGS_KEY]);


  useEffect(() => {
    if (!clawSettings) return;
    if (!identityNameRef.current) setLingxiaDisplayName(String((clawSettings as any).displayName || (clawByAdoptId as any)?.displayName || brand.name));
        setLingxiaMemoryEnabled(((clawSettings as any).memoryEnabled || "yes") as "yes" | "no");
    setLingxiaContextTurns(Number((clawSettings as any).contextTurns || 20));
    // 模型选择由 availableModels useEffect 统一管理
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clawSettings, clawByAdoptId]);

  // 从 IDENTITY.md 读取角色名（覆盖 clawSettings 的 displayName）
  useEffect(() => {
    if (!resolvedAdoptId) return;
    const apiBase = (import.meta as any).env?.VITE_API_URL || "";
    fetch(`${apiBase}/api/claw/core-files/read?adoptId=${encodeURIComponent(resolvedAdoptId)}&name=IDENTITY.md`, {
      credentials: "include",
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.content) return;
        const content: string = d.content;
        // 格式: **Name:** XXX 或 - **Name:** XXX
        const nameFieldMatch = content.match(/\*\*Name:\*\*\s*(.+)/);
        const headingMatch = content.match(/^#\s+(?:我叫|名字[：:]?\s*)?(.+)/m);
        const labelMatch = content.match(/(?:名字|名称|称呼)[：:]\s*(.+)/);
        const sentenceMatch = content.match(/我叫([^\s，。！？,\.!?]{1,20})/);
        const name = (nameFieldMatch?.[1] || headingMatch?.[1] || labelMatch?.[1] || sentenceMatch?.[1] || "").trim();
        if (name) { identityNameRef.current = name; setLingxiaDisplayName(name); }
      })
      .catch(() => {});
  }, [resolvedAdoptId]);


  const stopLingxiaStreaming = () => {
    if (lingxiaStreamAbortRef.current) {
      lingxiaStreamAbortRef.current.abort();
      lingxiaStreamAbortRef.current = null;
    }
  };

  // 工具执行计时器：activeToolStartMs 有值时每秒更新 elapsed
  useEffect(() => {
    if (activeToolStartMs === null) return;
    const tick = () => setActiveToolElapsed(Math.floor((Date.now() - activeToolStartMs) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeToolStartMs]);

  // 断连检测：任意 SSE 事件超过 25 秒未到达 → 进入"重连中"
  useEffect(() => {
    if (!lingxiaStreaming) return;
    const id = setInterval(() => {
      if (Date.now() - lastEventAtRef.current > 90_000) {
        setConnStatus("reconnecting");
      }
    }, 5000);
    return () => clearInterval(id);
  }, [lingxiaStreaming]);

  const skipCollabRef = useRef(false);
  const sendLingxiaMessage = async () => {
    if (!resolvedAdoptId || !lingxiaInput.trim() || lingxiaStreaming) return;
    const text = lingxiaInput.trim();
    const nowLabel = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    const assistantTimeLabel = nowLabel;

    if (text.toLowerCase() === "/help" || text.toLowerCase() === "/commands") {
      const helpMd = "## \u53ef\u7528\u547d\u4ee4\n\n" +
        "| \u547d\u4ee4 | \u8bf4\u660e |\n|---|---|\n" +
        "| \`/help\` | \u67e5\u770b\u53ef\u7528\u547d\u4ee4 |\n" +
        "| \`/status\` | \u67e5\u770b\u5f53\u524d\u72b6\u6001 |\n" +
        "| \`/tools\` | \u67e5\u770b\u53ef\u7528\u5de5\u5177 |\n" +
        "| \`/model\` | \u5207\u6362\u6a21\u578b |\n" +
        "| \`/dreaming status\` | \u68a6\u5883\u8bb0\u5fc6\u72b6\u6001 |\n" +
        "| \`/context\` | \u4e0a\u4e0b\u6587\u4fe1\u606f |\n" +
        "| \`/usage\` | \u7528\u91cf\u7edf\u8ba1 |\n" +
        "| \`/whoami\` | \u5f53\u524d\u8eab\u4efd |\n" +
        "| \`/new\` | \u65b0\u4f1a\u8bdd |\n" +
        "| \`/reset\` | \u91cd\u7f6e\u4e0a\u4e0b\u6587 |\n" +
        "| \`/think\` | \u6df1\u5ea6\u601d\u8003 |\n" +
        "| \`/fast\` | \u5feb\u901f\u6a21\u5f0f |\n" +
        "| \`/compact\` | \u538b\u7f29\u4e0a\u4e0b\u6587 |\n" +
        "| \`/tasks\` | \u4efb\u52a1\u5217\u8868 |\n\n" +
        "> \u4e5f\u53ef\u4ee5\u76f4\u63a5\u7528\u81ea\u7136\u8bed\u8a00\u5bf9\u8bdd";
      setLingxiaMsgs((prev) => [...prev,
        { role: "user" as const, text, timeLabel: nowLabel },
        { role: "assistant" as const, text: helpMd, timeLabel: assistantTimeLabel },
      ]);
      setLingxiaInput("");
      return;
    }

    // ── 前端 collab 意图检测：推荐专业助手 ──
    const COLLAB_AGENTS: Array<{ pattern: RegExp; id: string; name: string; emoji: string }> = [
      { pattern: /PPT|幻灯片|演示文稿|路演.*材料|做个.*演示/i, id: "task-ppt", name: "灵匠 · 幻灯片（PPT）", emoji: "📊" },
      { pattern: /HTML.*幻灯片|网页.*演示|slides/i, id: "task-slides", name: "灵匠 · 幻灯片（HTML）", emoji: "🎨" },
      { pattern: /写代码|写个.*脚本|编程|调试.*代码|跑.*脚本|代码助手/i, id: "task-code", name: "灵匠 · 代码助手", emoji: "💻" },
      { pattern: /股票分析|选股|个股.*分析|K线|技术面.*分析|股票助手/i, id: "task-stock", name: "灵犀 · 股票分析", emoji: "📈" },
      { pattern: /深度分析|深度.*思考|拆解.*任务|复杂.*任务|帮我.*规划/i, id: "task-trace", name: "灵枢 · 深度求索", emoji: "🔍" },
    ];
    const collabMatch = COLLAB_AGENTS.find(a => a.pattern.test(text));
    if (collabMatch && !skipCollabRef.current) {
      const cardMd = `> 💡 **检测到专业需求，推荐使用：**\n>\n> ${collabMatch.emoji} **${collabMatch.name}**\n>\n> _点击下方按钮打开助手，或选择继续在主对话中处理。_`;
      setLingxiaMsgs((prev) => [
        ...prev,
        { role: "user" as const, text, timeLabel: nowLabel },
        {
          role: "assistant" as const,
          text: cardMd,
          timeLabel: assistantTimeLabel,
          collabSuggestion: { agentId: collabMatch.id, agentName: collabMatch.name, agentEmoji: collabMatch.emoji, originalPrompt: text },
        } as any,
      ]);
      setLingxiaInput("");
      return;
    }

    skipCollabRef.current = false;
    setLingxiaMsgs((prev) => [
      ...prev,
      { role: "user", text, timeLabel: nowLabel },
      { role: "assistant", text: "", timeLabel: assistantTimeLabel },
    ]);
    setLingxiaInput("");
    setLingxiaStreaming(true);
    setLingxiaNearBottom(true);
    setLingxiaToolCalls([]);

    let wsOk = false;
    try {
      const apiBase = import.meta.env.VITE_API_URL || "";
      const perf: Record<string, number> = { clientSendMs: Date.now() };
      const controller = new AbortController();
      lingxiaStreamAbortRef.current = controller;
      // ── WSS 优先路径 ──
      const wsClient = wsClientRef.current;
      console.log(`[DIAG] wsClient.state = ${wsClient?.state ?? "null"}, will ${wsClient?.state === "connected" ? "try WSS first" : "use HTTP SSE directly"}`);
      if (wsClient?.state === "connected") {
        console.log("[WS] sending via WebSocket");
        // WS 消息处理：后端 WS 代理已转成与 HTTP SSE 一致的格式
        // _event 字段 = SSE 的 event: 行，其余字段 = SSE 的 data: JSON
        // 用 setRawHandler 代替 addEventListener，跨重连自动保持
          const wsHandler = (chunk: any) => {
            try {
              if (chunk.type === "connected") return;
              lastEventAtRef.current = Date.now();

              // ── 统一语义：流结束 ──
              if (chunk.__stream_end) {
                console.log("[DIAG] ✅ WSS 收到 __stream_end，流结束");
                setLingxiaStreaming(false);
                wsClient.setRawHandler(null);
                return;
              }
              // ── 统一语义：终止性错误 ──
              if (chunk.__stream_error) {
                console.log("[DIAG] ❌ WSS 收到 __stream_error:", chunk.error);
                setLingxiaMsgs((prev) => { const n = [...prev]; const last = n[n.length-1]; if (last?.role === "assistant") n[n.length-1] = { ...last, text: `（${chunk.error || "连接异常"}）` }; return n; });
                setLingxiaStreaming(false);
                wsClient.setRawHandler(null);
                return;
              }
              // 错误（旧兼容）
              if (chunk.error) {
                setLingxiaMsgs((prev) => { const n = [...prev]; const last = n[n.length-1]; if (last?.role === "assistant") n[n.length-1] = { ...last, text: `（${chunk.error}）` }; return n; });
                setLingxiaStreaming(false);
                return;
              }

              // ── tool_call 事件（与 HTTP SSE event:tool_call 一致）──
              if (chunk._event === "tool_call") {
                const toolName = String(chunk.name || "unknown");
                const toolTs = Date.now();
                const isGateway = Boolean(chunk._gateway);
                setLingxiaMsgs((prev) => {
                  const next = [...prev]; const lastIdx = next.length - 1;
                  if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                    const existing = next[lastIdx].toolCalls || [];
                    next[lastIdx] = { ...next[lastIdx], toolCalls: [...existing, { id: String(chunk.id || ""), name: toolName, arguments: String(chunk.arguments || "{}"), status: "running" as const, ts: toolTs, _gateway: isGateway, executor: isGateway ? "gateway" : undefined }] };
                  }
                  return next;
                });
                if (!isGateway) {
                  setActiveToolName(toolName);
                  setActiveToolStartMs(toolTs);
                  setActiveToolElapsed(0);
                  setActiveToolStep(null); setActiveToolTotal(null); setActiveToolLabel(null);
                }
                return;
              }

              // ── tool_result 事件（与 HTTP SSE event:tool_result 一致）──
              if (chunk._event === "tool_result") {
                const toolCallId = String(chunk.tool_call_id || "");
                const result = String(chunk.result ?? "");
                const isGateway = Boolean(chunk._gateway);
                const status = chunk.is_error ? "error" : "done";
                if (isGateway) {
                  setLingxiaMsgs((prev) => {
                    const next = [...prev]; const lastIdx = next.length - 1;
                    if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                      const tcs = next[lastIdx].toolCalls || [];
                      const gwIdx = tcs.findLastIndex((tc: any) => tc._gateway && tc.status === "running");
                      if (gwIdx >= 0) { const updated = [...tcs]; updated[gwIdx] = { ...updated[gwIdx], status: "done", durationMs: Date.now() - updated[gwIdx].ts }; next[lastIdx] = { ...next[lastIdx], toolCalls: updated }; }
                    }
                    return next;
                  });
                } else {
                  setLingxiaMsgs((prev) => {
                    const next = [...prev]; const lastIdx = next.length - 1;
                    if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                      const tcs = next[lastIdx].toolCalls || [];
                      next[lastIdx] = { ...next[lastIdx], toolCalls: tcs.map((tc: any) => tc.id === toolCallId ? { ...tc, result, status, durationMs: Date.now() - tc.ts, executor: chunk.executor, truncated: Boolean(chunk.truncated), outputFiles: chunk.outputFiles, adoptId: resolvedAdoptId ?? undefined } : tc) };
                    }
                    return next;
                  });
                  setActiveToolName(null); setActiveToolStartMs(null);
                  setActiveToolStep(null); setActiveToolTotal(null); setActiveToolLabel(null);
                }
                return;
              }

              // ── workspace_files 事件 ──
              if (chunk._event === "workspace_files") {
                const wsFiles = Array.isArray(chunk.files) ? chunk.files : [];
                const wsAdoptId = String(chunk.adoptId || "");
                if (wsFiles.length > 0) {
                  const pseudoTc: any = { id: `ws-files-${Date.now()}`, name: "[产出文件]", arguments: "{}", result: wsFiles.map((f: any) => f.name).join(", "), status: "done", ts: Date.now(), executor: "native", outputFiles: wsFiles.map((f: any) => ({ name: f.name, size: f.size, wsPath: f.path })), adoptId: wsAdoptId };
                  setLingxiaMsgs((prev) => { const next = [...prev]; const lastIdx = next.length - 1; if (lastIdx >= 0 && next[lastIdx].role === "assistant") { const existing = next[lastIdx].toolCalls || []; next[lastIdx] = { ...next[lastIdx], toolCalls: [...existing, pseudoTc] }; } return next; });
                }
                return;
              }

              // ── agent_status 事件（进度条）──
              if (chunk._event === "agent_status") {
                if (chunk.kind === "heartbeat") {
                  if (chunk.tool) setActiveToolName(String(chunk.tool));
                  if (chunk.elapsedMs) { setActiveToolStartMs(Date.now() - Number(chunk.elapsedMs)); setActiveToolElapsed(Math.floor(Number(chunk.elapsedMs) / 1000)); }
                } else if (chunk.kind === "progress") {
                  if (chunk.tool) setActiveToolName(String(chunk.tool));
                  if (chunk.step != null) setActiveToolStep(Number(chunk.step));
                  if (chunk.total != null) setActiveToolTotal(Number(chunk.total));
                  if (chunk.label) setActiveToolLabel(String(chunk.label));
                  if (chunk.elapsedMs) { setActiveToolStartMs(Date.now() - Number(chunk.elapsedMs)); setActiveToolElapsed(Math.floor(Number(chunk.elapsedMs) / 1000)); }
                }
                return;
              }

              // ── __perf 事件（token 用量）──
              if (chunk.__perf && typeof chunk.__perf === "object") {
                setLingxiaMsgs(prev => {
                  if (!prev.length || prev[prev.length - 1].role !== "assistant") return prev;
                  const last = prev[prev.length - 1];
                  const input = chunk.__perf.usage?.input ?? chunk.__perf.usage?.inputTokens ?? last.usage?.input ?? 0;
                  const output = chunk.__perf.usage?.output ?? chunk.__perf.usage?.outputTokens ?? last.usage?.output ?? 0;
                  const contextWindow = chunk.__perf.usage?.contextWindow ?? last.contextWindow;
                  const nextModel = chunk.__perf.model && chunk.__perf.model !== "gateway-injected" ? chunk.__perf.model : last.model;
                  return [...prev.slice(0, -1), { ...last, usage: { input, output }, model: nextModel, contextWindow, contextPercent: contextWindow && input > 0 ? Math.min(Math.round((input / contextWindow) * 100), 100) : last.contextPercent }];
                });
                return;
              }

              // __status（纯文本状态）
              if (chunk.__status) {
                setLingxiaMsgs((prev) => { const n = [...prev]; const last = n[n.length-1]; if (last?.role === "assistant") n[n.length-1] = { ...last, status: chunk.__status }; return n; });
                return;
              }

              // 文本 delta
              const delta = chunk?.choices?.[0]?.delta?.content;
              if (delta) {
                setLingxiaMsgs((prev) => { const n = [...prev]; const last = n[n.length-1]; if (last?.role === "assistant") n[n.length-1] = { ...last, text: last.text + delta, status: undefined }; return n; });
              }
              // 完成
              if (chunk?.choices?.[0]?.finish_reason === "stop") {
                console.log("[DIAG] ✅ WSS finish_reason=stop，流结束");
                setLingxiaStreaming(false);
                wsClient.setRawHandler(null);
              }
            } catch {}
          };
          wsClient.setRawHandler(wsHandler);
        const sent = wsClient.sendChat(text);
        if (sent) {
          // WSS 响应超时检测：企业代理可能静默拦截 WSS 数据
          // 等待第一个有效事件，超时则降级到 HTTP SSE
          const WSS_FIRST_EVENT_TIMEOUT_MS = 15000;
          const firstEventOk = await new Promise<boolean>((resolve) => {
            let resolved = false;
            const timeout = setTimeout(() => {
              if (!resolved) { resolved = true; resolve(false); }
            }, WSS_FIRST_EVENT_TIMEOUT_MS);
            const origHandler = wsHandler;
            wsClient.setRawHandler((chunk: any) => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve(true);
              }
              origHandler(chunk);
            });
          });

          if (firstEventOk) {
            // WSS 工作正常，后续由 wsHandler 接管
            wsOk = true;
            return;
          }

          // WSS 超时：清理 handler，降级到 HTTP
          console.warn("[WS] no response in 15s, falling back to HTTP SSE");
          console.log("[DIAG] ⚠️ WSS 超时降级 → 开始走 HTTP SSE 路径");
          wsClient.setRawHandler(null);
        } else {
          console.log("[WS] send failed, falling back to HTTP");
        }
      }

      // ── HTTP SSE 路径（fallback）──
      console.log("[DIAG] 📡 进入 HTTP SSE 路径");
      const resp = await fetch(`${apiBase}/api/claw/chat-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({ adoptId: resolvedAdoptId, message: text, model: lingxiaModelId }),
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`请求失败 (${resp.status})`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let pendingDelta = "";
      let flushTimer: number | null = null;
      let firstChunkFlushed = false;

      const flushDelta = () => {
        if (!pendingDelta) return;
        if (!perf.firstPaintMs) perf.firstPaintMs = Date.now();
        const delta = pendingDelta;
        pendingDelta = "";
        setLingxiaMsgs((prev) => {
          const next = [...prev];
          if (next.length === 0 || next[next.length - 1].role !== "assistant") return prev;
          next[next.length - 1] = {
            ...next[next.length - 1],
            text: next[next.length - 1].text + delta,
          };
          return next;
        });
      };

      const scheduleFlush = () => {
        if (!firstChunkFlushed) {
          firstChunkFlushed = true;
          flushDelta();
          return;
        }
        if (flushTimer !== null) return;
        flushTimer = window.setTimeout(() => {
          flushTimer = null;
          flushDelta();
        }, 16);
      };

      let currentEvent = ""; // fix: 跨 chunk 保持 SSE event 状态
      let sseDone = false;
      while (!sseDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";


        for (const line of lines) {
          // SSE event 标签行
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") {
            console.log("[DIAG] ✅ 收到 [DONE]，流结束");
            flushDelta();
            sseDone = true;
            break;
          }
          try {
            const chunk = JSON.parse(raw);
            lastEventAtRef.current = Date.now(); // 任意事件进来，重置断连计时
            if (currentEvent === "agent_status") {
              if (chunk.kind === "heartbeat") {
                if (chunk.tool) setActiveToolName(String(chunk.tool));
                if (chunk.elapsedMs) {
                  setActiveToolStartMs(Date.now() - Number(chunk.elapsedMs));
                  setActiveToolElapsed(Math.floor(Number(chunk.elapsedMs) / 1000));
                }
              } else if (chunk.kind === "progress") {
                // 第二阶段：进度信号 → 更新 step/total/label
                if (chunk.tool) setActiveToolName(String(chunk.tool));
                if (chunk.step != null) setActiveToolStep(Number(chunk.step));
                if (chunk.total != null) setActiveToolTotal(Number(chunk.total));
                if (chunk.label) setActiveToolLabel(String(chunk.label));
                if (chunk.elapsedMs) {
                  setActiveToolStartMs(Date.now() - Number(chunk.elapsedMs));
                  setActiveToolElapsed(Math.floor(Number(chunk.elapsedMs) / 1000));
                }
              }
              currentEvent = "";
              continue;
            }
            if (chunk?.__perf && typeof chunk.__perf === "object") {
              Object.assign(perf, chunk.__perf);
              // 改动3: 不可写回 message（usage/model/context）
              setLingxiaMsgs(prev => {
                if (!prev.length || prev[prev.length - 1].role !== "assistant") return prev;
                const last = prev[prev.length - 1];
                const input =
                  chunk.__perf.usage?.input ?? chunk.__perf.usage?.inputTokens ?? last.usage?.input ?? 0;
                const output =
                  chunk.__perf.usage?.output ?? chunk.__perf.usage?.outputTokens ?? last.usage?.output ?? 0;
                const contextWindow =
                  chunk.__perf.usage?.contextWindow ?? last.contextWindow;
                const nextModel =
                  chunk.__perf.model && chunk.__perf.model !== "gateway-injected"
                    ? chunk.__perf.model
                    : last.model;
                return [
                  ...prev.slice(0, -1),
                  {
                    ...last,
                    usage: { input, output },
                    model: nextModel,
                    contextWindow,
                    contextPercent:
                      contextWindow && input > 0
                        ? Math.min(Math.round((input / contextWindow) * 100), 100)
                        : last.contextPercent,
                  },
                ];
              });
              continue;
            }
            if (currentEvent === "tool_call") {
              const toolName = String(chunk.name || "unknown");
              const toolTs = Date.now();
              const isGateway = Boolean(chunk._gateway);
              // Gateway 内部工具：内联到消息卡片，不设顶部横幅
              if (isGateway) {
                setLingxiaMsgs((prev) => {
                  const next = [...prev];
                  const lastIdx = next.length - 1;
                  if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                    const existing = next[lastIdx].toolCalls || [];
                    next[lastIdx] = { ...next[lastIdx], toolCalls: [...existing, { id: String(chunk.id || ""), name: toolName, arguments: "{}", status: "running" as const, ts: toolTs, _gateway: true, executor: "gateway" }] };
                  }
                  return next;
                });
              } else {
                // exec 等服务端工具：设横幅 + 插卡片
                setActiveToolName(toolName);
                setActiveToolStartMs(toolTs);
                setActiveToolElapsed(0);
                setActiveToolStep(null);
                setActiveToolTotal(null);
                setActiveToolLabel(null);
                setLingxiaMsgs((prev) => {
                  const next = [...prev];
                  const lastIdx = next.length - 1;
                  if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                    const existing = next[lastIdx].toolCalls || [];
                    next[lastIdx] = { ...next[lastIdx], toolCalls: [...existing, { id: String(chunk.id || ""), name: toolName, arguments: String(chunk.arguments || ""), status: "running" as const, ts: toolTs }] };
                  }
                  return next;
                });
              }
              currentEvent = "";
              continue;
            }
            if (currentEvent === "tool_result") {
              const toolCallId = String(chunk.tool_call_id || "");
              const result = String(chunk.result ?? "");
              const isTimeout = chunk.policyDenyReason === "tool_timeout";
              const isGateway = Boolean(chunk._gateway);
              const status = chunk.is_error ? "error" : "done";
              const executor = chunk.executor as ("sandbox" | "native" | "none" | "timeout" | "gateway") | undefined;
              const truncated = Boolean(chunk.truncated);
              const suppressedOriginalResult = Boolean(chunk.suppressedOriginalResult);
              const policyDenyReason = chunk.policyDenyReason as string | undefined;
              const auditId = chunk.auditId as string | undefined;
              const outputFiles = Array.isArray(chunk.outputFiles) ? chunk.outputFiles as Array<{ name: string; size: number }> : undefined;
              // Gateway 内部工具完成：更新内联卡片状态
              if (isGateway) {
                setLingxiaMsgs((prev) => {
                  const next = [...prev];
                  const lastIdx = next.length - 1;
                  if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                    const tcs = next[lastIdx].toolCalls || [];
                    // 找到最后一个 gateway running 的卡片
                    const gwIdx = tcs.findLastIndex((tc) => tc._gateway && tc.status === "running");
                    if (gwIdx >= 0) {
                      const updated = [...tcs];
                      updated[gwIdx] = { ...updated[gwIdx], status: "done", durationMs: Date.now() - updated[gwIdx].ts };
                      next[lastIdx] = { ...next[lastIdx], toolCalls: updated };
                    }
                  }
                  return next;
                });
                currentEvent = "";
                continue;
              }
              setLingxiaMsgs((prev) => {
                const next = [...prev];
                const lastIdx = next.length - 1;
                if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                  const tcs = next[lastIdx].toolCalls || [];
                  next[lastIdx] = { ...next[lastIdx], toolCalls: tcs.map((tc) => tc.id === toolCallId ? { ...tc, result, status, durationMs: Date.now() - tc.ts, executor, truncated, suppressedOriginalResult, policyDenyReason, auditId, outputFiles, adoptId: resolvedAdoptId ?? undefined } : tc) };
                }
                return next;
              });
              // 超时时显示警告 3 秒后自动消失；普通完成后立即清除
              if (isTimeout) {
                setActiveToolName(`⏱️ 超时已中断（${Math.round((Date.now() - (activeToolStartMs ?? Date.now())) / 1000)}秒）`);
                setTimeout(() => { setActiveToolName(null); setActiveToolStartMs(null); setActiveToolStep(null); setActiveToolTotal(null); setActiveToolLabel(null); }, 3000);
              } else {
                setActiveToolName(null);
                setActiveToolStartMs(null);
                setActiveToolStep(null);
                setActiveToolTotal(null);
                setActiveToolLabel(null);
              }
              currentEvent = "";
              continue;
            }
            if (currentEvent === "workspace_files") {
              // 技能产出文件（workspace/output/）-> 下载卡片
              const wsFiles = Array.isArray(chunk.files) ? chunk.files as Array<{ name: string; size: number; path: string }> : [];
              const wsAdoptId = String(chunk.adoptId || "");
              if (wsFiles.length > 0) {
                const pseudoTc: import("@/components/ChatMessage").ToolCallEntry = {
                  id: `ws-files-${Date.now()}`,
                  name: "[产出文件]",
                  arguments: "{}",
                  result: wsFiles.map((f) => f.name).join(", "),
                  status: "done",
                  ts: Date.now(),
                  executor: "native",
                  outputFiles: wsFiles.map((f) => ({ name: f.name, size: f.size, wsPath: f.path })) as any,
                  adoptId: wsAdoptId,
                };
                setLingxiaMsgs((prev) => {
                  const next = [...prev];
                  const lastIdx = next.length - 1;
                  if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
                    const existing = next[lastIdx].toolCalls || [];
                    next[lastIdx] = { ...next[lastIdx], toolCalls: [...existing, pseudoTc] };
                  }
                  return next;
                });
              }
              currentEvent = "";
              continue;
            }
            // ── 统一语义：流结束 ──
            if (chunk.__stream_end) {
              console.log("[DIAG] ✅ 收到 __stream_end，流结束");
              flushDelta();
              sseDone = true;
              break;
            }
            // ── 统一语义：终止性错误 ──
            if (chunk.__stream_error) {
              console.log("[DIAG] ❌ 收到 __stream_error:", chunk.error);
              flushDelta();
              setLingxiaMsgs((prev) => {
                const next = [...prev];
                if (next.length === 0 || next[next.length - 1].role !== "assistant") return prev;
                next[next.length - 1] = { ...next[next.length - 1], text: `（${chunk.error || "连接异常"}）` };
                return next;
              });
              sseDone = true;
              break;
            }
            if (chunk.error) {
              flushDelta();
              setLingxiaMsgs((prev) => {
                const next = [...prev];
                if (next.length === 0 || next[next.length - 1].role !== "assistant") return prev;
                next[next.length - 1] = { ...next[next.length - 1], text: `（${chunk.error}）` };
                return next;
              });
              continue;
            }
            const deltaRaw = chunk?.choices?.[0]?.delta?.content;
            // content 有时是对象数组（MiniMax/GLM 等模型），需提取文本
            const delta = Array.isArray(deltaRaw)
              ? deltaRaw.map((c: any) => (typeof c === "string" ? c : (c?.text ?? ""))).join("")
              : (typeof deltaRaw === "string" ? deltaRaw : (deltaRaw != null ? String(deltaRaw) : ""));
            if (delta) {
              pendingDelta += delta;
              scheduleFlush();
            }
          } catch {
            // 忽略非 JSON 行
          }
        }
      }

      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushDelta();

      perf.clientDoneMs = Date.now();
      const toDur = (a?: number, b?: number) => (a && b ? Math.max(0, b - a) : null);
      // 控制台最小埋点：用于定位慢在模型/后端首包/前端首刷
      console.table({
        totalMs: toDur(perf.clientSendMs, perf.clientDoneMs),
        clientToServerEnterMs: toDur(perf.clientSendMs, perf.routeEnterMs),
        serverEnterToGatewayReqMs: toDur(perf.routeEnterMs, perf.gatewayRequestStartMs),
        gatewayReqToFirstUpstreamChunkMs: toDur(perf.gatewayRequestStartMs, perf.upstreamFirstChunkMs),
        firstUpstreamChunkToFirstPaintMs: toDur(perf.upstreamFirstChunkMs, perf.firstPaintMs),
        firstPaintToDoneMs: toDur(perf.firstPaintMs, perf.clientDoneMs),
      });
    } catch (error: any) {
      if (error?.name === "AbortError") {
        setLingxiaMsgs((prev) => {
          const next = [...prev];
          if (next.length > 0 && next[next.length - 1].role === "assistant" && next[next.length - 1].text === "") {
            next[next.length - 1] = { ...next[next.length - 1], text: "（已停止生成）" };
          }
          return next;
        });
        return;
      }
      // 网络错误 / fetch 失败 → 进入"重连中"状态，不直接判任务失败
      setConnStatus("reconnecting");
      setLingxiaMsgs((prev) => {
        const next = [...prev];
        const msg = error?.message || "实时连接中断，正在尝试恢复…";
        if (next.length > 0 && next[next.length - 1].role === "assistant" && next[next.length - 1].text === "") {
          next[next.length - 1] = { ...next[next.length - 1], text: msg };
        } else {
          next.push({ role: "assistant", text: msg, timeLabel: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) });
        }
        return next;
      });
    } finally {
      lingxiaStreamAbortRef.current = null;
      if (!wsOk) setLingxiaStreaming(false);
      setConnStatus("connected");
      setActiveToolName(null);
      setActiveToolStartMs(null);
      setActiveToolStep(null);
      setActiveToolTotal(null);
      setActiveToolLabel(null);
    }
  };


  const resetLingxiaSession = async () => {
    if (!resolvedAdoptId || lingxiaStreaming) return;
    if (!window.confirm("确认重置会话？将清空当前会话上下文。")) return;

    try {
      setLingxiaStreaming(true);
      const apiBase = import.meta.env.VITE_API_URL || "";
      const resp = await fetch(`${apiBase}/api/claw/chat-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ adoptId: resolvedAdoptId, message: "/reset" }),
      });

      if (!resp.ok) throw new Error(`重置失败 (${resp.status})`);
      setLingxiaMsgs([]); localStorage.removeItem("lingxia-chat-history");
      // 不需要断 WS：后端已通过 OpenClaw 原生 sessions.reset 换了 sessionId，
      // session key 不变，现有 WS 连接继续用即可，下次发消息打到新 sessionId 上
      toast.success("会话已重置（新会话）");
    } catch (error: any) {
      toast.error(error?.message || "重置会话失败");
    } finally {
      setLingxiaStreaming(false);
    }
  };

  const saveLingxiaSettings = async () => {
    if (!resolvedAdoptId || !user) {
      toast.error("请先登录后再保存设置");
      return;
    }
    await updateClawSettingsMutation.mutateAsync({
      adoptId: resolvedAdoptId,
      memoryEnabled: lingxiaMemoryEnabled,
      contextTurns: lingxiaContextTurns,
    });
  };

  useEffect(() => {
    if (!isLingxiaSubdomain) return;

    const versionTimer = window.setTimeout(() => {
      fetch("/api/meta/openclaw-version")
        .then(r => r.json())
        .then(d => {
          const v = (d?.version || "").toString().trim();
          if (v) setOpenclawVersion(v);
        })
        .catch(() => {});
    }, 1200);

    let runtimeTimer: number | null = null;
    if (resolvedAdoptId) {
      runtimeTimer = window.setTimeout(() => {
        fetch(`/api/claw/runtime-info?adoptId=${encodeURIComponent(resolvedAdoptId)}`)
          .then(r => r.json())
          .then(d => setRuntimeAgentId(String(d?.runtimeAgentId || "")))
          .catch(() => setRuntimeAgentId(""));
      }, 1600);
    }

    return () => {
      clearTimeout(versionTimer);
      if (runtimeTimer !== null) clearTimeout(runtimeTimer);
    };
  }, [isLingxiaSubdomain, resolvedAdoptId]);

  // 灵虾聊天消息区：仅在接近底部时自动跟随
  const lingxiaMsgsEndRef = useRef<HTMLDivElement>(null);
  const isLingxiaNearBottom = () => {
    const el = lingxiaMsgViewportRef.current;
    if (!el) return true;
    const threshold = 100;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  };
  const scrollLingxiaToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = lingxiaMsgViewportRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };
  useEffect(() => {
    if (lingxiaNearBottom) {
      scrollLingxiaToBottom(lingxiaStreaming ? "auto" : "smooth");
    }
  }, [lingxiaMsgs, lingxiaNearBottom, lingxiaStreaming]);

  // 技能行子组件
  // 技能行组件（内联，避免 Hook 规则问题）
  const SkillRow = ({ sk, onToggle, pending }: { sk: { id: string; emoji: string; label: string; desc: string; active: boolean }; onToggle: () => void; pending: boolean }) => (
    <div className="flex items-center px-4 py-2 gap-2">
      <span style={{ fontSize: 14 }}>{sk.emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: sk.active ? "var(--oc-text-primary)" : "#70788e" }}>{sk.label}</p>
        <p className="text-xs truncate" style={{ color: "#5f667b" }}>{sk.desc}</p>
      </div>
      <button onClick={onToggle} disabled={pending}
        className="shrink-0 relative rounded-full transition-colors"
        style={{ width: 30, height: 16, background: sk.active ? "#9e1822" : "rgba(255,255,255,0.08)", border: "none", cursor: "pointer", flexShrink: 0 }}>
        <span className="absolute top-[2px] rounded-full transition-all"
          style={{ width: 12, height: 12, background: "#fff", left: sk.active ? 16 : 2, opacity: sk.active ? 1 : 0.4 }} />
      </button>
    </div>
  );

  const lingxiaExpiryInfo = useMemo(() => ({ text: "长期持有", color: "#22c55e" }), []);

  const navLabel = (key: string) => LINGXIA_SIDEBAR_NAV.find((i) => i.key === key)?.label || key;
  const NavIcon = ({ navKey }: { navKey: keyof typeof sidebarIconMap }) => {
    const Cmp = sidebarIconMap[navKey];
    return <Cmp size={14} className="sidebar-item-icon" style={{ color: "var(--oc-text-secondary)" }} />;
  };
  if (isLingxiaSubdomain) {
    return (
      <>
      <div className="h-screen overflow-hidden flex flex-col lingxia-shell" style={{ background: "var(--oc-bg)", color: "var(--oc-text-primary)" }}>

        {/* 智能体广场抽屉（动效在 CollabDrawer 内部实现） */}
        {collabOpen && <CollabDrawer onClose={() => setCollabOpen(false)} adoptId={resolvedAdoptId || ""} />}

        {/* ── Body ── */}
        <div className="flex-1 min-h-0 flex overflow-hidden">

          {/* ── 左侧：折叠面板，对齐 OpenClaw sidebar ── */}
          <aside className="relative flex-none flex flex-col overflow-hidden shrink-0 hide-all-scrollbars" style={{ width: sidebarCollapsed ? 72 : sidebarWidth, background: "var(--oc-panel)", borderRight: "1px solid var(--border)", transition: "width 0.2s ease" }}>
            <button
              type="button"
              title={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}
              onClick={() => setSidebarCollapsed(v => !v)}
              className="absolute right-2 top-2 z-40 w-6 h-6 rounded-md text-xs"
              style={{ background: "var(--oc-card)", border: "1px solid var(--oc-border)", color: "var(--oc-text-secondary)" }}
            >
              {sidebarCollapsed ? "»" : "«"}
            </button>

            {/* 实例信息头 */}
            <div className="px-4 py-3 shrink-0 flex items-center gap-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center lingxia-avatar-ai"><BrandIcon size={26} animate={true} /></div>
              <div className="min-w-0" style={{ display: sidebarCollapsed ? "none" : "block" }}>
                <p className="text-sm font-medium truncate" style={{ color: "var(--oc-text-primary)" }}>{lingxiaDisplayName || brand.name}</p>
                <p className="text-[11px] font-mono truncate" style={{ color: "#697086" }} title={resolvedAdoptId}>{resolvedAdoptId}</p>
                {clawByAdoptId && (
                  <p className="text-[11px] flex items-center gap-1" style={{ color: clawByAdoptId.status === "active" ? "#34d399" : "#fbbf24" }}>
                    <span className={clawByAdoptId.status === "active" ? "animate-pulse" : ""}>●</span>
                    <span>{clawByAdoptId.status === "active" ? "在线" : clawByAdoptId.status}</span>
                  </p>
                )}
              </div>
            </div>

            {/* 控制台导航（Phase A） */}
            <Sidebar activePage={activePage} setActivePage={setActivePage} collapsed={sidebarCollapsed} />

            {/* 旧侧栏能力暂留（Phase B 迁移），当前隐藏 */}
                        <SidebarFooter
              version={openclawVersion}
              expiryText={lingxiaExpiryInfo.text}
              expiryColor={lingxiaExpiryInfo.color}
              collapsed={sidebarCollapsed}
              onDocsClick={() => setActivePage("docs")}
            />

            <div
              onMouseDown={(e) => {
                e.preventDefault();
                const onMove = (ev: MouseEvent) => {
                  const w = Math.min(Math.max(ev.clientX, 220), 520);
                  setSidebarWidth(w);
                };
                const onUp = () => {
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                  document.body.style.cursor = "";
                  document.body.style.userSelect = "";
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
              }}
              className="absolute top-0 right-0 w-2 h-full cursor-col-resize z-30 border-l border-dashed border-transparent hover:border-primary/30 hover:bg-white/5 transition-colors"
              style={{ display: sidebarCollapsed ? "none" : "block" }}
            />
          </aside>


          {/* ── 右侧主面板 ── */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* 全局顶部栏 */}
          <TopBar
            activePage={activePage}
            center={activePage === "chat" ? (
              <>
                <Select value={lingxiaModelId} onValueChange={(v) => {
                  setLingxiaModelId(v);
                  if (!user) { toast.error("请先登录"); return; }
                  switchModelMutation.mutate({ adoptId: resolvedAdoptId!, modelId: v });
                }}>
                  <SelectTrigger
                    size="sm"
                    className="focus:ring-0 focus:ring-offset-0"
                    style={{
                      height: 30,
                      paddingLeft: 12,
                      paddingRight: 10,
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid var(--oc-border)",
                      color: "var(--oc-text-primary)",
                      fontSize: 12,
                      fontFamily: '"SF Mono", "Cascadia Code", "Fira Code", "Consolas", ui-monospace, monospace',
                      fontWeight: 500,
                      borderRadius: 8,
                      minWidth: 220,
                    }}
                  >
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent
                    style={{
                      background: "var(--oc-bg)",
                      border: "1px solid var(--oc-border)",
                      borderRadius: 10,
                      minWidth: 300,
                      boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
                      padding: "4px",
                    }}
                  >
                    {(availableModels || []).map((m: any) => {
                      const parts = String(m.id).split("/");
                      const modelName = parts.length > 1 ? parts[parts.length - 1] : m.id;
                      const provider = parts.length > 1 ? parts[0] : "";
                      return (
                        <SelectItem
                          key={m.id}
                          value={m.id}
                          className="lingxia-model-item"
                          style={{
                            fontSize: 12,
                            fontFamily: '"SF Mono", "Cascadia Code", "Fira Code", "Consolas", ui-monospace, monospace',
                            fontWeight: 500,
                            borderRadius: 6,
                            padding: "7px 10px",
                            cursor: "pointer",
                          }}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {m.isDefault && (
                              <span style={{ color: "var(--oc-accent)", fontSize: 10, flexShrink: 0 }}>★</span>
                            )}
                            <span style={{ color: "var(--oc-text-primary)" }}>{modelName}</span>
                            {provider && (
                              <span style={{ color: "var(--oc-text-secondary)", fontSize: 11, opacity: 0.6 }}>
                                · {provider}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <button
                  onClick={resetLingxiaSession}
                  disabled={lingxiaStreaming}
                  className="lingxia-topbar-btn"
                  style={{ height: 30, padding: "0 12px", borderRadius: 8, fontSize: 12, whiteSpace: "nowrap" }}
                >
                  重置会话
                </button>
              </>
            ) : undefined}
            right={activePage === "chat" ? (
              <button
                onClick={() => {
                  const profile = (clawByAdoptId as any)?.permissionProfile || "starter";
                  if (profile === "starter") {
                    toast.info("智能体广场需要 Plus 套餐");
                    return;
                  }
                  setCollabOpen(true);
                }}
                className={`lingxia-topbar-btn ${collabOpen ? "is-active" : ""}`}
                style={{ height: 30, padding: "0 12px", display: "flex", alignItems: "center", gap: 6, borderRadius: 8, fontSize: 12, whiteSpace: "nowrap" }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                </svg>
                智能体协作
              </button>
            ) : undefined}
          />

          {activePage === "chat" ? (
          <ChatPage>
          <main className="relative flex-1 min-w-0 flex flex-col overflow-hidden">

            {/* 消息区 */}
            <div
              ref={lingxiaMsgViewportRef}
              onScroll={() => setLingxiaNearBottom(isLingxiaNearBottom())}
              className="flex-1 min-h-0 overflow-y-auto pt-6 px-6 space-y-5 stealth-scrollbar" style={{ paddingBottom: 100 }}
            >


              {clawByAdoptLoading && <p className="text-sm" style={{ color: "#697086" }}>加载中…</p>}

              {!clawByAdoptLoading && !clawByAdoptId && (
                <div className="max-w-4xl rounded-xl p-4 text-sm" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", color: "#d4a030" }}>
                  未找到该灵虾实例，可能已过期或尚未完成创建。
                </div>
              )}

              {!clawByAdoptLoading && clawByAdoptId && lingxiaMsgs.length === 0 && (
                /* 欢迎消息：带头像，对齐 OpenClaw AI 消息风格 */
                <div className="flex items-start gap-3 max-w-4xl lingxia-msg-fade">
                  <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center lingxia-avatar-ai" style={{ marginTop: 2 }}><BrandIcon size={22} animate={false} /></div>
                  <div>
                    <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed" style={{ background: "color-mix(in oklab, var(--oc-card) 65%, transparent)", color: "var(--oc-text-primary)" }}>
                      你好，我是 <span style={{ color: "var(--oc-accent, #7c3aed)", fontWeight: 600 }}>{lingxiaDisplayName || brand.name}</span>，有什么想聊的？
                    </div>
                    <p className="text-[10px] mt-1 px-1 font-mono" style={{ color: "#5f667b" }}>{lingxiaDisplayName || brand.name} · {prettyLingxiaModelName(lingxiaModelId || "default")}</p>
                  </div>
                </div>
              )}

              {lingxiaMsgs.map((m, idx) => {
                const isLast = idx === lingxiaMsgs.length - 1;
                const isPlaceholder = isLast && m.role === "assistant" && m.text === "" && lingxiaStreaming;
                return (
                  <div key={idx}>
                  <ChatMessage
                    role={m.role as "user" | "assistant"}
                    text={m.text}
                    isLast={isLast}
                    isPlaceholder={isPlaceholder}
                    streaming={lingxiaStreaming}
                    displayName={lingxiaDisplayName || brand.name}
                    modelId={lingxiaModelId || "default"}
                    timeLabel={m.timeLabel}
                    toolCalls={m.role === "assistant" ? (m.toolCalls ?? (isLast && lingxiaStreaming ? lingxiaToolCalls : [])) : undefined}
                    showToolCalls={lingxiaShowToolCalls}
                    usage={m.usage}
                    contextPercent={m.contextPercent}
                    onDelete={m.role === "assistant" ? () => { setLingxiaMsgs(prev => prev.filter((_, i) => i !== idx)); } : undefined}
                  />
                  {/* 协作推荐卡片按钮 */}
                  {(m as any).collabSuggestion && (
                    <div className="flex gap-2 ml-12 mt-2 mb-1 lingxia-msg-fade">
                      <button
                        className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                        style={{ background: "var(--oc-accent, #6366f1)", color: "#fff", border: "none", cursor: "pointer", opacity: 0.9 }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.9"; e.currentTarget.style.transform = "none"; }}
                        onClick={() => {
                          setCollabOpen(true);
                          // 存预填信息到 sessionStorage，CollabDrawer 读取
                          try {
                            const cs = (m as any).collabSuggestion;
                            sessionStorage.setItem("collab_prefill", JSON.stringify({ agentId: cs.agentId, prompt: cs.originalPrompt }));
                          } catch {}
                        }}
                      >
                        {(m as any).collabSuggestion.agentEmoji} 打开助手
                      </button>
                      <button
                        className="px-4 py-2 rounded-lg text-sm transition-all"
                        style={{ background: "rgba(255,255,255,0.06)", color: "var(--oc-text-secondary)", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                        onClick={() => {
                          // 删掉推荐卡片，设 skipCollab，重新发送给 Agent
                          const originalText = (m as any).collabSuggestion.originalPrompt;
                          setLingxiaMsgs((prev) => prev.filter((_, i) => i !== idx && i !== idx - 1));
                          skipCollabRef.current = true;
                          setLingxiaInput(originalText);
                          setTimeout(() => sendLingxiaMessage(), 50);
                        }}
                      >
                        💬 继续对话
                      </button>
                    </div>
                  )}
                  </div>
                );
              })}

              <div ref={lingxiaMsgsEndRef} />
            </div>

            {!lingxiaNearBottom && (
              <div className="pointer-events-none absolute right-8 bottom-24 z-20">
                <button
                  className="pointer-events-auto text-xs px-3 py-1.5 rounded-full shadow-md"
                  style={{ background: "rgba(24,28,45,0.92)", border: "1px solid rgba(255,255,255,0.12)", color: "#d7dcef" }}
                  onClick={() => { setLingxiaNearBottom(true); scrollLingxiaToBottom("smooth"); }}
                >
                  回到底部
                </button>
              </div>
            )}

            {/* 输入区 */}
            <ChatInput
              value={lingxiaInput}
              onChange={setLingxiaInput}
              onSend={sendLingxiaMessage}
              onStop={stopLingxiaStreaming}
              streaming={lingxiaStreaming}
              disabled={false}
              placeholder={`Message ${lingxiaDisplayName || brand.name}…`}
              maxLength={4000}
              messages={lingxiaMsgs}
              onNewChat={resetLingxiaSession}
            />

          </main>
          </ChatPage>
          ) : (
            <MainPanel
              activePage={activePage as Exclude<PageKey, "chat">}
              adoptId={resolvedAdoptId || ""}
              settings={{
                memoryEnabled: lingxiaMemoryEnabled,
                setMemoryEnabled: (v) => setLingxiaMemoryEnabled(v),
                contextTurns: lingxiaContextTurns,
                setContextTurns: (v) => setLingxiaContextTurns(v),
                canSave: !!user,
                saving: updateClawSettingsMutation.isPending,
                onSave: saveLingxiaSettings,
              }}
              skills={{
                data: lingxiaSkills as any,
                canEdit: !!user,
                pending: toggleSkillMutation.isPending,
                adoptId: resolvedAdoptId || "",
                onToggle: (skillId, enable, source) => {
                  if (!user) { toast.error("请先登录"); return; }
                  toggleSkillMutation.mutate({ adoptId: resolvedAdoptId!, skillId, enable, source });
                },
              }}
            />
          )}
          </div>
        </div>
      </div>
      </>
    );
  }

  // Linggan homepage code removed — this route always resolves to lingxia console
  return null;

}
