import { useEffect, useMemo, useState } from "react";
import { PageContainer } from "@/components/console/PageContainer";

type CronJob = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  schedule: { kind: "every" | "at" | "cron"; everyMs?: number; at?: string; expr?: string; tz?: string };
  payload: { kind: "agentTurn" | "systemEvent"; message?: string; text?: string; model?: string };
  sessionTarget: "main" | "isolated";
  delivery?: { mode: "announce" | "none"; channel?: string };
  state?: { lastRunAtMs?: number; nextRunAtMs?: number; lastStatus?: "ok" | "error" | "skipped" };
  agentId?: string;
};

type CronRun = {
  jobId: string;
  jobName?: string;
  status: "ok" | "error" | "skipped";
  ts: number;
  summary?: string;
  error?: string;
  durationMs?: number;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  sessionKey?: string;
};

type CronStatus = { enabled: boolean; jobs: number; nextWakeAtMs?: number; enabledJobs?: number };

type FormState = {
  name: string; description: string; enabled: boolean;
  scheduleKind: "every" | "at" | "cron";
  everyAmount: string; everyUnit: "minutes" | "hours" | "days";
  atValue: string; cronExpr: string; cronTz: string;
  payloadKind: "agentTurn" | "systemEvent";
  payloadText: string; payloadModel: string;
  sessionTarget: "main" | "isolated";
  deliveryMode: "announce" | "none";
};

const emptyForm: FormState = {
  name: "", description: "", enabled: true,
  scheduleKind: "every", everyAmount: "30", everyUnit: "minutes",
  atValue: "", cronExpr: "0 8 * * *", cronTz: "Asia/Shanghai",
  payloadKind: "agentTurn", payloadText: "", payloadModel: "",
  sessionTarget: "isolated", deliveryMode: "announce",
};

const fmt = (ms?: number) =>
  ms ? new Date(ms).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-";

const scheduleText = (j: CronJob) =>
  j.schedule.kind === "every"
    ? `每 ${Math.max(1, Math.round((j.schedule.everyMs || 0) / 60000))} 分钟`
    : j.schedule.kind === "at"
    ? `一次性 ${j.schedule.at || ""}`
    : `${j.schedule.expr || ""} (${j.schedule.tz || "UTC"})`;

const statusColor = (s?: string) =>
  s === "ok" ? "#22c55e" : s === "error" ? "#ef4444" : s === "skipped" ? "#f59e0b" : "var(--muted)";

const BtnGhost = ({ children, onClick, disabled, title }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; title?: string;
}) => (
  <button onClick={onClick} disabled={disabled} title={title} style={{
    height: 24, padding: "0 8px", borderRadius: 6, border: "1px solid var(--oc-border)",
    background: "transparent", color: "var(--oc-text-secondary)", fontSize: 11,
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1,
    whiteSpace: "nowrap", display: "inline-flex", alignItems: "center",
  }}>{children}</button>
);

const BtnDanger = ({ children, onClick, disabled }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
}) => (
  <button onClick={onClick} disabled={disabled} style={{
    height: 24, padding: "0 8px", borderRadius: 6, border: "1px solid #7f1d1d",
    background: "transparent", color: "#f87171", fontSize: 11,
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1,
    whiteSpace: "nowrap", display: "inline-flex", alignItems: "center",
  }}>{children}</button>
);

const BtnPrimary = ({ children, onClick, disabled }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
}) => (
  <button onClick={onClick} disabled={disabled} className="btn-primary-soft"
    style={{ height: 28, minWidth: 0, padding: "0 14px", fontSize: 12 }}>
    {children}
  </button>
);

const FieldRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
    <span style={{ fontSize: 11, color: "var(--muted)" }}>{label}</span>
    {children}
  </div>
);

