import { useState, useEffect } from "react";
import { Search, Download, Check, Package, Loader2, Store } from "lucide-react";
import { toast } from "sonner";

const CATEGORY_MAP: Record<string, { label: string; emoji: string }> = {
  all:     { label: "全部",     emoji: "🔮" },
  writing: { label: "办公效率", emoji: "📄" },
  finance: { label: "金融专业", emoji: "💰" },
  dev:     { label: "开发工具", emoji: "🛠" },
  general: { label: "通用",     emoji: "🎨" },
  data:    { label: "数据分析", emoji: "📊" },
};

interface MarketSkill {
  id: number;
  skillId: string;
  title: string;
  description: string;
  author: string;
  installCount: number;
  version: string;
  category: string;
  license: string;
}

export function MarketplacePage({ adoptId }: { adoptId?: string }) {
  const [items, setItems] = useState<MarketSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [activeCat, setActiveCat] = useState("all");

  useEffect(() => {
    setLoading(true);
    fetch("/api/trpc/claw.marketList")
      .then((r) => r.json())
      .then((d) => {
        const list = d?.result?.data?.json || d?.result?.data || [];
        setItems(
          list.map((s: any) => ({
            id: s.id,
            skillId: s.skillId,
            title: s.name || s.skillId,
            description: s.description || "",
            author: s.author || "官方",
            installCount: s.downloadCount || 0,
            version: s.version || "1.0.0",
            category: s.category || "general",
            license: s.license || "MIT",
          }))
        );
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const onInstall = async (item: MarketSkill) => {
    if (!adoptId || installing) return;
    setInstalling(item.id);
    try {
      const r = await fetch("/api/trpc/claw.marketInstall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: { marketId: item.id, adoptId } }),
      });
      const d = await r.json();
      if (d?.error) throw new Error(d.error?.message || "安装失败");
      toast.success(`已安装：${item.title}`);
      setItems((prev) =>
        prev.map((x) =>
          x.id === item.id
            ? { ...x, installCount: (x.installCount || 0) + 1 }
            : x
        )
      );
    } catch (e: any) {
      toast.error(`安装失败${e?.message ? `: ${e.message}` : ""}`);
    } finally {
      setInstalling(null);
    }
  };

  const categories = ["all", ...new Set(items.map((x) => x.category))];

  const filtered = items.filter((x) => {
    const matchCat = activeCat === "all" || x.category === activeCat;
    const matchQ =
      !q.trim() ||
      `${x.title} ${x.description} ${x.skillId}`
        .toLowerCase()
        .includes(q.toLowerCase());
    return matchCat && matchQ;
  });

  const catCounts = items.reduce<Record<string, number>>((acc, x) => {
    acc[x.category] = (acc[x.category] || 0) + 1;
    return acc;
  }, {});

  return (
    <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 stealth-scrollbar">
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1
            className="text-lg"
            style={{
              color: "var(--oc-text-primary)",
              fontWeight: "var(--oc-weight-bold)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Store size={20} style={{ color: "var(--oc-accent)" }} />
            技能市场
          </h1>
          <p
            className="text-xs"
            style={{ color: "var(--oc-text-secondary)", marginTop: 4 }}
          >
            浏览和安装技能，让你的虾拥有更多专业能力
          </p>
        </div>

        {/* Search + Category Tabs */}
        <div
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 20,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div
            className="skills-search"
            style={{ flex: "1 1 200px", maxWidth: 320 }}
          >
            <Search
              size={14}
              style={{ color: "var(--oc-text-secondary)", flexShrink: 0 }}
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索技能..."
              style={{ flex: 1 }}
            />
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {categories.map((cat) => {
              const meta = CATEGORY_MAP[cat] || {
                label: cat,
                emoji: "📦",
              };
              const active = activeCat === cat;
              const count =
                cat === "all" ? items.length : catCounts[cat] || 0;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCat(cat)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "6px 14px",
                    fontSize: "var(--oc-text-base)",
                    fontWeight: active ? 600 : 400,
                    borderRadius: 999,
                    border: "1px solid",
                    borderColor: active
                      ? "var(--oc-accent)"
                      : "var(--oc-border)",
                    background: active
                      ? "var(--oc-accent-subtle, rgba(59,130,246,0.08))"
                      : "transparent",
                    color: active
                      ? "var(--oc-accent)"
                      : "var(--oc-text-secondary)",
                    cursor: "pointer",
                    transition: "all .15s ease",
                  }}
                >
                  {meta.emoji} {meta.label}
                  <span
                    style={{
                      fontSize: "var(--oc-text-xs)",
                      opacity: 0.7,
                      marginLeft: 2,
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div
            style={{
              textAlign: "center",
              padding: 48,
              color: "var(--oc-text-secondary)",
            }}
          >
            <Loader2
              size={24}
              className="animate-spin"
              style={{ margin: "0 auto 8px" }}
            />
            <div className="text-sm">加载中...</div>
          </div>
        )}

        {/* Empty state */}
        {!loading && filtered.length === 0 && (
          <div
            className="settings-card"
            style={{ textAlign: "center", padding: 48 }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>🏪</div>
            <div
              className="text-sm"
              style={{ color: "var(--oc-text-secondary)" }}
            >
              {items.length === 0
                ? "技能市场暂无技能"
                : "没有匹配的技能"}
            </div>
          </div>
        )}

        {/* Skill Cards Grid */}
        {!loading && filtered.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            {filtered.map((item) => {
              const catMeta = CATEGORY_MAP[item.category] || {
                label: item.category,
                emoji: "📦",
              };
              return (
                <div
                  key={item.id}
                  className="settings-card"
                  style={{
                    padding: "16px 18px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    transition: "box-shadow .15s ease",
                  }}
                >
                  {/* Top: title + category badge */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 8,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        className="text-sm"
                        style={{
                          color: "var(--oc-text-primary)",
                          fontWeight: "var(--oc-weight-semibold)",
                          lineHeight: 1.4,
                        }}
                      >
                        {catMeta.emoji} {item.title}
                      </div>
                      <div
                        className="text-xs"
                        style={{
                          color: "var(--oc-text-secondary)",
                          marginTop: 2,
                        }}
                      >
                        {item.author} · v{item.version}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: "var(--oc-text-xs)",
                        padding: "2px 8px",
                        borderRadius: 999,
                        background:
                          "var(--oc-accent-subtle, rgba(59,130,246,0.08))",
                        color: "var(--oc-accent)",
                        fontWeight: "var(--oc-weight-medium)",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {catMeta.label}
                    </span>
                  </div>

                  {/* Description */}
                  <div
                    className="text-xs"
                    style={{
                      color: "var(--oc-text-secondary)",
                      lineHeight: 1.6,
                      flex: 1,
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {item.description}
                  </div>

                  {/* Bottom: install count + button */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span
                      className="text-xs"
                      style={{ color: "var(--oc-text-secondary)" }}
                    >
                      <Download
                        size={12}
                        style={{
                          display: "inline",
                          marginRight: 3,
                          verticalAlign: -1,
                        }}
                      />
                      {item.installCount} 次安装
                    </span>
                    <button
                      className="btn-primary-soft"
                      style={{
                        fontSize: "var(--oc-text-sm)",
                        padding: "5px 14px",
                        borderRadius: "var(--oc-radius-sm)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                      disabled={installing === item.id}
                      onClick={() => onInstall(item)}
                    >
                      {installing === item.id ? (
                        <>
                          <Loader2
                            size={12}
                            className="animate-spin"
                          />{" "}
                          安装中
                        </>
                      ) : (
                        <>
                          <Download size={12} /> 安装
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
