import React, { useEffect, useState, useRef } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { applySettings, getSettings, subscribeSettings } from "@/lib/settings";
import type { UiSettings } from "@/types/settings";

type Section = "appearance" | "chat" | "layout" | "notify";

const SECTIONS: { key: Section; label: string; emoji: string }[] = [
  { key: "appearance", label: "外观", emoji: "🎨" },
  { key: "chat", label: "聊天", emoji: "💬" },
  { key: "layout", label: "布局", emoji: "📐" },
  { key: "notify" as const, label: "通知", emoji: "🔔" },
];

const THEMES = [
  { key: "claw" as const, label: "Claw", color: "#ff5c5c", desc: "珊瑚红 · 默认" },
  { key: "knot" as const, label: "Knot", color: "#e5243b", desc: "深红 · 高对比" },
  { key: "dash" as const, label: "Dash", color: "#b47840", desc: "棕金 · 仪表盘" },
];

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 36,
        height: 20,
        borderRadius: 9999,
        border: "none",
        cursor: "pointer",
        position: "relative",
        background: on ? "var(--accent)" : "var(--border)",
        transition: "background .2s",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#fff",
          transition: "left .2s",
          left: on ? 18 : 2,
          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
        }}
      />
    </button>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span style={{ fontSize: "var(--oc-text-base)", color: "var(--oc-text-primary)", fontWeight: "var(--oc-weight-medium)" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center" }}>{children}</div>
    </div>
  );
}

function SectionTitle({ emoji, label, desc }: { emoji: string; label: string; desc?: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ fontSize: "var(--oc-text-md)", fontWeight: "var(--oc-weight-semibold)", color: "var(--oc-text-primary)", margin: 0 }}>
        {emoji} {label}
      </h3>
      {desc && <p style={{ fontSize: "var(--oc-text-sm)", color: "var(--oc-text-secondary)", margin: "4px 0 0" }}>{desc}</p>}
    </div>
  );
}

