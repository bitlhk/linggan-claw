import { useEffect, useMemo, useState } from "react";
import { Search, RefreshCw, Store, ChevronDown, ChevronRight, Settings2, Upload, Package, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageContainer } from "@/components/console/PageContainer";
import { toast } from "sonner";
import { MarketplacePage } from "./MarketplacePage";

export type SkillSource = "shared" | "private" | "system" | "installed" | "extra";
export type SkillItem = {
  id: string;
  name: string;
  description?: string;
  source: SkillSource;
  enabled: boolean;
  enabledForAgent: boolean;
  needsSetup?: boolean;
  missingDeps?: string[];
  apiKeyRequired?: boolean;
  configurable?: boolean;
  homepage?: string;
  category?: string;
  emoji?: string;
};

type StatusFilter = "all" | "ready" | "needsSetup" | "disabled" | "bound";

function getGroupLabel(source: SkillSource) {
  switch (source) {
    case "shared": return "平台技能";
    case "private": return "我的技能";
    case "system": return "平台技能";
    case "installed":
    case "extra": return "扩展技能";
    default: return "其他技能";
  }
}

function sourceBadge(source: SkillSource) {
  const map: Record<SkillSource, string> = { shared: "公共", private: "私有", system: "系统", installed: "扩展", extra: "扩展" };
  return map[source] || "其他";
}

function statusBadges(sk: SkillItem) {
  const out: { text: string; tone: "neutral" | "ok" | "warn" | "danger" }[] = [];
  if (sk.needsSetup) out.push({ text: "需配置", tone: "warn" });
  if (!sk.enabled) out.push({ text: "未安装", tone: "neutral" });
  if ((sk.missingDeps || []).length > 0) out.push({ text: "缺依赖", tone: "danger" });
  if (sk.enabledForAgent) out.push({ text: "已绑定", tone: "ok" });
  else out.push({ text: "未绑定", tone: "neutral" });
  return out;
}

function toneStyle(tone: "neutral" | "ok" | "warn" | "danger") {
  if (tone === "ok") return { color: "var(--oc-success)", borderColor: "rgba(34,197,94,0.35)", background: "rgba(34,197,94,0.1)" };
  if (tone === "warn") return { color: "var(--oc-warning)", borderColor: "rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.1)" };
  if (tone === "danger") return { color: "var(--oc-danger)", borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.1)" };
  return { color: "var(--oc-text-secondary)", borderColor: "var(--oc-border)", background: "var(--oc-bg-hover)" };
}

function SkillsHeader({ onRefresh, onUpload, onMarket }: { onRefresh?: () => void; onUpload?: () => void; onMarket?: () => void; }) {
  return (
    <div className="skills-header">

      <div className="flex items-center gap-2">
        <button className="skills-btn" onClick={onRefresh}><RefreshCw size={14} /> 刷新</button>
        <button className="btn-primary-soft" onClick={onUpload}><Upload size={13} style={{ marginRight: 6 }} /> 上传技能包</button>
      </div>
    </div>
  );
}

function SkillsToolbar({ q, setQ, status, setStatus }: { q: string; setQ: (v: string) => void; status: StatusFilter; setStatus: (v: StatusFilter) => void; }) {
  const tabs: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "ready", label: "可用" },
    { key: "needsSetup", label: "需配置" },
    { key: "disabled", label: "已禁用" },
    { key: "bound", label: "已绑定当前 Agent" },
  ];
  return (
    <div className="skills-toolbar">
      <div className="skills-search">
        <Search size={14} style={{ color: "var(--oc-text-secondary)" }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索技能名称/描述/来源" />
      </div>
      <div className="skills-tabs">
        {tabs.map(t => (
          <button key={t.key} className={`skills-tab ${status === t.key ? "active" : ""}`} onClick={() => setStatus(t.key)}>{t.label}</button>
        ))}
      </div>
    </div>
  );
}

