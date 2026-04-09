import { useEffect, useState } from "react";
import { PageContainer } from "@/components/console/PageContainer";
import { ChatMarkdown } from "@/components/ChatMarkdown";

type DreamingStatus = {
  enabled: boolean;
  frequency: string | null;
  nextRun: string | null;
  shortTermCount: number;
  longTermCount: number;
  promotedToday: number;
};

export function DreamsPage({ adoptId }: { adoptId: string }) {
  const [dreamsContent, setDreamsContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<DreamingStatus | null>(null);

  const loadDreams = async () => {
    if (!adoptId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/claw/memory/read?adoptId=${encodeURIComponent(adoptId)}&target=DREAMS.md`);
      if (r.ok) {
        const d = await r.json();
        setDreamsContent(d?.content || "");
      } else {
        setDreamsContent("");
      }
    } catch {
      setDreamsContent("");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDreams(); }, [adoptId]);

  const hasDreams = dreamsContent.trim().length > 0;

  return (
    <PageContainer title="梦境">
      <div className="space-y-4">
        {/* 状态卡片 */}
        <div className="settings-card" style={{ padding: 16 }}>
          <div className="flex items-center gap-3 mb-3">
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
              🌙
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>Dreaming 记忆系统</div>
              <div className="text-xs" style={{ color: "var(--oc-text-secondary)" }}>后台自动整合短期记忆，提炼为长期记忆</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3" style={{ marginTop: 12 }}>
            <div className="rounded-lg" style={{ padding: "10px 14px", background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.15)" }}>
              <div className="text-[11px]" style={{ color: "#a78bfa" }}>状态</div>
              <div className="text-sm font-medium" style={{ color: "var(--oc-text-primary)" }}>已启用</div>
            </div>
            <div className="rounded-lg" style={{ padding: "10px 14px", background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.15)" }}>
              <div className="text-[11px]" style={{ color: "#a78bfa" }}>执行频率</div>
              <div className="text-sm font-medium" style={{ color: "var(--oc-text-primary)" }}>每天 03:00</div>
            </div>
            <div className="rounded-lg" style={{ padding: "10px 14px", background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.15)" }}>
              <div className="text-[11px]" style={{ color: "#a78bfa" }}>三阶段</div>
              <div className="text-sm font-medium" style={{ color: "var(--oc-text-primary)" }}>Light → REM → Deep</div>
            </div>
          </div>

          <div className="text-[11px] mt-3" style={{ color: "var(--oc-text-secondary)", lineHeight: 1.6 }}>
            <strong>Light</strong>：收集近期信号，去重暂存 &nbsp;→&nbsp;
            <strong>REM</strong>：提取主题和模式 &nbsp;→&nbsp;
            <strong>Deep</strong>：加权打分，达标后写入 MEMORY.md
          </div>

          <div className="text-[11px] mt-2" style={{ color: "var(--oc-text-secondary)" }}>
            💡 你也可以在聊天中输入 <code style={{ background: "rgba(255,255,255,0.08)", padding: "1px 5px", borderRadius: 3, fontSize: 10 }}>/dreaming status</code> 查看实时状态
          </div>
        </div>

        {/* 梦��日记内容 */}
        <div className="settings-card" style={{ padding: 16 }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold" style={{ color: "var(--oc-text-primary)" }}>
              Dream Diary
              <span className="text-[11px] font-normal ml-2" style={{ color: "var(--oc-text-secondary)" }}>DREAMS.md</span>
            </div>
            <button className="skills-btn" onClick={loadDreams} style={{ fontSize: 11 }}>刷新</button>
          </div>

          {loading ? (
            <div className="text-xs" style={{ color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>加载中...</div>
          ) : hasDreams ? (
            <div className="sidebar-markdown" style={{ maxHeight: "60vh", overflow: "auto", padding: 12, borderRadius: 8, border: "1px solid var(--oc-border)", background: "rgba(0,0,0,0.15)" }}>
              <ChatMarkdown content={dreamsContent} />
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🌙</div>
              <div className="text-sm" style={{ color: "var(--oc-text-primary)", fontWeight: 500 }}>还没有梦境记录</div>
              <div className="text-xs mt-2" style={{ color: "var(--oc-text-secondary)", lineHeight: 1.6 }}>
                Dreaming 系统会在每天凌晨 3:00 自动运行。<br />
                它会分析你的对话历史，将有价值的信息提炼为长期记忆。<br />
                第一条梦境日记将在首次运行后出现。
              </div>
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