export function SettingsPage({
  memoryEnabled,
  setMemoryEnabled,
  contextTurns,
  setContextTurns,
  canSave,
  saving,
  onSave,
  adoptId,
}: {
  memoryEnabled: "yes" | "no";
  setMemoryEnabled: (v: "yes" | "no") => void;
  contextTurns: number;
  setContextTurns: (v: number) => void;
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  adoptId?: string;
}) {
  const [uiSettings, setUiSettings] = useState<UiSettings>(getSettings());
  const [activeSection, setActiveSection] = useState<Section>("appearance");

  useEffect(() => subscribeSettings((s) => setUiSettings({ ...s })), []);

  return (
    <main style={{ flex: 1, minWidth: 0, display: "flex", overflow: "hidden", height: "100%" }}>
      {/* 左侧 tab 菜单 */}
      <nav
        style={{
          width: 160,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--oc-bg-elevated)",
          padding: "16px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <div
          style={{
            fontSize: "var(--oc-text-xs)",
            fontWeight: "var(--oc-weight-semibold)",
            color: "var(--faint)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            padding: "0 8px 10px",
          }}
        >
          设置
        </div>
        {SECTIONS.map((s) => {
          const active = activeSection === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setActiveSection(s.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: "var(--radius-md, 10px)",
                border: "none",
                cursor: "pointer",
                fontSize: "var(--oc-text-base)",
                fontWeight: active ? 600 : 400,
                background: active ? "var(--accent-subtle)" : "transparent",
                color: active ? "var(--accent)" : "var(--muted)",
                transition: "background .15s, color .15s",
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: "var(--oc-text-md)" }}>{s.emoji}</span>
              {s.label}
            </button>
          );
        })}
      </nav>

      {/* 右侧内容区 */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          overflowY: "auto",
          padding: "24px 32px",
          background: "var(--bg)",
        }}
      >
        {activeSection === "appearance" && (
          <div style={{ maxWidth: 560 }}>
            <SectionTitle emoji="🎨" label="外观" desc="主题、配色和界面圆角" />

            {/* 主题色 */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: "var(--oc-text-sm)", fontWeight: "var(--oc-weight-medium)", color: "var(--oc-text-secondary)", marginBottom: 12 }}>主题</div>
              <div style={{ display: "flex", gap: 12 }}>
                {THEMES.map((t) => {
                  const active = uiSettings.theme === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => applySettings({ theme: t.key })}
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        padding: "14px 16px",
                        borderRadius: "var(--radius-lg, 12px)",
                        border: active ? `1.5px solid ${t.color}` : "1.5px solid var(--oc-border)",
                        background: active ? `color-mix(in srgb, ${t.color} 8%, var(--oc-bg-surface))` : "var(--oc-bg-surface)",
                        cursor: "pointer",
                        transition: "border-color .15s, background .15s",
                        gap: 10,
                      }}
                    >
                      {/* 色块预览：accent 圆点 + 两个固定灰色方块模拟背景层次 */}
                      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                        <span style={{ width: 18, height: 18, borderRadius: "50%", background: t.color, display: "block", flexShrink: 0, boxShadow: `0 0 6px ${t.color}55` }} />
                        <span style={{ width: 10, height: 18, borderRadius: 4, background: "var(--oc-bg-active)", display: "block" }} />
                        <span style={{ width: 10, height: 18, borderRadius: 4, background: "var(--oc-border)", display: "block" }} />
                      </div>
                      <div>
                        <div style={{ fontSize: "var(--oc-text-base)", fontWeight: "var(--oc-weight-semibold)", color: active ? t.color : "var(--oc-text-primary)" }}>{t.label}</div>
                        <div style={{ fontSize: "var(--oc-text-xs)", color: "var(--oc-text-secondary)", marginTop: 2 }}>{t.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 模式 */}
            <SettingRow label="色彩模式">
              <div
                style={{
                  display: "flex",
                  gap: 2,
                  background: "var(--oc-bg-elevated)",
                  border: "1px solid var(--oc-border)",
                  borderRadius: "var(--radius-md, 10px)",
                  padding: 3,
                }}
              >
                {([
                  { key: "system" as const, label: "跟随系统" },
                  { key: "light" as const, label: "☀️ 浅色" },
                  { key: "dark" as const, label: "🌙 深色" },
                ] as const).map((m) => (
                  <button
                    key={m.key}
                    onClick={() => applySettings({ themeMode: m.key })}
                    style={{
                      padding: "4px 12px",
                      borderRadius: "calc(var(--radius-md, 10px) - 2px)",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "var(--oc-text-sm)",
                      fontWeight: "var(--oc-weight-medium)",
                      background: uiSettings.themeMode === m.key ? "var(--accent)" : "transparent",
                      color: uiSettings.themeMode === m.key ? "var(--oc-text-on-accent)" : "var(--oc-text-secondary)",
                      transition: "background .15s, color .15s",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </SettingRow>

            {/* 圆角 */}
            <SettingRow label={`圆角 — ${uiSettings.borderRadius}`}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={25}
                  value={uiSettings.borderRadius}
                  onChange={(e) => applySettings({ borderRadius: Number(e.target.value) })}
                  style={{ width: 140, accentColor: "var(--oc-accent)" }}
                />
                {/* 圆角预览方块 */}
                <div
                  style={{
                    width: 24,
                    height: 24,
                    background: "var(--accent-subtle)",
                    border: `1.5px solid var(--accent)`,
                    borderRadius: `${Math.round((12 * uiSettings.borderRadius) / 50)}px`,
                    transition: "border-radius .15s",
                  }}
                />
              </div>
            </SettingRow>
          </div>
        )}

        {activeSection === "chat" && (
          <div style={{ maxWidth: 560 }}>
            <SectionTitle emoji="💬" label="聊天" desc="对话行为与显示偏好" />

            <SettingRow label="长期记忆">
              <Select value={memoryEnabled} onValueChange={(v) => setMemoryEnabled(v as "yes" | "no")}>
                <SelectTrigger className="w-24 h-8 text-xs settings-select focus:ring-0 focus:ring-offset-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ minWidth: 96, background: "var(--oc-bg-elevated)", border: "1px solid var(--oc-border)" }}>
                  <SelectItem value="yes" className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>
                    开启
                  </SelectItem>
                  <SelectItem value="no" className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>
                    关闭
                  </SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>

            <SettingRow label="上下文轮次">
              <input
                type="number"
                min={5}
                max={100}
                value={contextTurns}
                onChange={(e) => setContextTurns(Number(e.target.value || 20))}
                style={{
                  width: 72,
                  textAlign: "center",
                  background: "var(--input)",
                  border: "1px solid var(--oc-border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--oc-text-primary)",
                  fontSize: "var(--oc-text-base)",
                  padding: "4px 8px",
                }}
              />
            </SettingRow>

            <SettingRow label="显示思考过程">
              <Toggle
                on={uiSettings.chatShowThinking}
                onClick={() => applySettings({ chatShowThinking: !uiSettings.chatShowThinking })}
              />
            </SettingRow>

            <SettingRow label="显示工具调用">
              <Toggle
                on={uiSettings.chatShowToolCalls}
                onClick={() => applySettings({ chatShowToolCalls: !uiSettings.chatShowToolCalls })}
              />
            </SettingRow>

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--oc-border)" }}>
              {!canSave ? (
                <p style={{ fontSize: "var(--oc-text-sm)", color: "var(--oc-warning)" }}>登录后可保存设置</p>
              ) : (
                <button
                  onClick={onSave}
                  disabled={saving}
                  style={{
                    padding: "7px 20px",
                    background: "var(--accent)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    fontSize: "var(--oc-text-base)",
                    fontWeight: "var(--oc-weight-medium)",
                    opacity: saving ? 0.5 : 1,
                    transition: "opacity .15s",
                  }}
                >
                  {saving ? "保存中…" : "保存"}
                </button>
              )}
            </div>
          </div>
        )}

        {activeSection === "layout" && (
          <div style={{ maxWidth: 560 }}>
            <SectionTitle emoji="📐" label="布局" desc="侧边栏和面板尺寸" />

            <SettingRow label={`导航宽度 — ${uiSettings.navWidth}px`}>
              <input
                type="range"
                min={160}
                max={320}
                step={10}
                value={uiSettings.navWidth}
                onChange={(e) => applySettings({ navWidth: Number(e.target.value) })}
                style={{ width: 140, accentColor: "var(--oc-accent)" }}
              />
            </SettingRow>
          </div>
        )}
        {activeSection === "notify" && (<div className="space-y-6"><SectionTitle emoji="🔔" label="通知渠道" desc="配置定时任务、协作等事件的推送通道" /><NotifySettings adoptId={adoptId} /></div>)}
      </div>
    </main>
  );
}

function NotifySettings({ adoptId }: { adoptId?: string }) {
  const [type, setType] = useState("none");
  const [corpId, setCorpId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [secret, setSecret] = useState("");
  const [userId, setUserId] = useState("@all");
  const [webhook, setWebhook] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!adoptId) return;
    fetch(`/api/claw/notify/config?adoptId=${encodeURIComponent(adoptId)}`, { credentials: "include" })
      .then(r => r.json()).then(d => { const c = d.config || {}; setType(c.type||"none"); setCorpId(c.corpId||""); setAgentId(c.agentId||""); setSecret(c.secret||""); setUserId(c.userId||"@all"); setWebhook(c.webhook||""); }).catch(() => {});
  }, [adoptId]);

  const onSave = async () => { if (!adoptId) return; setSaving(true); try { await fetch("/api/claw/notify/config", { method:"POST", credentials:"include", headers:{"Content-Type":"application/json"}, body:JSON.stringify({adoptId,type,corpId,agentId,secret,userId,webhook})}); toast.success("通知配置已保存"); } catch { toast.error("保存失败"); } finally { setSaving(false); } };
  const onTest = async () => { if (!adoptId) return; setTesting(true); try { const r = await fetch("/api/claw/notify/test", { method:"POST", credentials:"include", headers:{"Content-Type":"application/json"}, body:JSON.stringify({adoptId})}); const d = await r.json(); if (d.ok) toast.success("测试消息已发送！"); else toast.error(d.error||"发送失败"); } catch { toast.error("发送失败"); } finally { setTesting(false); } };

  const S: React.CSSProperties = { height:32, borderRadius:8, border:"1px solid var(--oc-border)", background:"var(--oc-input-bg)", color:"var(--oc-text-primary)", padding:"0 10px", fontSize:12, width:"100%" };
  const L: React.CSSProperties = { fontSize:12, color:"var(--oc-text-secondary)", marginBottom:4, display:"block" };

  return (<div className="space-y-4">
    <div className="settings-card" style={{padding:16}}><div style={L}>通知渠道</div>
      <select value={type} onChange={e=>setType(e.target.value)} style={{...S,cursor:"pointer"}}><option value="none">关闭通知</option><option value="weixin">个人微信</option>
              <option value="wechat_work">企业微信</option><option value="feishu">飞书</option><option value="webhook">自定义 Webhook</option></select></div>
    {type==="weixin"&&<WeixinBind adoptId={adoptId}/>}
    {type==="wechat_work"&&<div className="settings-card" style={{padding:16}}><div className="text-xs font-medium mb-3" style={{color:"var(--oc-text-primary)"}}>企业微信配置</div><div className="space-y-3">
      <div><div style={L}>企业ID (CorpID)</div><input value={corpId} onChange={e=>setCorpId(e.target.value)} style={S} placeholder="wwc7cc..."/></div>
      <div><div style={L}>应用ID (AgentID)</div><input value={agentId} onChange={e=>setAgentId(e.target.value)} style={S} placeholder="1000002"/></div>
      <div><div style={L}>应用Secret</div><input type="password" value={secret} onChange={e=>setSecret(e.target.value)} style={S}/></div>
      <div><div style={L}>接收人 (企微userid, @all=所有人)</div><input value={userId} onChange={e=>setUserId(e.target.value)} style={S} placeholder="@all"/></div></div></div>}
    {type==="feishu"&&<div className="settings-card" style={{padding:16}}><div className="text-xs font-medium mb-3" style={{color:"var(--oc-text-primary)"}}>飞书配置</div><div><div style={L}>Webhook URL</div><input value={webhook} onChange={e=>setWebhook(e.target.value)} style={S} placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxx"/></div></div>}
    {type==="webhook"&&<div className="settings-card" style={{padding:16}}><div className="text-xs font-medium mb-3" style={{color:"var(--oc-text-primary)"}}>自定义 Webhook</div><div><div style={L}>Webhook URL</div><input value={webhook} onChange={e=>setWebhook(e.target.value)} style={S} placeholder="https://your-server.com/webhook"/></div></div>}
    {type!=="none"&&<div style={{display:"flex",gap:8}}><button className="btn-primary-soft" onClick={onSave} disabled={saving} style={{flex:1}}>{saving?"保存中...":"保存配置"}</button><button className="skills-btn" onClick={onTest} disabled={testing} style={{padding:"0 16px"}}>{testing?"发送中...":"测试发送"}</button></div>}
  </div>);
}