function SkillDetailDrawer({ skill, adoptId, onClose, onToggle, onDeletePrivate, onInstallPrivate }: { skill: SkillItem | null; adoptId?: string; onClose: () => void; onToggle: (v: boolean) => void; onDeletePrivate?: (skill: any) => void; onInstallPrivate?: (skill: any) => void; }) {
  const [draftApiKey, setDraftApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [configError, setConfigError] = useState("");

  useEffect(() => {
    if (!skill || !adoptId) return;
    setLoadingConfig(true);
    setConfigError("");
    fetch(`/api/claw/skill-config?adoptId=${encodeURIComponent(adoptId)}&skillId=${encodeURIComponent(skill.id)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("load failed");
        return r.json();
      })
      .then((d) => setDraftApiKey(d?.config?.apiKey || ""))
      .catch(() => {
        setDraftApiKey("");
        setConfigError("配置读取失败，可继续手动填写后保存");
      })
      .finally(() => setLoadingConfig(false));
  }, [skill?.id, adoptId]);

  const onSave = async () => {
    if (!skill || !adoptId) return;
    setSaving(true);
    try {
      const r = await fetch("/api/claw/skill-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptId, skillId: skill.id, config: { apiKey: draftApiKey } }),
      });
      if (!r.ok) {
        let msg = "save failed";
        try { const j = await r.json(); msg = j?.error || msg; } catch {}
        throw new Error(msg);
      }
      toast.success("配置已保存");
    } catch (e: any) {
      toast.error(`配置保存失败${e?.message ? `: ${e.message}` : ""}`);
    } finally {
      setSaving(false);
    }
  };

  if (!skill) return null;
  return (
    <div className="skills-drawer-mask" onClick={onClose}>
      <div className="skills-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="skills-drawer-head">
          <div>
            <div className="text-sm" style={{ color: "var(--oc-text-primary)", fontWeight: "var(--oc-weight-semibold)" }}>{skill.name}</div>
            <div className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>{skill.id} · {getGroupLabel(skill.source)}</div>
          </div>
          <button className="skills-btn" onClick={onClose}>关闭</button>
        </div>

        <div className="skills-drawer-body">
          <div className="settings-card space-y-3">
            <div className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>{skill.description || "暂无描述"}</div>

            <div className="settings-row">
              <span className="settings-label">当前 Agent 启用</span>
              <button className={`skills-switch ${skill.enabledForAgent ? "is-on" : "is-off"}`} onClick={() => onToggle(!skill.enabledForAgent)}>
                <span className={`skills-switch-dot ${skill.enabledForAgent ? "on" : ""}`} />
              </button>
            </div>

            <div className="settings-row">
              <span className="settings-label">来源</span>
              <span className="skills-chip">{sourceBadge(skill.source)}</span>
            </div>


            <div className="settings-row">
              <span className="settings-label">分类</span>
              <span className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>{skill.category || "未分类"}</span>
            </div>

            <div className="settings-row">
              <span className="settings-label">本体状态</span>
              <span className="text-xs" style={{ color: skill.enabled ? "#22c55e" : "var(--muted)" }}>{skill.enabled ? "可用" : "未安装"}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">依赖状态</span>
              <span className="text-xs" style={{ color: (skill.missingDeps || []).length ? "#ef4444" : "#22c55e" }}>
                {(skill.missingDeps || []).length ? `缺失 ${(skill.missingDeps || []).join(", ")}` : "正常"}
              </span>
            </div>

            <div className="space-y-1">
              <div className="settings-label">API Key（可保存）</div>
              {loadingConfig && <div className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>读取配置中…</div>}
              {!!configError && <div className="text-xs" style={{ color: "var(--oc-warning)" }}>{configError}</div>}
              <input className="settings-input w-full px-3" placeholder="输入 API Key" value={draftApiKey} onChange={(e) => setDraftApiKey(e.target.value)} />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {skill.homepage && <a className="skills-btn" href={skill.homepage} target="_blank" rel="noreferrer">文档</a>}
              <button className="btn-primary-soft" onClick={onSave} disabled={saving || loadingConfig || !adoptId}>{saving ? "保存中…" : "保存配置"}</button>
              {skill.source === "private" && (skill as any).pkgFilename && <button className="skills-btn" onClick={() => onInstallPrivate?.(skill as any)}>安装</button>}
              {skill.source === "private" && (skill as any).pkgFilename && <button className="skills-btn" onClick={() => onDeletePrivate?.(skill as any)}>删除包</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkillRow({ skill, onToggle, onOpen }: { skill: SkillItem; onToggle: (v: boolean) => void; onOpen: () => void; }) {
  return (
    <div className="skills-row">
      <div className="skills-row-main" onClick={onOpen}>
        <div className="skills-icon">{skill.emoji || "🧩"}</div>
        <div className="min-w-0">
          <div className="skills-name">{skill.name}</div>
          <div className="skills-desc">{skill.description || "暂无描述"}</div>
          <div className="skills-badges">
            <span className="skills-chip">{sourceBadge(skill.source)}</span>
            {statusBadges(skill).map((b, i) => (
              <span key={i} className="skills-chip" style={toneStyle(b.tone)}>{b.text}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className={`skills-switch ${skill.enabledForAgent ? "is-on" : "is-off"}`} onClick={() => onToggle(!skill.enabledForAgent)}>
          <span className={`skills-switch-dot ${skill.enabledForAgent ? "on" : ""}`} />
        </button>
        <button className="skills-btn" onClick={onOpen}><Settings2 size={13} /> 详情</button>
      </div>
    </div>
  );
}

function SkillGroupSection({ title, skills, collapsed, setCollapsed, onBatch, onToggle, onOpen }:
{ title: string; skills: SkillItem[]; collapsed: boolean; setCollapsed: (v: boolean) => void; onBatch: (enabledForAgent: boolean) => void; onToggle: (id: string, enabledForAgent: boolean) => void; onOpen: (skill: SkillItem) => void; }) {
  return (
    <div className="settings-card">
      <div className="skills-group-head">
        <button className="skills-group-toggle" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span>{title}</span>
          <span className="skills-group-count">({skills.length})</span>
        </button>
        <div className="flex items-center gap-2">
          <button className="skills-btn" onClick={() => onBatch(true)}>全部启用</button>
          <button className="skills-btn" onClick={() => onBatch(false)}>全部禁用</button>
        </div>
      </div>
      {!collapsed && (
        <div className="mt-2 space-y-2">
          {skills.length === 0 && <div className="text-xs px-2 py-2" style={{ color: "var(--oc-text-secondary)" }}>暂无技能</div>}
          {skills.map((sk) => (
            <SkillRow key={sk.id} skill={sk} onToggle={(v) => onToggle(sk.id, v)} onOpen={() => onOpen(sk)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SkillMarketModal({ open, onClose, adoptId, myPackages }: {
  open: boolean;
  onClose: () => void;
  adoptId?: string;
  myPackages: any[];
}) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"browse" | "publish">("browse");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/trpc/claw.marketList')
      .then(r => r.json())
      .then(d => {
        const list = d?.result?.data?.json || d?.result?.data || [];
        // Map to existing format: { id, title, description, author, installCount }
        setItems(list.map((s: any) => ({
          id: s.id,
          skillId: s.skillId,
          title: s.name,
          description: s.description || "",
          author: s.author || "官方",
          installCount: s.downloadCount || 0,
          version: s.version || "1.0.0",
          category: s.category || "general",
          license: s.license || "MIT",
        })));
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]);

  const onInstall = async (item: any) => {
    if (!adoptId || installing) return;
    setInstalling(item.id);
    try {
      const r = await fetch('/api/trpc/claw.marketInstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { marketId: item.id, adoptId } }),
      });
      const d = await r.json();
      if (d?.error) throw new Error(d.error?.message || '安装失败');
      toast.success(`已安装：${item.title}`);
      setItems(prev => prev.map(x => x.id === item.id ? { ...x, installCount: (x.installCount || 0) + 1 } : x));
    } catch (e: any) {
      toast.error(`安装失败${e?.message ? `: ${e.message}` : ''}`);
    } finally {
      setInstalling(null);
    }
  };

  const onPublishItem = async (pkg: any) => {
    if (!adoptId || publishing) return;
    const filename = String(pkg?.filename || "").trim();
    if (!filename) { toast.error("缺少文件名"); return; }
    setPublishing(filename);
    try {
      const r = await fetch('/api/claw/skill-package/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adoptId,
          filename,
          title: pkg?.displayName || pkg?.manifest?.name || filename,
          description: pkg?.displayDescription || pkg?.manifest?.description || '',
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || '发布失败');
      toast.success('已发布到技能市场');
      // refresh market list
      fetch('/api/claw/shared-packages')
        .then(r => r.json())
        .then(d => setItems(Array.isArray(d?.items) ? d.items : []))
        .catch(() => {});
      setTab("browse");
    } catch (e: any) {
      toast.error(`发布失败${e?.message ? `: ${e.message}` : ''}`);
    } finally {
      setPublishing(null);
    }
  };

  const filteredMarket = q.trim()
    ? items.filter(x => `${x.title || ""} ${x.description || ""}`.toLowerCase().includes(q.toLowerCase()))
    : items;

  // 只展示已安装的技能包（有 installedSkillId 的）
  const publishable = (myPackages || []).filter((p: any) => !!p?.installedSkillId);
  const filteredPublish = q.trim()
    ? publishable.filter((x: any) => `${x.displayName || ""} ${x.displayDescription || ""} ${x.installedSkillId || ""}`.toLowerCase().includes(q.toLowerCase()))
    : publishable;

  if (!open) return null;

  return (
    <div className="skills-drawer-mask" onClick={onClose}>
      <div className="skills-drawer" style={{ maxWidth: 560, width: "90vw" }} onClick={e => e.stopPropagation()}>
        <div className="skills-drawer-head">
          <div>
            <div className="text-sm" style={{ color: "var(--oc-text-primary)", fontWeight: "var(--oc-weight-semibold)" }}>🏪 技能市场</div>
            <div className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>
              {tab === "browse" ? "浏览和安装社区技能" : "选择已验证的技能发布到市场"}
            </div>
          </div>
          <button className="skills-btn" onClick={onClose}>关闭</button>
        </div>

        {/* Tab 切换 */}
        <div style={{ display: "flex", gap: 8, padding: "12px 16px 0" }}>
          {([ ["browse", `浏览市场 (${items.length})`], ["publish", `发布技能 (${publishable.length})`] ] as const).map(([key, label]) => (
            <button
              key={key}
              className={`skills-tab ${tab === key ? "active" : ""}`}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 100, height: 34, padding: "0 18px", fontSize: "var(--oc-text-base)", fontWeight: "var(--oc-weight-medium)", letterSpacing: 0.2, lineHeight: 1, borderRadius: 999, cursor: "pointer", transition: "all .15s ease" }}
              onClick={() => setTab(key)}
            >{label}</button>
          ))}
        </div>

        <div style={{ padding: "12px 16px 8px" }}>
          <div className="skills-search">
            <Search size={14} style={{ color: "var(--oc-text-secondary)" }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={tab === "browse" ? "搜索市场技能..." : "搜索我的技能包..."} />
          </div>
        </div>

        <div className="skills-drawer-body" style={{ padding: "0 16px 16px", maxHeight: "60vh", overflowY: "auto" }}>
          {loading && <div className="text-xs" style={{ color: "var(--oc-text-secondary)", padding: 16, textAlign: "center" }}>加载中...</div>}

          {/* ── 浏览市场 Tab ── */}
          {tab === "browse" && !loading && (
            <>
              {filteredMarket.length === 0 && (
                <div className="settings-card" style={{ textAlign: "center", padding: 32 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🏪</div>
                  <div className="text-sm" style={{ color: "var(--oc-text-secondary)" }}>
                    {items.length === 0 ? "技能市场暂无技能" : "没有匹配的技能"}
                  </div>
                  {items.length === 0 && (
                    <button className="btn-primary-soft" style={{ marginTop: 12 }} onClick={() => setTab("publish")}>
                      发布第一个技能
                    </button>
                  )}
                </div>
              )}
              <div className="grid gap-2">
                {filteredMarket.map(item => (
                  <div key={item.id} className="settings-card" style={{ padding: "12px 14px" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm" style={{ color: "var(--oc-text-primary)", fontWeight: "var(--oc-weight-semibold)" }}>
                          {item.title || item.filename || "未命名技能"}
                        </div>
                        <div className="text-xs mt-1" style={{ color: "var(--oc-text-secondary)", lineHeight: 1.5 }}>
                          {item.description || "暂无描述"}
                        </div>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>
                            v{item.version || "1.0"} · {item.installCount || 0} 次安装
                          </span>
                        </div>
                      </div>
                      <button
                        className="btn-primary-soft"
                        style={{ flexShrink: 0, whiteSpace: "nowrap" }}
                        disabled={!!installing}
                        onClick={() => onInstall(item)}
                      >
                        {installing === item.id ? "安装中..." : "安装"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── 发布技能 Tab ── */}
          {tab === "publish" && !loading && (
            <>
              {publishable.length === 0 && (
                <div className="settings-card" style={{ textAlign: "center", padding: 32 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
                  <div className="text-sm" style={{ color: "var(--oc-text-secondary)" }}>
                    暂无已安装的技能包
                  </div>
                  <div className="text-xs mt-2" style={{ color: "var(--oc-text-secondary)" }}>
                    请先上传并安装技能包，确认可用后再发布到市场
                  </div>
                </div>
              )}
              {publishable.length > 0 && (
                <div className="text-xs mb-2" style={{ color: "var(--oc-text-secondary)", padding: "4px 0" }}>
                  💡 只有已安装且验证通过的技能包才能发布，确保其他用户安装后可正常使用
                </div>
              )}
              <div className="grid gap-2">
                {filteredPublish.map((pkg: any) => (
                  <div key={pkg.filename} className="settings-card" style={{ padding: "12px 14px" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm" style={{ color: "var(--oc-text-primary)", fontWeight: "var(--oc-weight-semibold)" }}>
                          📦 {pkg.displayName || pkg.installedSkillId || pkg.filename}
                        </div>
                        <div className="text-xs mt-1" style={{ color: "var(--oc-text-secondary)", lineHeight: 1.5 }}>
                          {pkg.displayDescription || "暂无描述"}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="skills-chip" style={{ color: "var(--oc-success)", borderColor: "rgba(34,197,94,0.35)", background: "rgba(34,197,94,0.1)" }}>已安装</span>
                          <span className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>{pkg.installedSkillId}</span>
                        </div>
                      </div>
                      <button
                        className="btn-primary-soft"
                        style={{ flexShrink: 0, whiteSpace: "nowrap" }}
                        disabled={!!publishing}
                        onClick={() => onPublishItem(pkg)}
                      >
                        {publishing === pkg.filename ? "发布中..." : "发布到市场"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


export function SkillsPage({ skills, canEdit, pending, onToggle, adoptId }:
{ skills: { shared: any[]; system: any[]; private: any[] } | null | undefined; canEdit: boolean; pending: boolean; onToggle: (skillId: string, enable: boolean, source: "shared" | "system") => void; adoptId?: string; }) {
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [detail, setDetail] = useState<SkillItem | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [bindingMap, setBindingMap] = useState<Record<string, boolean>>({});
  const [bindingLoading, setBindingLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sharedItems, setSharedItems] = useState<any[]>([]);
  const [myPackages, setMyPackages] = useState<any[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [showMarket, setShowMarket] = useState(false);
  const [skillTab, setSkillTab] = useState<"market"|"mine"|"upload">("mine");


  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);


  useEffect(() => {
    if (!adoptId) return;
    setBindingLoading(true);
    fetch(`/api/claw/skill-bindings?adoptId=${encodeURIComponent(adoptId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("load bindings failed");
        return r.json();
      })
      .then((d) => setBindingMap((d?.bindings || {}) as Record<string, boolean>))
      .catch(() => setBindingMap({}))
      .finally(() => setBindingLoading(false));
  }, [adoptId]);

  const pkgMetaBySkillId = useMemo(() => {
    const m = new Map<string, any>();
    for (const it of (myPackages || [])) {
      if (it?.installedSkillId) m.set(String(it.installedSkillId), it);
    }
    return m;
  }, [myPackages]);

  const normalized = useMemo<SkillItem[]>(() => {
    const list: SkillItem[] = [];

    // 先放公共/系统（来自后端真实技能）
    const push = (arr: any[] = [], source: SkillSource) => arr.forEach((s: any) => list.push({
      id: s.id,
      name: s.label || s.id,
      description: s.desc || "",
      source,
      enabled: true,
      enabledForAgent: !!s.active,
      needsSetup: false,
      missingDeps: [],
      apiKeyRequired: source !== "system",
      configurable: source === "private",
      homepage: "",
      category: "",
      emoji: s.emoji,
    }));
    push(skills?.shared || [], "shared");
    push(skills?.system || [], "system");

    // private: 以上传包为主视图（可读），并与已安装技能去重合并
    const byKey = new Map<string, any>();

    // 1) 先放上传包记录（即使未安装也展示）
    for (const it of (myPackages || [])) {
      const installedId = String(it?.installedSkillId || "").trim();
      const fallbackId = `pkg-${String(it?.sha256 || it?.filename || '').slice(0,12)}`;
      const id = installedId || fallbackId;
      byKey.set(id, {
        id,
        name: it?.displayName || it?.manifest?.name || it?.filename || "uploaded-skill",
        description: it?.displayDescription || it?.manifest?.description || "来自上传技能包",
        source: "private",
        enabled: !!installedId,
        enabledForAgent: !!installedId,
        needsSetup: false,
        missingDeps: [],
        apiKeyRequired: false,
        configurable: true,
        homepage: it?.manifest?.homepage || "",
        category: it?.manifest?.category || "",
        emoji: "📦",
        pkgFilename: it?.filename || "",
        pkgSha: it?.sha256 || "",
        installedSkillId: installedId || "",
      });
    }

    // 2) 再合并后端 private 已安装技能（不重复）
    for (const ps of (skills?.private || [])) {
      const sid = String(ps?.id || "");
      if (!sid) continue;
      const existed = byKey.get(sid);
      if (existed) {
        existed.enabled = true;
        existed.enabledForAgent = true;
        existed.installedSkillId = sid;
        byKey.set(sid, existed);
      } else {
        byKey.set(sid, {
          id: sid,
          name: ps?.label || sid,
          description: ps?.desc || "自定义技能",
          source: "private",
          enabled: true,
          enabledForAgent: true,
          needsSetup: false,
          missingDeps: [],
          apiKeyRequired: false,
          configurable: true,
          homepage: "",
          category: "",
          emoji: ps?.emoji || "⚡",
          pkgFilename: "",
          pkgSha: "",
          installedSkillId: sid,
        });
      }
    }

    for (const v of byKey.values()) list.push(v as SkillItem);

    // shared registry 补充展示
    (sharedItems || []).forEach((it:any)=> list.push({
      id: it.id || `shared-${Math.random().toString(36).slice(2,8)}`,
      name: it.title || it.filename || it.id,
      description: it.description || "",
      source: "shared",
      enabled: true,
      enabledForAgent: !!bindingMap[it.id || ""],
      needsSetup: false,
      missingDeps: [],
      apiKeyRequired: false,
      configurable: false,
      homepage: it.homepage || "",
      category: it?.manifest?.category || "",
      emoji: "📦",
    }));

    return list;
  }, [skills, bindingMap, sharedItems, myPackages]);

  const filtered = useMemo(() => normalized.filter((s) => {
    const hit = `${s.name} ${s.description || ""} ${s.source}`.toLowerCase().includes(qDebounced.toLowerCase());
    if (!hit) return false;
    if (status === "ready") return !s.needsSetup && (s.missingDeps || []).length === 0;
    if (status === "needsSetup") return !!s.needsSetup || (s.missingDeps || []).length > 0;
    if (status === "disabled") return !s.enabledForAgent;
    if (status === "bound") return !!s.enabledForAgent;
    return true;
  }), [normalized, qDebounced, status]);

  const groups = useMemo(() => {
    const order = ["我的技能", "平台技能"];
    const m = new Map<string, SkillItem[]>();
    for (const k of order) m.set(k, []);
    for (const s of filtered) {
      let k = getGroupLabel(s.source);
      if (k === "扩展技能" || k === "其他技能") k = "平台技能";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return order.map((k) => [k, m.get(k) || []] as [string, SkillItem[]]);
  }, [filtered]);



  const onPublishShared = async () => {
    if (!adoptId) { toast.error("缺少 adoptId"); return; }
    const latest = [...myPackages].sort((a,b)=> String(b?.createdAt||"").localeCompare(String(a?.createdAt||"")))[0];
    if (!latest) { toast.error("暂无可发布的个人技能包，请先上传"); return; }
    try {
      setPublishing(true);
      const r = await fetch('/api/claw/skill-package/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adoptId, filename: latest.filename, title: latest?.manifest?.name || latest.filename, description: latest?.manifest?.description || '' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || '发布失败');
      toast.success('已发布为共享技能');
      setSharedItems((prev)=> [d.item, ...prev.filter((x:any)=>x.id!==d.item?.id)]);
    } catch (e:any) {
      toast.error(`发布失败${e?.message ? `: ${e.message}` : ''}`);
    } finally {
      setPublishing(false);
    }
  };

  const onUploadPackage = async () => {
    if (!adoptId) { toast.error("缺少 adoptId，无法上传"); return; }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (!f.name.toLowerCase().endsWith(".zip")) {
        toast.error("仅支持 .zip 技能包");
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast.error("文件过大，最大 10MB");
        return;
      }
      try {
        setUploading(true);
        const contentBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("文件读取失败"));
          reader.onload = () => {
            const v = String(reader.result || "");
            const idx = v.indexOf(",");
            if (idx < 0) return reject(new Error("文件编码失败"));
            resolve(v.slice(idx + 1));
          };
          reader.readAsDataURL(f);
        });
        const r = await fetch('/api/claw/skill-package/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adoptId, filename: f.name, contentBase64 }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error([d?.error, ...(Array.isArray(d?.details)?d.details:[])].filter(Boolean).join("; ") || "上传失败");
        toast.success("技能包上传成功（已进入安全扫描）");

        toast.success("上传完成，可在技能详情中手动安装");
        fetch(`/api/claw/skill-package/mine?adoptId=${encodeURIComponent(adoptId)}`)
          .then(r => r.json())
          .then(d => setMyPackages(Array.isArray(d?.items) ? d.items : []))
          .catch(() => {});
      } catch (e: any) {
        toast.error(`上传失败${e?.message ? `: ${e.message}` : ""}`);
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };


  useEffect(() => {
    fetch('/api/claw/shared-packages')
      .then(r => r.json())
      .then(d => setSharedItems(Array.isArray(d?.items) ? d.items : []))
      .catch(() => setSharedItems([]));
  }, []);

  useEffect(() => {
    if (!adoptId) return;
    fetch(`/api/claw/skill-package/mine?adoptId=${encodeURIComponent(adoptId)}`)
      .then(r => r.json())
      .then(d => setMyPackages(Array.isArray(d?.items) ? d.items : []))
      .catch(() => setMyPackages([]));
  }, [adoptId]);


  const onInstallPrivatePackage = async (sk: any) => {
    if (!adoptId) return;
    const filename = String(sk?.pkgFilename || "").trim();
    if (!filename) { toast.error("该技能不是上传包来源"); return; }
    try {
      const r = await fetch('/api/claw/skill-package/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adoptId, filename }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || '安装失败');
      toast.success(`已安装：${d?.skillId || ''}`);
      fetch(`/api/claw/skill-package/mine?adoptId=${encodeURIComponent(adoptId)}`)
        .then(r => r.json())
        .then(d => setMyPackages(Array.isArray(d?.items) ? d.items : []))
        .catch(() => {});
      setDetail(null);
    } catch (e:any) {
      toast.error(`安装失败${e?.message ? `: ${e.message}` : ''}`);
    }
  };

  const onDeletePrivatePackage = async (sk: any) => {
    if (!adoptId) return;
    const filename = String(sk?.pkgFilename || "").trim();
    if (!filename) { toast.error("该技能不是上传包来源"); return; }
    if (!confirm(`确认删除技能包 ${filename} ?`)) return;
    try {
      const r = await fetch('/api/claw/skill-package/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adoptId, filename }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || '删除失败');
      toast.success('已删除技能包');
      setDetail(null);
      fetch(`/api/claw/skill-package/mine?adoptId=${encodeURIComponent(adoptId)}`)
        .then(r => r.json())
        .then(d => setMyPackages(Array.isArray(d?.items) ? d.items : []))
        .catch(() => {});
    } catch (e:any) {
      toast.error(`删除失败${e?.message ? `: ${e.message}` : ''}`);
    }
  };

  const onToggleAgent = async (sk: SkillItem, v: boolean) => {
    if (!canEdit || pending) return;

    // system/shared: 走原有 mutation
    if (sk.source === "shared" || sk.source === "system") {
      onToggle(sk.id, v, sk.source as any);
      return;
    }

    // private: 开启时优先安装到当前子虾 workspace
    if (!adoptId) return;
    const anySk: any = sk as any;
    if (v) {
      // 已安装就直接提示
      if (anySk?.installedSkillId || sk.enabled) {
        toast.success("已绑定到当前 Agent");
        return;
      }
      const filename = String(anySk?.pkgFilename || "").trim();
      if (!filename) {
        toast.error("该技能缺少包来源，无法安装");
        return;
      }
      try {
        const r = await fetch('/api/claw/skill-package/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adoptId, filename }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || '安装失败');
        toast.success(`已安装并绑定：${d?.skillId || ''}`);
        // 刷新包列表，映射到 private 已安装态
        fetch(`/api/claw/skill-package/mine?adoptId=${encodeURIComponent(adoptId)}`)
          .then(r => r.json())
          .then(d => setMyPackages(Array.isArray(d?.items) ? d.items : []))
          .catch(() => {});
      } catch (e:any) {
        toast.error(`安装失败${e?.message ? `: ${e.message}` : ''}`);
      }
      return;
    }

    // private 关闭：先不做强制卸载，给出提示（避免误删）
    toast.info("私有技能请先在详情中删除包（或后续支持解绑定）");
  };

  return (
    <PageContainer title="技能">
      {/* ── Sub-tab 栏 ── */}
      <div className="console-tabs">
        <button className={`console-tab ${skillTab === "market" ? "active" : ""}`} onClick={() => setSkillTab("market")}><Store size={12} /> 技能市场</button>
        <button className={`console-tab ${skillTab === "mine" ? "active" : ""}`} onClick={() => setSkillTab("mine")}><Package size={12} /> 我的技能</button>
      </div>

      {/* ── 技能市场 Tab ── */}
      {skillTab === "market" && (
        <MarketplacePage adoptId={adoptId} />
      )}

      {/* ── 我的技能 Tab ── */}
      {skillTab === "mine" && (
        <>
          <SkillsHeader onUpload={onUploadPackage} onMarket={() => setSkillTab("market")} onRefresh={() => {
            setDetail(null); setQ(""); setStatus("all"); setCollapsed({});
            fetch(`/api/claw/skill-package/mine?adoptId=${encodeURIComponent(adoptId || "")}`)
              .then(r => r.json()).then(d => setMyPackages(Array.isArray(d?.items) ? d.items : [])).catch(() => setMyPackages([]));
          }} />
          <SkillsToolbar q={q} setQ={setQ} status={status} setStatus={setStatus} />
          <div className="skills-summary text-xs" style={{ color: "var(--oc-text-secondary)", marginTop: 10 }}>共 {filtered.length} 个匹配技能 {pending || bindingLoading || uploading || publishing ? "· 正在更新…" : ""}</div>
          <div className="grid gap-3 mt-3">
            {groups.map(([g, arr]) => (
              <SkillGroupSection key={g} title={g} skills={arr} collapsed={!!collapsed[g]} setCollapsed={(v) => setCollapsed((p) => ({ ...p, [g]: v }))} onBatch={(v) => { if (pending) return; arr.forEach((sk) => onToggleAgent(sk, v)); }} onToggle={(id, v) => { const sk = arr.find((x) => x.id === id); if (sk) onToggleAgent(sk, v); }} onOpen={setDetail} />
            ))}
            {filtered.length === 0 && <div className="settings-card text-sm" style={{ color: "var(--oc-text-secondary)" }}>暂无匹配技能</div>}
          </div>
          <SkillDetailDrawer skill={detail} adoptId={adoptId} onClose={() => setDetail(null)} onToggle={(v) => detail && onToggleAgent(detail, v)} onDeletePrivate={onDeletePrivatePackage} onInstallPrivate={onInstallPrivatePackage} />
        </>
      )}
    </PageContainer>
  );
}