export function SchedulePage({ adoptId }: { adoptId?: string }) {
  const [status, setStatus] = useState<CronStatus>({ enabled: true, jobs: 0 });
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [jobTotal, setJobTotal] = useState(0);
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [runTotal, setRunTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [enabledF, setEnabledF] = useState("all");
  const [scheduleKindF, setScheduleKindF] = useState("all");
  const [jobOffset, setJobOffset] = useState(0);
  const [runOffset, setRunOffset] = useState(0);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [editing, setEditing] = useState<CronJob | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // 展开的运行记录 key
  const [expandedRunKey, setExpandedRunKey] = useState<string | null>(null);

  const aid = adoptId || "";
  const jLimit = 20;
  const rLimit = 20;

  const inputStyle: React.CSSProperties = {
    height: 28, padding: "0 8px", borderRadius: 6, border: "1px solid var(--oc-border)",
    background: "rgba(255,255,255,0.04)", color: "var(--oc-text-primary)",
    fontSize: 12, width: "100%", boxSizing: "border-box",
  };
  const selectStyle: React.CSSProperties = {
    ...inputStyle, cursor: "pointer", background: "var(--oc-card)", colorScheme: "auto",
  };

  const load = async () => {
    if (!aid) return;
    setLoading(true);
    try {
      const [s, j, r] = await Promise.all([
        fetch(`/api/claw/cron/status?adoptId=${encodeURIComponent(aid)}`, { credentials: "include" }).then(v => v.json()),
        fetch(`/api/claw/cron/list?adoptId=${encodeURIComponent(aid)}&limit=${jLimit}&offset=${jobOffset}&query=${encodeURIComponent(query)}&enabled=${enabledF}&scheduleKind=${scheduleKindF}`, { credentials: "include" }).then(v => v.json()),
        fetch(`/api/claw/cron/runs?adoptId=${encodeURIComponent(aid)}&limit=${rLimit}&offset=${runOffset}&jobId=${encodeURIComponent(selectedJobId)}`, { credentials: "include" }).then(v => v.json()),
      ]);
      setStatus(s || { enabled: true, jobs: 0 });
      setJobs(Array.isArray(j?.jobs) ? j.jobs : []);
      setJobTotal(Number(j?.total || 0));
      setRuns(Array.isArray(r?.runs) ? r.runs : []);
      setRunTotal(Number(r?.total || 0));
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [aid, jobOffset, runOffset, query, enabledF, scheduleKindF, selectedJobId]);

  const toJob = (): Partial<CronJob> => {
    const everyMs = Number(form.everyAmount || 0) * (
      form.everyUnit === "minutes" ? 60000 : form.everyUnit === "hours" ? 3600000 : 86400000
    );
    return {
      name: form.name.trim(), description: form.description.trim() || undefined, enabled: form.enabled,
      schedule: form.scheduleKind === "every" ? { kind: "every", everyMs }
        : form.scheduleKind === "at" ? { kind: "at", at: form.atValue }
        : { kind: "cron", expr: form.cronExpr, tz: form.cronTz },
      payload: form.payloadKind === "agentTurn"
        ? { kind: "agentTurn", message: form.payloadText, model: form.payloadModel || undefined }
        : { kind: "systemEvent", text: form.payloadText },
      sessionTarget: form.sessionTarget,
      delivery: { mode: form.deliveryMode, to: form.deliveryMode === "announce" ? "conversation" : undefined },
    };
  };

  const submit = async () => {
    if (!aid || !form.name.trim() || busy) return;
    // 校验 schedule 必填字段
    if (form.scheduleKind === "every" && (!form.everyAmount || Number(form.everyAmount) <= 0)) {
      alert("请填写执行间隔"); return;
    }
    if (form.scheduleKind === "at" && !form.atValue.trim()) {
      alert("请填写执行时间"); return;
    }
    if (form.scheduleKind === "cron" && !form.cronExpr.trim()) {
      alert("请填写 cron 表达式"); return;
    }
    if (!form.payloadText.trim()) {
      alert("请填写消息内容"); return;
    }
    setBusy(true);
    try {
      let resp: Response;
      if (editing) {
        resp = await fetch(`/api/claw/cron/update`, {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adoptId: aid, id: editing.id, patch: toJob() }),
        });
      } else {
        resp = await fetch(`/api/claw/cron/add`, {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adoptId: aid, job: toJob() }),
        });
      }
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        alert(`保存失败: ${err.error || resp.statusText}`);
        return;
      }
      setEditing(null); setForm(emptyForm); load();
    } finally { setBusy(false); }
  };

  const startEdit = (j: CronJob) => {
    setEditing(j);
    setForm({
      name: j.name || "", description: j.description || "", enabled: j.enabled !== false,
      scheduleKind: j.schedule?.kind || "every",
      everyAmount: String(Math.max(1, Math.round((j.schedule?.everyMs || 1800000) / 60000))),
      everyUnit: "minutes", atValue: j.schedule?.at || "",
      cronExpr: j.schedule?.expr || "0 8 * * *", cronTz: j.schedule?.tz || "Asia/Shanghai",
      payloadKind: j.payload?.kind || "agentTurn",
      payloadText: j.payload?.message || j.payload?.text || "",
      payloadModel: j.payload?.model || "",
      sessionTarget: j.sessionTarget || "isolated", deliveryMode: j.delivery?.mode || "none",
    });
  };

  const onToggle = async (j: CronJob) => {
    await fetch(`/api/claw/cron/update`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adoptId: aid, id: j.id, patch: { enabled: !j.enabled } }),
    });
    load();
  };
  const onRun = async (j: CronJob) => {
    await fetch(`/api/claw/cron/run`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adoptId: aid, id: j.id }),
    });
    setTimeout(load, 2000);
  };
  const onDel = async (j: CronJob) => {
    if (!confirm(`确认删除任务"${j.name}"？`)) return;
    await fetch(`/api/claw/cron/remove`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adoptId: aid, id: j.id }),
    });
    load();
  };

  const summaryData = useMemo(() => ({
    enabledJobs: status.enabledJobs ?? jobs.filter(j => j.enabled).length,
    total: status.jobs || jobTotal,
  }), [status, jobs, jobTotal]);

  return (
    <PageContainer title="定时任务">
      <div className="flex items-center justify-end mb-3">
        <BtnGhost onClick={load} disabled={loading}>{loading ? "刷新中…" : "刷新"}</BtnGhost>
      </div>
      {!aid && (
        <div className="settings-card" style={{ fontSize: 12, color: "var(--muted)" }}>
          缺少 adoptId，无法加载。
        </div>
      )}

      {/* Summary Strip */}
      <div className="settings-card" style={{ display: "flex", gap: 24, flexWrap: "wrap", padding: "10px 14px" }}>
        {([
          ["已启用", summaryData.enabledJobs],
          ["总任务", summaryData.total],
          ["下次执行", fmt(status.nextWakeAtMs)],
          ["调度器", status.enabled ? "运行中" : "已停止"],
        ] as [string, string | number][]).map(([k, v]) => (
          <div key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{k}</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--oc-text-primary)" }}>{v}</span>
          </div>
        ))}
      </div>

      {/* Main Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 12, alignItems: "start" }}>

        {/* Left: Jobs + Runs */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Jobs List */}
          <div className="settings-card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid var(--oc-border)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                style={{ ...inputStyle, flex: 1, minWidth: 120 }}
                placeholder="搜索任务名…"
                value={query}
                onChange={e => { setJobOffset(0); setQuery(e.target.value); }}
              />
              <select style={{ ...selectStyle, width: 90 }} value={enabledF} onChange={e => { setJobOffset(0); setEnabledF(e.target.value); }}>
                <option value="all">全部状态</option>
                <option value="enabled">启用</option>
                <option value="disabled">停用</option>
              </select>
              <select style={{ ...selectStyle, width: 90 }} value={scheduleKindF} onChange={e => { setJobOffset(0); setScheduleKindF(e.target.value); }}>
                <option value="all">全部类型</option>
                <option value="every">every</option>
                <option value="at">at</option>
                <option value="cron">cron</option>
              </select>
            </div>

            {jobs.length === 0 && (
              <div style={{ padding: "20px 14px", fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
                {loading ? "加载中…" : "暂无任务，在右侧新建一个吧"}
              </div>
            )}

            {jobs.map(j => (
              <div key={j.id} style={{
                display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                padding: "8px 12px", borderBottom: "1px solid var(--oc-border)", gap: 8,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--oc-text-primary)", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                      background: j.enabled ? "#22c55e" : "var(--muted)", flexShrink: 0,
                    }} />
                    {j.name}
                    {j.state?.lastStatus && (
                      <span style={{ fontSize: 10, color: statusColor(j.state.lastStatus) }}>
                        · {j.state.lastStatus}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    {scheduleText(j)}
                    {j.state?.nextRunAtMs && (
                      <span style={{ marginLeft: 8 }}>下次: {fmt(j.state.nextRunAtMs)}</span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <BtnGhost onClick={() => startEdit(j)}>编辑</BtnGhost>
                  <BtnGhost onClick={() => onToggle(j)}>{j.enabled ? "停用" : "启用"}</BtnGhost>
                  <BtnGhost onClick={() => { setSelectedJobId(j.id); setRunOffset(0); }} title="查看该任务运行记录">历史</BtnGhost>
                  <BtnGhost onClick={() => onRun(j)}>立即执行</BtnGhost>
                  <BtnDanger onClick={() => onDel(j)}>删除</BtnDanger>
                </div>
              </div>
            ))}

            {jobTotal > jLimit && (
              <div style={{ display: "flex", gap: 6, padding: "8px 12px", justifyContent: "flex-end" }}>
                <BtnGhost disabled={jobOffset <= 0} onClick={() => setJobOffset(Math.max(0, jobOffset - jLimit))}>上一页</BtnGhost>
                <span style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center" }}>
                  {Math.floor(jobOffset / jLimit) + 1} / {Math.ceil(jobTotal / jLimit)}
                </span>
                <BtnGhost disabled={jobOffset + jLimit >= jobTotal} onClick={() => setJobOffset(jobOffset + jLimit)}>下一页</BtnGhost>
              </div>
            )}
          </div>

          {/* Runs */}
          <div className="settings-card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--oc-border)", display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--oc-text-primary)", flexShrink: 0 }}>运行记录</span>
              <select style={{ ...selectStyle, flex: 1 }} value={selectedJobId} onChange={e => { setRunOffset(0); setSelectedJobId(e.target.value); }}>
                <option value="">全部任务</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
              {selectedJobId && (
                <BtnGhost onClick={() => { setSelectedJobId(""); setRunOffset(0); }}>清除</BtnGhost>
              )}
            </div>

            {runs.length === 0 && (
              <div style={{ padding: "16px 14px", fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
                {loading ? "加载中…" : "暂无运行记录"}
              </div>
            )}

            {runs.map((r, i) => {
              const runKey = `${r.jobId}__${r.ts}__${i}`;
              const isExpanded = expandedRunKey === runKey;
              return (
                <div key={runKey} style={{ borderBottom: "1px solid var(--oc-border)" }}>
                  {/* 行头（可点击展开） */}
                  <div
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "7px 12px", gap: 8, cursor: "pointer",
                      background: isExpanded ? "rgba(255,255,255,0.02)" : "transparent",
                    }}
                    onClick={() => setExpandedRunKey(isExpanded ? null : runKey)}
                  >
                    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{
                        fontSize: 9, color: "var(--muted)",
                        display: "inline-block", transition: "transform .15s",
                        transform: isExpanded ? "rotate(90deg)" : "none",
                      }}>▶</span>
                      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--oc-text-primary)" }}>
                        {r.jobName || r.jobId}
                      </span>
                      {!isExpanded && r.summary && (
                        <span style={{
                          fontSize: 11, color: "var(--muted)", overflow: "hidden",
                          textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180,
                        }}>
                          {r.summary.split("\n")[0].slice(0, 60)}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: statusColor(r.status) }}>{r.status}</span>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>{fmt(r.ts)}</span>
                      {r.durationMs != null && (
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>{r.durationMs}ms</span>
                      )}
                    </div>
                  </div>

                  {/* 展开详情 */}
                  {isExpanded && (
                    <div style={{
                      margin: "0 12px 10px", padding: "10px 12px",
                      background: "rgba(255,255,255,0.025)", borderRadius: 6,
                      border: "1px solid var(--oc-border)",
                    }}>
                      {r.summary && (
                        <div style={{ marginBottom: r.error ? 10 : 0 }}>
                          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            执行结果
                          </div>
                          <div style={{
                            fontSize: 12, color: "var(--oc-text-primary)", lineHeight: 1.7,
                            whiteSpace: "pre-wrap", wordBreak: "break-word",
                          }}>
                            {r.summary}
                          </div>
                        </div>
                      )}
                      {r.error && (
                        <div style={{ marginTop: r.summary ? 10 : 0 }}>
                          <div style={{ fontSize: 10, color: "#f87171", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            错误信息
                          </div>
                          <div style={{ fontSize: 11, color: "#f87171", whiteSpace: "pre-wrap" }}>
                            {r.error}
                          </div>
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--oc-border)" }}>
                        {r.model && <span style={{ fontSize: 10, color: "var(--muted)" }}>模型: {r.model}</span>}
                        {r.usage?.total_tokens != null && (
                          <span style={{ fontSize: 10, color: "var(--muted)" }}>
                            tokens: {r.usage.input_tokens ?? "?"} in / {r.usage.output_tokens ?? "?"} out
                          </span>
                        )}
                        {r.durationMs != null && (
                          <span style={{ fontSize: 10, color: "var(--muted)" }}>耗时: {r.durationMs}ms</span>
                        )}
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>
                          {new Date(r.ts).toLocaleString("zh-CN")}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {runTotal > rLimit && (
              <div style={{ display: "flex", gap: 6, padding: "8px 12px", justifyContent: "flex-end" }}>
                <BtnGhost disabled={runOffset <= 0} onClick={() => setRunOffset(Math.max(0, runOffset - rLimit))}>上一页</BtnGhost>
                <span style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center" }}>
                  {Math.floor(runOffset / rLimit) + 1} / {Math.ceil(runTotal / rLimit)}
                </span>
                <BtnGhost disabled={runOffset + rLimit >= runTotal} onClick={() => setRunOffset(runOffset + rLimit)}>下一页</BtnGhost>
              </div>
            )}
          </div>
        </div>

        {/* Right: New/Edit Form */}
        <div className="settings-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--oc-text-primary)" }}>
            {editing ? `编辑：${editing.name}` : "新建任务"}
          </div>

          <FieldRow label="任务名称 *">
            <input style={inputStyle} placeholder="晨报 / 巡检 / ..."
              value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </FieldRow>

          <FieldRow label="描述（可选）">
            <input style={inputStyle} placeholder="任务用途说明"
              value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </FieldRow>

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--oc-text-secondary)", cursor: "pointer" }}>
            <input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />
            启用
          </label>

          <FieldRow label="执行计划">
            <select style={selectStyle} value={form.scheduleKind} onChange={e => setForm({ ...form, scheduleKind: e.target.value as any })}>
              <option value="every">间隔（every）</option>
              <option value="at">一次性（at）</option>
              <option value="cron">Cron 表达式</option>
            </select>
          </FieldRow>

          {form.scheduleKind === "every" && (
            <div style={{ display: "flex", gap: 6 }}>
              <input style={{ ...inputStyle, flex: 1 }} placeholder="30"
                value={form.everyAmount} onChange={e => setForm({ ...form, everyAmount: e.target.value })} />
              <select style={{ ...selectStyle, width: 70 }} value={form.everyUnit} onChange={e => setForm({ ...form, everyUnit: e.target.value as any })}>
                <option value="minutes">分钟</option>
                <option value="hours">小时</option>
                <option value="days">天</option>
              </select>
            </div>
          )}
          {form.scheduleKind === "at" && (
            <input style={inputStyle} placeholder="2026-04-01T08:00:00+08:00"
              value={form.atValue} onChange={e => setForm({ ...form, atValue: e.target.value })} />
          )}
          {form.scheduleKind === "cron" && (
            <>
              <input style={inputStyle} placeholder="0 8 * * *"
                value={form.cronExpr} onChange={e => setForm({ ...form, cronExpr: e.target.value })} />
              <input style={inputStyle} placeholder="Asia/Shanghai"
                value={form.cronTz} onChange={e => setForm({ ...form, cronTz: e.target.value })} />
            </>
          )}


          <FieldRow label="执行内容（Prompt）*">
            <textarea
              style={{ ...inputStyle, height: 72, resize: "vertical", padding: "6px 8px" }}
              placeholder={form.payloadKind === "agentTurn" ? "帮我汇总今日股市行情，简洁输出" : "每日早报提醒文字"}
              value={form.payloadText}
              onChange={e => setForm({ ...form, payloadText: e.target.value })}
            />
          </FieldRow>

          {form.payloadKind === "agentTurn" && (
            <FieldRow label="模型（可选，留空用默认）">
              <input style={inputStyle} placeholder="留空用 agent 默认"
                value={form.payloadModel} onChange={e => setForm({ ...form, payloadModel: e.target.value })} />
            </FieldRow>
          )}

          <FieldRow label="会话目标">
            <select style={selectStyle} value={form.sessionTarget} onChange={e => setForm({ ...form, sessionTarget: e.target.value as any })}>
              <option value="isolated">独立会话（推荐）</option>
            </select>
          </FieldRow>

          <FieldRow label="结果投递">
            <select style={selectStyle} value={form.deliveryMode} onChange={e => setForm({ ...form, deliveryMode: e.target.value as any })}>
              <option value="announce">发送到主聊天（推荐）</option>
              <option value="none">仅记录日志</option>
            </select>
          </FieldRow>

          <div style={{ display: "flex", gap: 6, paddingTop: 4 }}>
            <BtnPrimary onClick={submit} disabled={busy || !form.name.trim()}>
              {busy ? "提交中…" : editing ? "保存修改" : "新建任务"}
            </BtnPrimary>
            {editing && (
              <BtnGhost onClick={() => { setEditing(null); setForm(emptyForm); }}>取消</BtnGhost>
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
