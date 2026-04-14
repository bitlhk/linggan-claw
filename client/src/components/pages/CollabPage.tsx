import { useState, useEffect, useRef } from "react";
import { Zap } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageContainer } from "@/components/console/PageContainer";
import { Users, Settings2, Send, Inbox, Globe, Presentation, Code2, TrendingUp, Bot } from "lucide-react";

type CollabTab = "biz" | "settings" | "directory" | "incoming" | "outgoing";

function collabAgentIcon(id: string, size = 20) {
  const style = { color: "var(--oc-accent)" };
  if (id === "task-ppt") return <Presentation size={size} style={style} />;
  if (id === "task-code") return <Code2 size={size} style={style} />;
  if (id === "task-finance") return <TrendingUp size={size} style={style} />;
  return <Bot size={size} style={style} />;
}

const TASK_TYPE_OPTIONS = [
  { value: "data_analysis", label: "数据分析" },
  { value: "contract_review", label: "合同审阅" },
  { value: "research", label: "研究调查" },
  { value: "report", label: "报告生成" },
  { value: "general", label: "通用协作" },
];

// ── SSE hook：Agent 2 实时流 ──────────────────────────────────────────
function useCollabStream(requestId: number | null, enabled: boolean) {
  const [chunks, setChunks] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || !requestId) return;
    setChunks([]); setDone(false);
    const es = new EventSource("/api/claw/collab-stream/" + requestId + "?_t=" + Date.now());
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.done) { setDone(true); es.close(); }
        else if (d.chunk) { setChunks(c => [...c, d.chunk]); }
      } catch (_) {}
    };
    es.onerror = () => { setDone(true); es.close(); };
    return () => { es.close(); };
  }, [requestId, enabled]);

  return { text: chunks.join(""), done };
}

// ── SSE hook：Agent 1 等待完成推送 ───────────────────────────────────
function useCollabNotify(requestId: number | null, enabled: boolean, onDone: (status: string, resultSummary: string) => void) {
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || !requestId) return;
    const es = new EventSource("/api/claw/collab-notify/" + requestId + "?_t=" + Date.now());
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.done) { es.close(); onDone(d.status || "completed", d.resultSummary || ""); }
      } catch (_) {}
    };
    es.onerror = () => { es.close(); };
    return () => { es.close(); };
  }, [requestId, enabled]);
}


