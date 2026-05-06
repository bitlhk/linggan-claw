import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { PageContainer } from "@/components/console/PageContainer";
import { Users, ArrowLeft, Plus } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { sessionStatusMeta } from "@/lib/coopStatus";
import { CoopNewForm } from "@/pages/CoopNew";
import { Button } from "@/components/ui/button";

type PageMode = "list" | "create";

export function CollabPage({ adoptId: _adoptId }: { adoptId: string }) {
  const [, setLocationCoop] = useLocation();
  const [mode, setMode] = useState<PageMode>("list");

  // 发起模式：占满 PageContainer 内容区，复用 CoopNewForm
  if (mode === "create") {
    return (
      <PageContainer title="协作" icon={<Users size={18} />}>
        <div className="flex items-center gap-2 mb-4">
          <Button variant="ghost" size="sm" onClick={() => setMode("list")} className="text-foreground">
            <ArrowLeft className="w-4 h-4 mr-1" /> 返回协作群组
          </Button>
          <div className="text-sm font-semibold text-foreground">发起多人协作</div>
          <span className="text-xs text-muted-foreground">·  多智能体并行 · 自动汇总</span>
        </div>
        <CoopNewForm
          onDone={(sid) => setLocationCoop(`/coop/${sid}`)}
          onCancel={() => setMode("list")}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer title="协作" icon={<Users size={18} />}>
      <div className="page-section-toolbar">
        <div className="page-section-title">
          <h2 className="page-section-title__main">协作群组</h2>
          <p className="page-section-title__desc">多人协作、任务分发和自动汇总</p>
        </div>
        <button
          onClick={() => setMode("create")}
          className="page-primary-action"
          title="发起多人协作"
        >
          <Plus size={15} aria-hidden="true" />
          发起多人协作
        </button>
      </div>

      <CoopSessionsList onCreate={() => setMode("create")} />
    </PageContainer>
  );
}


// ── 协作群组列表（新 V2）─────────────────────────────────────
function CoopSessionsList({ onCreate }: { onCreate?: () => void }) {
  const [, setLoc] = useLocation();
  const { data: sessions, isLoading, refetch } = trpc.coop.listMySessions.useQuery({ limit: 50 }, {
    refetchInterval: 10_000,
  });
  const list = (sessions as any[]) || [];

  // 卡片 ⋯ 菜单：哪个卡片的菜单当前打开
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // 点击外部关闭菜单
  useEffect(() => {
    if (!openMenuId) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t?.closest?.("[data-coop-menu]") || t?.closest?.("[data-coop-menu-trigger]")) return;
      setOpenMenuId(null);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [openMenuId]);

  const softDeleteMut = trpc.coop.softDelete.useMutation({
    onSuccess: () => { toast.success("协作已删除"); setOpenMenuId(null); refetch(); },
    onError: (e) => toast.error(e.message || "删除失败"),
  });
  const toggleHideMut = trpc.coop.toggleHide.useMutation({
    onSuccess: (r) => { toast.success(r.hidden ? "已隐藏（仅你看不见）" : "已取消隐藏"); setOpenMenuId(null); refetch(); },
    onError: (e) => toast.error(e.message || "操作失败"),
  });

  const handleDelete = (s: any) => {
    if (!window.confirm(`确认删除协作「${s.title || s.id}」？\n\n所有成员的视图都会消失（软删除，30 天内可联系管理员恢复）。`)) return;
    softDeleteMut.mutate({ sessionId: s.id });
  };
  const handleHide = (s: any) => {
    if (!window.confirm(`从你的列表隐藏「${s.title || s.id}」？\n\n仅影响你的视图，发起人和其他成员不受影响。`)) return;
    toggleHideMut.mutate({ sessionId: s.id, hide: true });
  };

  if (isLoading) return <div className="p-6 text-center text-sm text-muted-foreground">加载中...</div>;
  if (list.length === 0) {
    return (
      <div className="p-8 text-center">
        <div className="text-sm text-muted-foreground mb-3">还没有协作群组</div>
        <button
          onClick={() => onCreate?.()}
          style={{
            padding: "8px 20px",
            background: "var(--oc-accent)",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          + 发起第一个协作
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "var(--oc-text-secondary)", flex: 1, alignSelf: "center" }}>
          共 {list.length} 个协作群组
        </div>
        <button onClick={() => refetch()} style={{ fontSize: 11, padding: "4px 10px", background: "transparent", border: "1px solid var(--oc-border)", borderRadius: 4, cursor: "pointer", color: "var(--oc-text-primary)" }}>
          刷新
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
        {list.map((s: any) => {
          const meta = sessionStatusMeta(s.status);
          const needMyAction = (s.i_am_member === 1 || s.i_am_member === true) && s.my_request_status === "pending";
          const needMyConsolidate = (s.i_am_creator === 1 || s.i_am_creator === true) && s.status === "running" && s.completed_members > 0 && s.completed_members + 0 >= Number(s.total_members) - Number(s.pending_members);
          return (
            <div key={s.id}
              onClick={() => setLoc(`/coop/${s.id}`)}
              style={{
                background: "var(--oc-bg-elevated, #fff)",
                border: "1px solid var(--oc-border)",
                borderRadius: 8,
                padding: 14,
                cursor: "pointer",
                position: "relative",
              }}
            >
              {(needMyAction || needMyConsolidate) ? (
                <div style={{ position: "absolute", top: 10, right: 32, width: 8, height: 8, borderRadius: "50%", background: "var(--oc-danger)" }} />
              ) : null}

              {/* ⋯ 菜单触发 */}
              <button
                data-coop-menu-trigger
                onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === s.id ? null : s.id); }}
                title="更多操作"
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  width: 24,
                  height: 24,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: openMenuId === s.id ? "var(--oc-bg-hover, rgba(0,0,0,0.06))" : "transparent",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  color: "var(--oc-text-secondary)",
                  fontSize: 16,
                  lineHeight: 1,
                  fontWeight: 700,
                }}
                onMouseEnter={(e) => { if (openMenuId !== s.id) e.currentTarget.style.background = "var(--oc-bg-hover, rgba(0,0,0,0.06))"; }}
                onMouseLeave={(e) => { if (openMenuId !== s.id) e.currentTarget.style.background = "transparent"; }}
              >
                ⋯
              </button>

              {/* ⋯ 浮动菜单 */}
              {openMenuId === s.id ? (
                <div
                  data-coop-menu
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    top: 32,
                    right: 6,
                    minWidth: 180,
                    background: "var(--oc-bg, #fff)",
                    border: "1px solid var(--oc-border-strong, rgba(0,0,0,0.12))",
                    borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                    padding: 4,
                    zIndex: 30,
                    backdropFilter: "blur(12px)",
                  }}
                >
                  {(s.i_am_creator === 1 || s.i_am_creator === true) ? (
                    <button
                      onClick={() => handleDelete(s)}
                      disabled={softDeleteMut.isPending}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        width: "100%", padding: "8px 10px", border: "none",
                        borderRadius: 4, background: "transparent",
                        color: "var(--oc-danger)", fontSize: 12, cursor: "pointer", textAlign: "left",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in oklab, var(--oc-danger) 8%, transparent)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      🗑 删除协作（全员看不见）
                    </button>
                  ) : (
                    <button
                      onClick={() => handleHide(s)}
                      disabled={toggleHideMut.isPending}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        width: "100%", padding: "8px 10px", border: "none",
                        borderRadius: 4, background: "transparent",
                        color: "var(--oc-text-primary)", fontSize: 12, cursor: "pointer", textAlign: "left",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--oc-bg-hover, rgba(0,0,0,0.05))")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      👁 从我的列表隐藏
                    </button>
                  )}
                </div>
              ) : null}

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, paddingRight: 28 }}>
                <div style={{ fontSize: 14, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--oc-text-primary)" }}>
                  {s.title || "(无标题)"}
                </div>
                <span className={`badge ${meta.badgeClass}`} style={{ flexShrink: 0 }}>
                  {meta.label}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--oc-text-secondary)", marginBottom: 8 }}>
                发起人：{s.creator_name || `#${s.creator_user_id}`}
                {(s.i_am_creator === 1 || s.i_am_creator === true) ? <span style={{ marginLeft: 4, color: "var(--oc-accent)", fontWeight: 500 }}>（我发起的）</span> : null}
              </div>
              <div style={{ fontSize: 11, color: "var(--oc-text-secondary)" }}>
                {s.total_members} 人参与 · {s.completed_members} 已提交 · {s.pending_members > 0 ? `${s.pending_members} 等响应` : "全员响应"}
              </div>
              {needMyAction ? <div style={{ marginTop: 6, fontSize: 11, color: "var(--oc-warning)" }}>⚠ 你被邀请，等待响应</div> : null}
              {needMyConsolidate ? <div style={{ marginTop: 6, fontSize: 11, color: "var(--oc-purple)" }}>💡 可以发起 AI 汇总了</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
