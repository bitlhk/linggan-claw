import { useMemo, useState } from "react";

function chipStyle(kind: "ok" | "warn" | "neutral" | "danger") {
  if (kind === "ok") return { color: "#22c55e", borderColor: "rgba(34,197,94,.35)", background: "rgba(34,197,94,.1)" };
  if (kind === "warn") return { color: "#f59e0b", borderColor: "rgba(245,158,11,.35)", background: "rgba(245,158,11,.1)" };
  if (kind === "danger") return { color: "#ef4444", borderColor: "rgba(239,68,68,.35)", background: "rgba(239,68,68,.1)" };
  return { color: "var(--muted)", borderColor: "var(--oc-border)", background: "rgba(255,255,255,.04)" };
}

function reasonText(reason?: string) {
  switch (reason) {
    case "not_mounted": return "未挂载到当前 Agent";
    case "denied_by_policy": return "被策略禁止";
    case "missing_dependency": return "缺少依赖";
    case "not_synced": return "未同步到工作区";
    default: return reason || "";
  }
}

export function SkillsPanel({ sharedSkills, systemSkills, privateSkills }: { sharedSkills: any[]; systemSkills: any[]; privateSkills: any[] }) {
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ shared: false, system: false, private: false });

  const norm = (v: any) => String(v || "").toLowerCase();
  const q = filter.trim().toLowerCase();

  const pick = (arr: any[]) => arr.filter((s: any) => {
    if (!q) return true;
    return `${norm(s?.id)} ${norm(s?.label)} ${norm(s?.desc)} ${norm(s?.description)} ${norm(s?.scope)} ${norm(s?.reason)}`.includes(q);
  });

  const shared = useMemo(() => pick(sharedSkills || []), [sharedSkills, q]);
  const system = useMemo(() => pick(systemSkills || []), [systemSkills, q]);
  const priv = useMemo(() => pick(privateSkills || []), [privateSkills, q]);

  const all = [...(sharedSkills || []), ...(systemSkills || []), ...(privateSkills || [])];
  const visibleCount = all.filter((s:any) => s?.visible !== false).length;
  const runnableCount = all.filter((s:any) => s?.runnable !== false).length;

  const renderRow = (sk: any, source: "shared" | "system" | "private") => {
    const visible = sk?.visible !== false;
    const runnable = sk?.runnable !== false;
    const missingDeps = (sk?.missingDeps || []) as string[];
    const needsSetup = !!sk?.needsSetup;
    const reason = reasonText(sk?.reason);

    return (
      <div key={`${source}-${sk.id}`} className="flex items-start justify-between gap-2 rounded px-2 py-1" style={{ border: "1px solid var(--oc-border)", background: "rgba(255,255,255,0.02)" }}>
        <div className="min-w-0">
          <div className="text-xs" style={{ color: "var(--oc-text-primary)" }}>
            <span style={{ marginRight: 6 }}>{sk?.emoji || "🧩"}</span>
            {sk?.label || sk?.name || sk?.id}
            <span className="font-mono" style={{ color: "var(--muted)", marginLeft: 6 }}>({sk?.id})</span>
          </div>
          <div className="text-[11px] truncate" style={{ color: "var(--muted)" }}>{sk?.desc || sk?.description || "暂无描述"}</div>
          <div className="flex flex-wrap gap-1 mt-1">
            <span className="skills-chip" style={chipStyle(visible ? "ok" : "neutral")}>{visible ? "可见" : "不可见"}</span>
            <span className="skills-chip" style={chipStyle(runnable ? "ok" : "danger")}>{runnable ? "可执行" : "不可执行"}</span>
            <span className="skills-chip" style={chipStyle("neutral")}>{source === "shared" ? "共享" : source === "system" ? "系统" : "私有"}</span>
            {sk?.scope && <span className="skills-chip" style={chipStyle("neutral")}>scope:{sk.scope}</span>}
            {needsSetup && <span className="skills-chip" style={chipStyle("warn")}>需配置</span>}
            {missingDeps.length > 0 && <span className="skills-chip" style={chipStyle("warn")}>缺依赖: {missingDeps.join(",")}</span>}
            {!runnable && !!reason && <span className="skills-chip" style={chipStyle("danger")}>原因: {reason}</span>}
          </div>
        </div>
        <button className={`skills-switch ${runnable ? "is-on" : "is-off"}`} disabled title="Phase 1.1: 仅展示执行状态">
          <span className={`skills-switch-dot ${runnable ? "on" : ""}`} />
        </button>
      </div>
    );
  };

  const Group = ({ id, title, items, source }: { id: string; title: string; items: any[]; source: "shared"|"system"|"private" }) => (
    <div className="settings-card">
      <div className="flex items-center justify-between">
        <button className="skills-btn" onClick={() => setCollapsed((p) => ({ ...p, [id]: !p[id] }))}>{collapsed[id] ? "▶" : "▼"} {title} ({items.length})</button>
        <div className="text-[11px]" style={{ color: "var(--muted)" }}>{source === "private" ? "仅你可见" : "全体可见（按权限执行）"}</div>
      </div>
      {!collapsed[id] && (
        <div className="mt-2 space-y-1">
          {items.length === 0 && <div className="text-xs" style={{ color: "var(--muted)" }}>暂无</div>}
          {items.map((sk) => renderRow(sk, source))}
        </div>
      )}
    </div>
  );

  return (
    <div className="grid gap-3">
      <div className="settings-card">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>Skills</div>
          <div className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>visible {visibleCount}/{all.length} · runnable {runnableCount}/{all.length}</div>
        </div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <button className="skills-btn" disabled>Refresh</button>
          <button className="btn-primary-soft" disabled>Save</button>
          <button className="skills-btn" disabled>Enable All</button>
          <button className="skills-btn" disabled>Disable All</button>
          <button className="skills-btn" disabled>Reset</button>
        </div>
        <div className="mt-2">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="过滤 name / description / scope / reason" className="settings-input px-2 py-1 text-xs w-full" />
        </div>
      </div>

      <Group id="shared" title="共享技能" items={shared} source="shared" />
      <Group id="system" title="系统技能" items={system} source="system" />
      <Group id="private" title="私有技能" items={priv} source="private" />
    </div>
  );
}