// ── 业务能力（展示用，管理在 Admin 后台）──────────────────────────────
function BizCapabilities() {
  const listQ = trpc.bizAgents.listEnabled.useQuery();
  const agents: any[] = (listQ.data as any) || [];

  return (
    <div className="grid gap-3 max-w-3xl">
      <div className="settings-card">
        <div className="text-xs" style={{ color: "var(--oc-info)" }}>
          ⚡ 以下是平台提供的业务智能体。点击"使用"可在智能体广场浮窗中直接对话。
        </div>
      </div>
      {listQ.isLoading && <div className="settings-card text-xs" style={{ color: "var(--oc-text-secondary)" }}>加载中…</div>}
      {agents.length === 0 && !listQ.isLoading && (
        <div className="settings-card text-xs" style={{ color: "var(--oc-text-secondary)" }}>暂无配置业务 Agent，请联系管理员在后台添加。</div>
      )}
      <div className="grid gap-2">
        {agents.map((a: any) => (
          <div key={a.id} className="settings-card" style={{ padding: "12px 16px" }}>
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center" style={{ width: 24, height: 24 }}>{collabAgentIcon(a.id, 22)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>{a.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{ background: a.kind === "remote" ? "rgba(96,165,250,0.12)" : "rgba(34,197,94,0.12)", color: a.kind === "remote" ? "#60a5fa" : "#22c55e", border: `1px solid ${a.kind === "remote" ? "rgba(96,165,250,0.25)" : "rgba(34,197,94,0.25)"}` }}>
                    {a.kind === "remote" ? "远端" : "本地"}
                  </span>
                </div>
                {a.description && <div className="text-xs mt-0.5" style={{ color: "var(--oc-text-secondary)" }}>{a.description}</div>}
              </div>
              <span className="text-xs px-2 py-1 rounded-lg font-medium shrink-0"
                style={{ background: "var(--oc-bg-active)", border: "1px solid var(--oc-border)", color: "var(--oc-text-secondary)" }}>
                在智能体广场浮窗中使用
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CollabPage({ adoptId }: { adoptId: string }) {
  const [activeTab, setActiveTab] = useState<CollabTab>("biz");
  const [sendTarget, setSendTarget] = useState("");
  const [sendTaskType, setSendTaskType] = useState("general");
  const [sendSummary, setSendSummary] = useState("");
  const [sendStatus, setSendStatus] = useState("");

  // === 设置 ===
  const settingsQ = trpc.collab.getSettings.useQuery({ adoptId }, { enabled: activeTab === "settings" });
  const updateSettings = trpc.collab.updateSettings.useMutation();
  const [form, setForm] = useState<any>({});
  const [formInit, setFormInit] = useState(false);

  useEffect(() => {
    if (settingsQ.data && !formInit) {
      const s = settingsQ.data as any;
      setForm({
        displayName: s.displayName || "",
        headline: s.headline || "",
        visibilityMode: s.visibilityMode || "private",
        acceptDm: s.acceptDm || "off",
        acceptTask: s.acceptTask || "off",
        allowedTaskTypes: s.allowedTaskTypes ? JSON.parse(s.allowedTaskTypes) : [],
        sharingPolicy: s.sharingPolicy || "none",
      });
      setFormInit(true);
    }
  }, [settingsQ.data, formInit]);

  const handleSettingsSave = async () => {
    await updateSettings.mutateAsync({
      adoptId,
      ...form,
      allowedTaskTypes: Array.isArray(form.allowedTaskTypes) ? form.allowedTaskTypes : [],
    });
    setFormInit(false);
    settingsQ.refetch();
    setSendStatus("保存成功");
    setTimeout(() => setSendStatus(""), 2000);
  };

  const settings = settingsQ.data as any;

  // === 目录 ===
  const directoryQ = trpc.collab.directory.useQuery({ adoptId }, { enabled: activeTab === "directory" });

  // === 收到的请求 ===
  const incomingQ = trpc.collab.incoming.useQuery({ adoptId }, { enabled: activeTab === "incoming" });
  const reviewRequest = trpc.collab.reviewRequest.useMutation();
  const submitResult = trpc.collab.submitResult.useMutation();
  const [resultInputs, setResultInputs] = useState<Record<number, string>>({});
  const [envelopeStatus, setEnvelopeStatus] = useState<Record<number, string>>({});  // success/failed/partial/needs_input

  // 当前正在 stream 的 incoming requestId（Agent 2 看实时过程）
  const [streamingReqId, setStreamingReqId] = useState<number | null>(null);
  const collabStream = useCollabStream(streamingReqId, !!streamingReqId);

  // incoming 中如果有 running 的请求，自动开启 stream
  useEffect(() => {
    if (activeTab !== "incoming") return;
    const running = (incomingQ.data as any[])?.find((r: any) => r.status === "running");
    if (running && streamingReqId !== running.id) { setStreamingReqId(running.id); }
    if (!running && streamingReqId) { setStreamingReqId(null); }
  }, [incomingQ.data, activeTab]);

  // stream done → refetch incoming
  useEffect(() => {
    if (collabStream.done && streamingReqId) { incomingQ.refetch(); }
  }, [collabStream.done]);

  // === 发出的请求 ===
  const outgoingQ = trpc.collab.outgoing.useQuery({ adoptId }, { enabled: activeTab === "outgoing" });

  // 当前等待完成的 outgoing requestId（Agent 1 SSE 推送）
  const [watchingReqId, setWatchingReqId] = useState<number | null>(null);

  useCollabNotify(watchingReqId, !!watchingReqId, (status, resultSummary) => {
    setWatchingReqId(null);
    outgoingQ.refetch();
  });

  // outgoing 中若有 pending/approved/running 的请求，自动 watch 最新一条
  useEffect(() => {
    if (activeTab !== "outgoing") return;
    const pending = (outgoingQ.data as any[])?.find((r: any) =>
      ["approved", "running", "pending"].includes(r.status)
    );
    if (pending && watchingReqId !== pending.id) { setWatchingReqId(pending.id); }
    if (!pending) { setWatchingReqId(null); }
  }, [outgoingQ.data, activeTab]);

  const sendRequest = trpc.collab.sendRequest.useMutation();

  const handleSendRequest = async () => {
    if (!sendTarget || !sendSummary) return;
    setSendStatus("发送中...");
    try {
      const r = await sendRequest.mutateAsync({
        requesterAdoptId: adoptId,
        targetAdoptId: sendTarget,
        taskType: sendTaskType,
        taskSummary: sendSummary,
      });
      const riskTag = r.riskLevel === "high" ? " ⚠️ 高风险已降级人工审批" : r.riskLevel === "medium" ? " 🔍 中等风险" : "";
      const statusText = r.status === "approved" ? "✅ 自动审批通过" : "⏳ 等待对方确认";
      setSendStatus("已发送，状态：" + statusText + riskTag + (r.note ? " · " + r.note : ""));
      setSendTarget("");
      setSendSummary("");
      outgoingQ.refetch();
      // 如果已批准，立即开始 watch 结果
      if (r.status === "approved") { setWatchingReqId(Number(r.id)); }
    } catch (e: any) {
      setSendStatus("发送失败：" + (e.message || "未知错误"));
    }
  };

  const tabs: { key: CollabTab; label: string; icon: any }[] = [
    { key: "biz", label: "业务智能体", icon: Zap },
    { key: "settings", label: "我的设置", icon: Settings2 },
    { key: "directory", label: "智能体广场", icon: Globe },
    { key: "incoming", label: "收到的请求", icon: Inbox },
    { key: "outgoing", label: "发出的请求", icon: Send },
  ];

  const statusBadge = (s: string) => {
    const cfg: Record<string, { cls: string; label: string }> = {
      pending:   { cls: "badge-warning",  label: "待确认" },
      approved:  { cls: "badge-info",     label: "已批准" },
      rejected:  { cls: "badge-danger",   label: "已拒绝" },
      running:        { cls: "badge-purple",  label: "执行中" },
      completed:      { cls: "badge-success", label: "已完成" },
      partial_success:{ cls: "badge-warning", label: "部分完成" },
      waiting_input:  { cls: "badge-info",    label: "需补充信息" },
      failed:         { cls: "badge-danger",  label: "失败" },
      cancelled:      { cls: "badge-muted",   label: "已取消" },
    };
    const c = cfg[s] || { cls: "badge-muted", label: s };
    return <span className={`badge ${c.cls}`}>{c.label}</span>;
  };

  const riskBadge = (level: string) => {
    if (level === "high")   return <span className="badge badge-danger">⚠️ 高风险</span>;
    if (level === "medium") return <span className="badge badge-warning">🔍 中等风险</span>;
    return null;
  };

  const autoBadge = (mode: string) => {
    if (mode === "auto") return <span className="badge badge-purple">自动</span>;
    return null;
  };

  return (
    <PageContainer title="智能体协作" icon={<Users size={18} />}>
      <div className="console-tabs">
        {tabs.map(t => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`console-tab ${activeTab === t.key ? "active" : ""}`}
              style={{
                border: "1px solid var(--oc-border)",
                background: active ? "var(--accent-subtle)" : "rgba(255,255,255,0.04)",
                color: active ? "var(--oc-accent)" : "var(--oc-text-secondary)",
              }}
            >
              <Icon size={12} />
              {t.label}
            </button>
          );
        })}
      </div>


      {/* ── 业务能力 ── */}
      {activeTab === "biz" && (
        <BizCapabilities />
      )}

      {/* ── 我的设置 ── */}
      {activeTab === "settings" && (
        <div className="grid gap-3 max-w-2xl">
          <div className="settings-card">
            <div className="text-xs" style={{ color: "var(--oc-info)" }}>
              配置你的虾在组织内的可见性和协作策略。starter 账号无法使用协作功能。
            </div>
          </div>
          <div className="settings-card">
            <div className="text-sm font-semibold mb-3" style={{ color: "var(--oc-text-primary)" }}>基本信息</div>
            <div className="grid gap-3">
              <div className="settings-row">
                <span className="settings-label">显示名称</span>
                <input type="text" placeholder="给你的虾起个名字"
                  value={form.displayName ?? ""}
                  onChange={e => setForm((f: any) => ({ ...f, displayName: e.target.value }))}
                  className="settings-input px-3 py-1.5 text-sm w-full" />
              </div>
              <div className="settings-row">
                <span className="settings-label">简介</span>
                <input type="text" placeholder="一句话描述你的虾能做什么"
                  value={form.headline ?? ""}
                  onChange={e => setForm((f: any) => ({ ...f, headline: e.target.value }))}
                  className="settings-input px-3 py-1.5 text-sm w-full" />
              </div>
            </div>
          </div>
          <div className="settings-card">
            <div className="text-sm font-semibold mb-3" style={{ color: "var(--oc-text-primary)" }}>可见性与权限</div>
            <div className="grid gap-3">
              <div className="settings-row">
                <span className="settings-label">可见模式</span>
                <select value={form.visibilityMode ?? "private"}
                  onChange={e => setForm((f: any) => ({ ...f, visibilityMode: e.target.value }))}
                  className="settings-input px-3 py-1.5 text-sm w-full">
                  <option value="private">🔒 私有（不出现在智能体广场）</option>
                  <option value="org">🏢 组织内可见</option>
                  <option value="public">🌐 全平台可见</option>
                </select>
              </div>
              <div className="settings-row">
                <span className="settings-label">接受聊天</span>
                <select value={form.acceptDm ?? "off"}
                  onChange={e => setForm((f: any) => ({ ...f, acceptDm: e.target.value }))}
                  className="settings-input px-3 py-1.5 text-sm w-full">
                  <option value="off">不接受</option>
                  <option value="org">组织内成员</option>
                  <option value="specified">仅指定 Agent</option>
                </select>
              </div>
              <div className="settings-row">
                <span className="settings-label">接受任务</span>
                <select value={form.acceptTask ?? "off"}
                  onChange={e => setForm((f: any) => ({ ...f, acceptTask: e.target.value }))}
                  className="settings-input px-3 py-1.5 text-sm w-full">
                  <option value="off">不接受</option>
                  <option value="approval">需要我审批（推荐）</option>
                  <option value="auto">自动接受——仅限白名单字段，高风险自动降级</option>
                </select>
              </div>
              {form.acceptTask === "auto" && (
                <div className="text-xs badge badge-warning" style={{ gridColumn: "1 / -1" }}>
                  ⚠️ auto 模式下平台强制字段白名单（input/query/file 等），高风险任务自动降级为人工审批。
                </div>
              )}
            </div>
          </div>
          <div className="settings-card">
            <div className="text-sm font-semibold mb-2" style={{ color: "var(--oc-text-primary)" }}>可协助的任务类型</div>
            <div className="flex flex-wrap gap-2 mb-2">
              {TASK_TYPE_OPTIONS.map(opt => {
                const selectedList: string[] = form.allowedTaskTypes || [];
                const selected = selectedList.includes(opt.value);
                return (
                  <button key={opt.value} onClick={() => {
                    const cur = form.allowedTaskTypes || (settings?.allowedTaskTypes ? JSON.parse(settings.allowedTaskTypes) : []);
                    const next = selected ? cur.filter((v: string) => v !== opt.value) : [...cur, opt.value];
                    setForm((f: any) => ({ ...f, allowedTaskTypes: next }));
                  }} className={`skills-chip ${selected ? "skills-chip--active" : ""}`}>{opt.label}</button>
                );
              })}
            </div>
            <div className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>auto 模式下仅接受列表内任务类型，外部请求会被拒绝。</div>
          </div>
          <div className="settings-card">
            <div className="text-sm font-semibold mb-2" style={{ color: "var(--oc-text-primary)" }}>数据共享策略</div>
            <select value={form.sharingPolicy ?? "none"}
              onChange={e => setForm((f: any) => ({ ...f, sharingPolicy: e.target.value }))}
              className="settings-input px-3 py-1.5 text-sm w-full mb-2">
              <option value="none">🔒 不共享任何数据（最安全）</option>
              <option value="result-only">📋 仅共享任务结果摘要</option>
            </select>
            <div className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>⚠️ 聊天记录、私有记忆、使用明细是平台铁律，永远不会被任何协作任务访问。</div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleSettingsSave} disabled={updateSettings.isLoading} className="btn-primary-soft">
              {updateSettings.isLoading ? "保存中…" : "保存设置"}
            </button>
            {sendStatus && <span className="badge badge-success">{sendStatus}</span>}
          </div>
        </div>
      )}

      {/* ── 智能体广场 ── */}
      {activeTab === "directory" && (
        <div className="grid gap-3 max-w-3xl">
          <div className="settings-card">
            <div className="text-xs" style={{ color: "var(--oc-info)" }}>
              🛡️ <strong>平台安全保证</strong>：所有协作请求均为任务委托模式，不是会话直通。对方永远无法访问你的聊天记录、私有记忆或使用明细。auto 模式输入严格白名单过滤，结果摘要平台强制检查禁止词。
            </div>
          </div>
          <div className="settings-card">
            <div className="text-sm font-semibold mb-2" style={{ color: "var(--oc-text-primary)" }}>可协作 Agent</div>
            <div className="text-xs mb-3" style={{ color: "var(--oc-text-secondary)" }}>以下是当前可接受协作的 Agent，可向他们发起任务请求。</div>
            {directoryQ.isLoading && <div className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>加载中…</div>}
            {directoryQ.data?.length === 0 && <div className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>暂无其他 Agent 公开协作。告诉你的伙伴在设置里把可见性改成"组织内"。</div>}
            <div className="grid gap-3">
              {(directoryQ.data || []).map((agent: any) => (
                <div key={agent.adoptId} className="settings-card" style={{ padding: "10px 14px" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>{agent.displayName}</div>
                      {agent.headline && <div className="text-xs mt-0.5" style={{ color: "var(--oc-text-secondary)" }}>{agent.headline}</div>}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {(agent.allowedTaskTypes || []).map((t: string) => {
                          const label = TASK_TYPE_OPTIONS.find(o => o.value === t)?.label || t;
                          return <span key={t} className="badge badge-muted">{label}</span>;
                        })}
                      </div>
                    </div>
                    <div className="text-xs shrink-0" style={{ color: "var(--oc-text-secondary)" }}>
                      <div>{agent.acceptTask === "auto" ? "✅ 自动接受" : agent.acceptTask === "approval" ? "🔍 需审批" : "❌ 不接受任务"}</div>
                    </div>
                  </div>
                  {agent.acceptTask !== "off" && (
                    <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--oc-border)" }}>
                      <div className="flex gap-2">
                        <select value={sendTarget === agent.adoptId ? sendTaskType : "general"}
                          onChange={e => { setSendTarget(agent.adoptId); setSendTaskType(e.target.value); }}
                          className="settings-input px-2 py-1 text-xs rounded">
                          {TASK_TYPE_OPTIONS.filter(o => agent.allowedTaskTypes?.includes(o.value) || o.value === "general").map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        <input type="text" placeholder="任务描述（不要输入隐私内容）"
                          value={sendTarget === agent.adoptId ? sendSummary : ""}
                          onChange={e => { setSendTarget(agent.adoptId); setSendSummary(e.target.value); }}
                          className="settings-input px-2 py-1 text-xs rounded flex-1" />
                        <button onClick={handleSendRequest} className="btn-primary-soft shrink-0" style={{ padding: "0 12px", height: 28, fontSize: "var(--oc-text-sm)" }}>发起</button>
                      </div>
                      {sendTarget === agent.adoptId && sendStatus && <div className="text-xs mt-1" style={{ color: "var(--oc-text-secondary)" }}>{sendStatus}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── 收到的请求（Agent 2 视角，有实时流）── */}
      {activeTab === "incoming" && (
        <div className="grid gap-3 max-w-3xl">
          <div className="settings-card">
            <div className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>
              其他 Agent 向你发起的协作请求。你的聊天记录和记忆不会被对方访问——这是平台铁律。
            </div>
          </div>
          {incomingQ.isLoading && <div className="settings-card text-xs" style={{ color: "var(--oc-text-secondary)" }}>加载中…</div>}
          {incomingQ.data?.length === 0 && <div className="settings-card text-xs" style={{ color: "var(--oc-text-secondary)" }}>暂无收到的协作请求。</div>}
          {(incomingQ.data || []).map((req: any) => (
            <div key={req.id} className="settings-card">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>来自 {req.requesterDisplayName || req.requesterAdoptId}</span>
                <div className="flex items-center gap-1.5">
                  {riskBadge(req.riskLevel)}
                  {autoBadge(req.approvalMode)}
                  {statusBadge(req.status)}
                </div>
              </div>
              <div className="text-sm font-medium mb-0.5" style={{ color: "var(--oc-text-primary)" }}>{req.taskSummary}</div>
              <div className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>类型：{TASK_TYPE_OPTIONS.find(o => o.value === req.taskType)?.label || req.taskType}</div>

              {req.status === "pending" && (
                <div className="flex gap-2 mt-2">
                  <button onClick={async () => { await reviewRequest.mutateAsync({ adoptId, requestId: req.id, action: "approve" }); incomingQ.refetch(); }}
                    className="btn-primary-soft" style={{ height: 28, fontSize: "var(--oc-text-sm)", padding: "0 12px" }}>批准</button>
                  <button onClick={async () => { await reviewRequest.mutateAsync({ adoptId, requestId: req.id, action: "reject" }); incomingQ.refetch(); }}
                    className="skills-btn" style={{ height: 28, fontSize: "var(--oc-text-sm)" }}>拒绝</button>
                </div>
              )}

              {/* Agent 2 实时执行流 */}
              {req.status === "running" && streamingReqId === req.id && (
                <div className="mt-2 settings-card" style={{ background: "rgba(0,0,0,0.15)", fontFamily: "monospace" }}>
                  <div className="text-xs mb-1" style={{ color: "var(--oc-info)" }}>⚡ 实时执行过程（仅你可见）</div>
                  <div className="text-xs whitespace-pre-wrap" style={{ color: "var(--oc-text-secondary)", maxHeight: 200, overflowY: "auto" }}>
                    {collabStream.text || "等待 Agent 响应…"}
                    {!collabStream.done && <span className="animate-pulse">▌</span>}
                  </div>
                  {collabStream.done && <div className="text-xs mt-1 badge badge-success">✅ 执行完成</div>}
                </div>
              )}

              {req.status === "approved" && !req.resultSummary && (
                <div className="mt-2 settings-card grid gap-2">
                  <div className="text-xs font-medium" style={{ color: "var(--oc-text-secondary)" }}>📤 提交执行结果（结构化 Result Envelope）</div>
                  <div className="flex gap-2 items-center">
                    <span className="text-xs shrink-0" style={{ color: "var(--oc-text-secondary)" }}>状态</span>
                    <select value={envelopeStatus[req.id] || "success"}
                      onChange={e => setEnvelopeStatus(s => ({ ...s, [req.id]: e.target.value }))}
                      className="settings-input px-2 py-1 text-xs rounded">
                      <option value="success">✅ 成功完成</option>
                      <option value="partial">⚠️ 部分完成</option>
                      <option value="needs_input">💬 需要补充信息</option>
                      <option value="failed">❌ 执行失败</option>
                    </select>
                  </div>
                  <textarea rows={3} placeholder="执行摘要（必填，描述做了什么、结论是什么，禁止包含内部引用）"
                    value={resultInputs[req.id] || ""}
                    onChange={e => setResultInputs(r => ({ ...r, [req.id]: e.target.value }))}
                    className="settings-input px-2 py-1 text-xs rounded w-full resize-none" />
                  <button onClick={async () => {
                    const envStatus = (envelopeStatus[req.id] || "success") as any;
                    const dbStatus = envStatus === "partial" ? "partial_success" : envStatus === "needs_input" ? "waiting_input" : envStatus === "failed" ? "failed" : "completed";
                    await submitResult.mutateAsync({
                      adoptId, requestId: req.id,
                      resultEnvelope: { status: envStatus, summary: resultInputs[req.id] || "" },
                      status: dbStatus,
                    } as any);
                    incomingQ.refetch();
                  }} className="btn-primary-soft" style={{ height: 28, fontSize: "var(--oc-text-sm)", padding: "0 12px", width: "fit-content" }}>提交结果</button>
                </div>
              )}

              {req.resultSummary && <div className="text-xs mt-1.5" style={{ color: "var(--oc-text-secondary)", fontStyle: "italic" }}>结果：{req.resultSummary}</div>}
            </div>
          ))}
        </div>
      )}

      {/* ── 发出的请求（Agent 1 视角，SSE 推送）── */}
      {activeTab === "outgoing" && (
        <div className="grid gap-3 max-w-3xl">
          <div className="settings-card">
            <div className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>
              你向其他 Agent 发起的协作任务记录。执行完成后将自动推送结果，无需手动刷新。
            </div>
          </div>
          {outgoingQ.isLoading && <div className="settings-card text-xs" style={{ color: "var(--oc-text-secondary)" }}>加载中…</div>}
          {outgoingQ.data?.length === 0 && <div className="settings-card text-xs" style={{ color: "var(--oc-text-secondary)" }}>暂未发起任何协作请求。</div>}
          {(outgoingQ.data || []).map((req: any) => (
            <div key={req.id} className="settings-card">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>发给 {req.targetDisplayName || req.targetAdoptId}</span>
                <div className="flex items-center gap-1.5">
                  {riskBadge(req.riskLevel)}
                  {autoBadge(req.approvalMode)}
                  {statusBadge(req.status)}
                </div>
              </div>
              <div className="text-sm mb-0.5" style={{ color: "var(--oc-text-primary)" }}>{req.taskSummary}</div>
              <div className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>类型：{TASK_TYPE_OPTIONS.find(o => o.value === req.taskType)?.label || req.taskType}</div>

              {/* SSE 等待中提示 */}
              {(req.status === "running" || req.status === "approved") && !req.resultSummary && watchingReqId === req.id && (
                <div className="flex items-center gap-1.5 mt-1.5 text-xs" style={{ color: "var(--oc-info)" }}>
                  <span className="animate-pulse">🔔</span> 对方执行中，完成后将自动推送结果…
                </div>
              )}
              {req.status === "pending" && (
                <div className="flex items-center gap-1.5 mt-1.5 text-xs" style={{ color: "var(--oc-text-secondary)" }}>
                  ⏳ 等待对方确认
                </div>
              )}

              {/* L1: 结果状态 */}
              {req.resultEnvelope && (
                <div className="mt-2 grid gap-2">
                  {/* L2: 执行摘要 */}
                  <div>
                    <div className="text-xs font-medium mb-1" style={{ color: "var(--oc-success)" }}>
                      {req.resultEnvelope.status === "success" ? "✅" : req.resultEnvelope.status === "partial" ? "⚠️" : req.resultEnvelope.status === "needs_input" ? "💬" : "❌"}
                      {" 执行摘要"}
                    </div>
                    <div className="text-xs settings-card whitespace-pre-wrap" style={{ color: "var(--oc-text-secondary)", maxHeight: 160, overflowY: "auto" }}>
                      {req.resultEnvelope.summary || req.resultSummary || "（无摘要）"}
                    </div>
                    {req.resultEnvelope.limitations && (
                      <div className="text-xs mt-1 badge badge-warning">⚠️ 局限：{req.resultEnvelope.limitations}</div>
                    )}
                    {req.resultEnvelope.error_info && (
                      <div className="text-xs mt-1 badge badge-danger">错误：{req.resultEnvelope.error_info}</div>
                    )}
                  </div>
                  {/* L3: 产物索引 */}
                  {(req.resultEnvelope.artifacts?.length > 0 || req.resultEnvelope.structured_outputs) && (
                    <div>
                      <div className="text-xs font-medium mb-1" style={{ color: "var(--oc-text-secondary)" }}>📎 产物</div>
                      {req.resultEnvelope.artifacts?.map((a: any) => (
                        <div key={a.artifact_id} className="flex items-center gap-2 text-xs mb-1">
                          <span className="badge badge-muted">{a.mime_type || "file"}</span>
                          <a href={a.preview_uri || a.storage_uri} target="_blank" rel="noopener noreferrer"
                            className="underline" style={{ color: "var(--oc-accent)" }}>{a.name}</a>
                          {a.size && <span style={{ color: "var(--oc-text-secondary)" }}>({Math.round(a.size/1024)}KB)</span>}
                        </div>
                      ))}
                      {req.resultEnvelope.structured_outputs && Object.keys(req.resultEnvelope.structured_outputs).filter(k=>k!=="raw_text").length > 0 && (
                        <details className="text-xs mt-1">
                          <summary style={{ color: "var(--oc-text-secondary)", cursor: "pointer" }}>结构化结果字段</summary>
                          <pre className="mt-1 p-2 rounded text-xs overflow-auto" style={{ background: "rgba(0,0,0,0.2)", color: "var(--oc-text-secondary)", maxHeight: 120 }}>
                            {JSON.stringify(req.resultEnvelope.structured_outputs, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                  {/* 建议下一步 */}
                  {req.resultEnvelope.next_actions?.length > 0 && (
                    <div className="text-xs">
                      <span style={{ color: "var(--oc-text-secondary)" }}>建议下一步：</span>
                      {req.resultEnvelope.next_actions.map((a: string, i: number) => (
                        <span key={i} className="ml-1 badge badge-muted">→ {a}</span>
                      ))}
                    </div>
                  )}
                  {/* needs_input: 补充信息入口 */}
                  {req.resultEnvelope.status === "needs_input" && (
                    <div className="settings-card" style={{ borderColor: "var(--oc-info)" }}>
                      <div className="text-xs mb-1" style={{ color: "var(--oc-info)" }}>💬 对方需要补充信息才能继续执行</div>
                      <div className="flex gap-2">
                        <input type="text" placeholder="补充说明或参数…"
                          className="settings-input px-2 py-1 text-xs rounded flex-1" />
                        <button className="btn-primary-soft shrink-0" style={{ height: 28, fontSize: "var(--oc-text-sm)", padding: "0 12px" }}>发送</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!req.resultEnvelope && req.resultSummary && (
                <div className="mt-1.5 text-xs settings-card whitespace-pre-wrap" style={{ color: "var(--oc-text-secondary)", maxHeight: 160, overflowY: "auto" }}>
                  {req.resultSummary}
                </div>
              )}
              {req.status === "rejected" && <div className="text-xs mt-1 badge badge-danger">已被对方拒绝</div>}
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
