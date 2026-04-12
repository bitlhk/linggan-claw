import React, { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { applySettings, getSettings, subscribeSettings } from "@/lib/settings";
import type { UiSettings } from "@/types/settings";

type Section = "appearance" | "chat" | "layout";

const SECTIONS: { key: Section; label: string; emoji: string }[] = [
  { key: "appearance", label: "外观", emoji: "🎨" },
  { key: "chat", label: "聊天", emoji: "💬" },
  { key: "layout", label: "布局", emoji: "📐" },
];

const THEMES = [
  { key: "claw" as const, label: "Claw", color: "#ff5c5c", desc: "珊瑚红 · 默认" },
  { key: "knot" as const, label: "Knot", color: "#e5243b", desc: "深红 · 高对比" },
  { key: "dash" as const, label: "Dash", color: "#b47840", desc: "棕金 · 仪表盘" },
  { key: "ember" as const, label: "Ember", color: "#c96442", desc: "余烬 · 暖感文学" },
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
      <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 450 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center" }}>{children}</div>
    </div>
  );
}

function SectionTitle({ emoji, label, desc }: { emoji: string; label: string; desc?: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: 0 }}>
        {emoji} {label}
      </h3>
      {desc && <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>{desc}</p>}
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
}: {
  memoryEnabled: "yes" | "no";
  setMemoryEnabled: (v: "yes" | "no") => void;
  contextTurns: number;
  setContextTurns: (v: number) => void;
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
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
          background: "var(--panel)",
          padding: "16px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
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
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                background: active ? "var(--accent-subtle)" : "transparent",
                color: active ? "var(--accent)" : "var(--muted)",
                transition: "background .15s, color .15s",
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 14 }}>{s.emoji}</span>
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
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", marginBottom: 12 }}>主题</div>
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
                        border: active ? `1.5px solid ${t.color}` : "1.5px solid var(--border)",
                        background: active ? `color-mix(in srgb, ${t.color} 8%, var(--card))` : "var(--card)",
                        cursor: "pointer",
                        transition: "border-color .15s, background .15s",
                        gap: 10,
                      }}
                    >
                      {/* 色块预览：accent 圆点 + 两个固定灰色方块模拟背景层次 */}
                      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                        <span style={{ width: 18, height: 18, borderRadius: "50%", background: t.color, display: "block", flexShrink: 0, boxShadow: `0 0 6px ${t.color}55` }} />
                        <span style={{ width: 10, height: 18, borderRadius: 4, background: "#161920", display: "block" }} />
                        <span style={{ width: 10, height: 18, borderRadius: 4, background: "#111520", display: "block" }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: active ? t.color : "var(--text)" }}>{t.label}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{t.desc}</div>
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
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
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
                      fontSize: 12,
                      fontWeight: 500,
                      background: uiSettings.themeMode === m.key ? "var(--accent)" : "transparent",
                      color: uiSettings.themeMode === m.key ? "#fff" : "var(--muted)",
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
                  style={{ width: 140, accentColor: "var(--accent)" }}
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
                <SelectContent style={{ minWidth: 96, background: "var(--panel)", border: "1px solid var(--border)" }}>
                  <SelectItem value="yes" className="text-xs" style={{ color: "var(--muted)" }}>
                    开启
                  </SelectItem>
                  <SelectItem value="no" className="text-xs" style={{ color: "var(--muted)" }}>
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
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--text)",
                  fontSize: 13,
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

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              {!canSave ? (
                <p style={{ fontSize: 12, color: "var(--warning)" }}>登录后可保存设置</p>
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
                    fontSize: 13,
                    fontWeight: 500,
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
                style={{ width: 140, accentColor: "var(--accent)" }}
              />
            </SettingRow>
          </div>
        )}
      </div>
    </main>
  );
}
