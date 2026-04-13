import { MessageSquareText, Bot, Sparkles, MessageCircle, CalendarClock, Settings2, BookOpen, Users, Moon } from "lucide-react";
export type PageKey = "chat" | "skills" | "weixin" | "agent" | "schedule" | "dreams" | "collab" | "settings" | "docs";
const items: { key: PageKey; label: string; icon: any }[] = [
  { key: "chat", label: "聊天", icon: MessageSquareText },
  { key: "skills", label: "技能", icon: Sparkles },
  { key: "weixin", label: "微信", icon: MessageCircle },
  { key: "agent", label: "代理", icon: Bot },
  { key: "schedule", label: "定时任务", icon: CalendarClock },
  { key: "dreams", label: "梦境记忆", icon: Moon },
  { key: "collab", label: "智能体协作", icon: Users },
  { key: "settings", label: "设置", icon: Settings2 },
  { key: "docs", label: "文档", icon: BookOpen },
];

export function Sidebar({
  activePage,
  setActivePage,
  collapsed,
  onOpenSettings,
}: {
  activePage: PageKey;
  setActivePage: (k: PageKey) => void;
  collapsed?: boolean;
  onOpenSettings?: () => void;
}) {
  return (
    <div className="px-2 py-3 space-y-1 flex flex-col h-full">
      <div className="space-y-1">
        {items.map((it) => {
          const Icon = it.icon;
          const active = activePage === it.key;
          return (
            <button key={it.key} title={it.label} onClick={() => setActivePage(it.key)} className={`w-full flex items-center gap-2 px-3 py-2.5 text-left sidebar-item ${active ? "active" : ""}`} style={{ border: "none", background: "transparent" }}>
              {active && <span className="sidebar-item-indicator" />}
              <Icon size={16} className="sidebar-item-icon" style={{ color: active ? "var(--oc-accent)" : "var(--oc-text-secondary)" }} />
              {!collapsed && <span className="text-sm sidebar-item-label" style={{ color: active ? "var(--oc-accent)" : "var(--oc-text-secondary)" }}>{it.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
