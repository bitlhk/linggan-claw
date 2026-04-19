import { useMemo, useState } from "react";
import type { EffectiveResp, ToolPolicy } from "./types";

function AccessToggle({ on }: { on: boolean }) {
  return (
    <div className={`skills-switch ${on ? "is-on" : "is-off"}`} style={{ opacity: 1, pointerEvents: "none" }}>
      <span className={`skills-switch-dot ${on ? "on" : ""}`} />
    </div>
  );
}

function reasonText(reason?: string) {
  switch (reason) {
    case "denied_by_policy": return "被策略禁止";
    case "sandbox_disabled": return "沙箱未开启";
    case "plugin_not_connected": return "插件未连接";
    case "channel_not_ready": return "通道未就绪";
    case "session_not_active": return "会话未激活";
    case "not_exposed_in_runtime": return "运行时未暴露";
    default: return reason || "";
  }
}

export function ToolsPanel({
  effective,
  policy,
  enabledTools,
  totalTools,
}: {
  effective: EffectiveResp | null;
  policy: ToolPolicy | null;
  enabledTools: number;
  totalTools: number;
}) {
  const [localFilter, setLocalFilter] = useState("");

  const groups = useMemo(() => {
    const q = localFilter.trim().toLowerCase();
    if (!q) return effective?.groups || [];
    return (effective?.groups || [])
      .map((g) => ({ ...g, tools: g.tools.filter((t) => `${t.label} ${t.id} ${t.description} ${t.unavailableReason || ""}`.toLowerCase().includes(q)) }))
      .filter((g) => g.tools.length > 0);
  }, [effective, localFilter]);

  const all = (effective?.groups || []).flatMap((g) => g.tools);
  const runnableCount = all.filter((t) => t.runtimeAvailable).length;
  const blockedCount = all.filter((t) => !t.runtimeAvailable).length;

  const profile = (policy as any)?.profile || (effective as any)?.profile || "-";
  const deny: string[] = (policy as any)?.deny || [];
  const allow: string[] = (policy as any)?.allow || [];
  const sandbox = (policy as any)?.sandbox || {};
  const fsWorkspaceOnly = (policy as any)?.fs?.workspaceOnly ?? false;
  const execSecurity = (policy as any)?.exec?.security || "-";
  const model = (policy as any)?.model || "-";

  // profile 标签颜色
  const profileColor =
    profile === "coding" ? "#22c55e" :
    profile === "messaging" ? "#60a5fa" :
    profile === "full" ? "#a78bfa" : "#9ca3af";

  return (
    <div className="grid gap-3">
      {/* 权限总览卡片 */}
      <div className="settings-card">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>OpenClaw 权限配置</div>
          <span className="px-2 py-0.5 rounded text-xs font-semibold font-mono" style={{
            color: profileColor,
            border: `1px solid ${profileColor}44`,
            background: `${profileColor}18`,
          }}>{profile}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs" style={{ color: "var(--oc-text-secondary)" }}>
          <div>来源: <span className="font-mono" style={{ color: "var(--oc-text-primary)" }}>{(policy as any)?.source || "openclaw_config"}</span></div>
          <div>模型: <span className="font-mono" style={{ color: "var(--oc-text-primary)" }}>{model}</span></div>
          <div>可执行: <span className="font-mono" style={{ color: "#22c55e" }}>{runnableCount}</span></div>
          <div>已禁止: <span className="font-mono" style={{ color: "#ef4444" }}>{blockedCount}</span></div>
        </div>
      </div>

      {/* 沙箱信息卡片 */}
      <div className="settings-card text-xs" style={{
        borderColor: sandbox.mode === "all" ? "rgba(99,102,241,.35)" : "rgba(255,255,255,.08)",
        background: sandbox.mode === "all" ? "rgba(99,102,241,.06)" : "rgba(255,255,255,.02)",
        color: sandbox.mode === "all" ? "#a5b4fc" : "var(--oc-text-secondary)",
      }}>
        <div className="font-semibold mb-1">
          {sandbox.mode === "all" ? "🧱 Docker 沙箱已启用" : "⚪ 沙箱未启用"}
        </div>
        {sandbox.mode === "all" && (
          <div className="space-y-0.5" style={{ color: "rgba(165,180,252,0.75)" }}>
            <div>镜像: <span className="font-mono">{sandbox.docker?.image || "-"}</span></div>
            <div>网络: <span className="font-mono">{sandbox.docker?.network || "-"}</span> · 只读根: <span className="font-mono">{String(sandbox.docker?.readOnlyRoot ?? true)}</span> · 隔离粒度: <span className="font-mono">{sandbox.scope || "agent"}</span></div>
            {fsWorkspaceOnly && <div>文件系统: <span className="font-mono">workspaceOnly</span> (禁止访问 workspace 外路径)</div>}
            <div>exec 安全: <span className="font-mono">{execSecurity}</span></div>
          </div>
        )}
      </div>

      {/* deny/allow 快览 */}
      {(deny.length > 0 || allow.length > 0) && (
        <div className="settings-card text-xs space-y-2">
          {deny.length > 0 && (
            <div>
              <span className="font-semibold" style={{ color: "#ef4444" }}>禁止工具</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {deny.map(d => (
                  <span key={d} className="font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", color: "#ef4444" }}>{d}</span>
                ))}
              </div>
            </div>
          )}
          {allow.length > 0 && (
            <div>
              <span className="font-semibold" style={{ color: "#22c55e" }}>白名单工具</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {allow.map(a => (
                  <span key={a} className="font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.3)", color: "#22c55e" }}>{a}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 搜索框 */}
      <div className="settings-card">
        <div className="text-xs mb-2" style={{ color: "var(--oc-text-secondary)" }}>筛选工具（只读视图，权限由 OpenClaw 配置决定）</div>
        <input value={localFilter} onChange={(e) => setLocalFilter(e.target.value)} placeholder="搜索工具 label/id/description" className="settings-input px-2 py-1 text-xs w-full" />
      </div>

      {/* 工具列表 */}
      <div className="grid gap-3">
        {groups.map((g) => (
          <div key={g.id} className="settings-card">
            <div className="text-sm mb-2" style={{ color: "var(--oc-text-primary)", fontWeight: 600 }}>
              {g.label}
              {g.id === "sandbox" && <span className="ml-2 text-xs font-normal" style={{ color: "#818cf8" }}>OpenClaw 提供</span>}
            </div>
            <div className="space-y-1">
              {g.tools.map((t) => {
                const runnable = !!t.runtimeAvailable;
                const reason = reasonText(t.unavailableReason);
                return (
                  <div key={t.id}>
                    <div className="flex items-start justify-between gap-2 rounded px-2 py-1.5" style={{ border: "1px solid var(--oc-border)", background: runnable ? "rgba(34,197,94,0.03)" : "rgba(239,68,68,0.03)" }}>
                      <div className="min-w-0">
                        <div className="text-xs flex items-center gap-1.5 flex-wrap">
                          <span style={{ color: "var(--oc-text-primary)" }}>{t.label}</span>
                          <span className="font-mono" style={{ color: "var(--muted)", fontSize: 10 }}>({t.id})</span>
                          {t.badge && t.badge !== "Built-in" && (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: "rgba(129,140,248,.15)", border: "1px solid rgba(129,140,248,.3)", color: "#818cf8" }}>{t.badge}</span>
                          )}
                        </div>
                        <div className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>{t.description}</div>
                        {!runnable && reason && (
                          <div className="text-[11px] mt-0.5" style={{ color: "#ef4444" }}>原因: {reason}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{
                          color: runnable ? "#22c55e" : "#ef4444",
                          border: `1px solid ${runnable ? "rgba(34,197,94,.35)" : "rgba(239,68,68,.35)"}`,
                          background: runnable ? "rgba(34,197,94,.10)" : "rgba(239,68,68,.10)",
                        }}>{runnable ? "ON" : "OFF"}</span>
                        <AccessToggle on={runnable} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