function WeixinBind({ adoptId }: { adoptId?: string }) {
  const [status, setStatus] = useState<"idle"|"loading"|"scanning"|"bound">("idle");
  const [qrcodeUrl, setQrcodeUrl] = useState("");
  const [qrcode, setQrcode] = useState("");
  const [userId, setUserId] = useState("");
  const [testing, setTesting] = useState(false);
  const pollRef = useRef<any>(null);

  useEffect(() => {
    if (!adoptId) return;
    fetch(`/api/claw/weixin/status?adoptId=${encodeURIComponent(adoptId)}`, { credentials: "include" })
      .then(r => r.json()).then(d => { if (d.bound) { setStatus("bound"); setUserId(d.userId || ""); } }).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [adoptId]);

  const startBind = async () => {
    if (!adoptId) return;
    setStatus("loading");
    try {
      const r = await fetch("/api/claw/weixin/qrcode", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adoptId }) });
      const d = await r.json();
      if (!d.qrcodeUrl) { toast.error("获取二维码失败"); setStatus("idle"); return; }
      setQrcodeUrl(d.qrcodeUrl);
      setQrcode(d.qrcode);
      setStatus("scanning");
      let baseUrl = "";
      pollRef.current = setInterval(async () => {
        try {
          const sr = await fetch(`/api/claw/weixin/qrstatus?adoptId=${encodeURIComponent(adoptId)}&qrcode=${encodeURIComponent(d.qrcode)}${baseUrl ? "&baseUrl=" + encodeURIComponent(baseUrl) : ""}`, { credentials: "include" });
          const sd = await sr.json();
          if (sd.status === "confirmed") { clearInterval(pollRef.current); setStatus("bound"); setUserId(sd.userId || ""); toast.success("微信绑定成功！"); }
          else if (sd.status === "scaned_but_redirect" && sd.baseUrl) { baseUrl = sd.baseUrl; }
          else if (sd.status === "expired") { clearInterval(pollRef.current); toast.error("二维码已过期，请重试"); setStatus("idle"); }
        } catch {}
      }, 2000);
    } catch { toast.error("获取二维码失败"); setStatus("idle"); }
  };

  const unbind = async () => {
    if (!adoptId || !confirm("确认解绑微信？")) return;
    await fetch("/api/claw/weixin/unbind", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adoptId }) });
    setStatus("idle"); setUserId(""); toast.success("已解绑");
  };

  const testSend = async () => {
    if (!adoptId) return;
    setTesting(true);
    try {
      const r = await fetch("/api/claw/weixin/test", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adoptId }) });
      const d = await r.json();
      if (d.ok) toast.success("测试消息已发送！"); else toast.error(d.error || "发送失败");
    } catch { toast.error("发送失败"); }
    finally { setTesting(false); }
  };

  return (
    <div className="settings-card" style={{ padding: 16 }}>
      <div className="text-xs font-medium mb-3" style={{ color: "var(--oc-text-primary)" }}>个人微信绑定</div>
      {status === "bound" ? (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
            <span className="text-xs" style={{ color: "var(--oc-text-primary)" }}>已绑定</span>
            <span className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>{userId ? userId.split("@")[0].slice(0, 8) + "..." : ""}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary-soft" onClick={testSend} disabled={testing} style={{ flex: 1 }}>{testing ? "发送中..." : "测试发送"}</button>
            <button className="skills-btn" onClick={unbind} style={{ padding: "0 16px", color: "var(--oc-danger)" }}>解绑</button>
          </div>
        </div>
      ) : status === "scanning" ? (
        <div style={{ textAlign: "center" }}>
          <div className="text-xs mb-2" style={{ color: "var(--oc-text-secondary)" }}>请用微信扫描二维码</div>
          {qrcodeUrl && <img src={"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + encodeURIComponent(qrcodeUrl)} alt="WeChat QR" style={{ width: 200, height: 200, margin: "0 auto", borderRadius: "var(--oc-radius-md)", background: "#fff" }} />}
          <div className="text-xs mt-2" style={{ color: "var(--oc-text-secondary)" }}>扫码后请在微信中确认</div>
        </div>
      ) : (
        <div>
          <div className="text-xs mb-3" style={{ color: "var(--oc-text-secondary)" }}>绑定个人微信后，定时任务、协作等通知将直接推送到你的微信</div>
          <button className="btn-primary-soft" onClick={startBind} disabled={status === "loading"} style={{ width: "100%" }}>{status === "loading" ? "获取二维码..." : "扫码绑定微信"}</button>
        </div>
      )}
    </div>
  );
}
