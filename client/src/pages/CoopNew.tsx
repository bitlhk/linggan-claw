/**
 * CoopNew — 发起多人协作
 * URL: /coop/new
 *
 * 流程：
 *   1. 填协作标题 + 原始消息
 *   2. 选人（从 coop.mentionCandidates 拉候选，按 group 过滤）
 *   3. 每人一个子任务（默认 = 原始消息）
 *   4. 发起 → coop.create → 跳 /coop/:sessionId
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Users as UsersIcon, Search, UserPlus, X, Bot, Sparkles } from "lucide-react";

type Candidate = {
  userId: number;
  userName: string | null;
  userEmail: string | null;
  groupId: number | null;
  groupName: string | null;
  orgName: string | null;
  adoptId: string | null;
  adoptionStatus: string | null;
};

type SelectedMember = {
  cand: Candidate;
  subtask: string;
};

type PrefillPayload = {
  origin?: string;
  title?: string;
  members?: Array<{ userId: number; userName?: string | null; adoptId?: string | null }>;
};

export default function CoopNew() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const selfUserId = user?.id;
  const [title, setTitle] = useState("");
  const [originMessage, setOriginMessage] = useState("");
  const [keyword, setKeyword] = useState("");
  const [groupFilter, setGroupFilter] = useState<number | undefined>(undefined);
  const [selected, setSelected] = useState<SelectedMember[]>([]);

  // 预填来源：主聊天 @ ≥2 人后跳转过来时，sessionStorage 里的 coop_prefill
  // 包含 origin（原始消息）+ members（已 @ 的 userId 列表）
  // 候选拉回后再匹配预选成员（async 时序）
  const [pendingPrefillMembers, setPendingPrefillMembers] = useState<PrefillPayload["members"]>(undefined);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("coop_prefill");
      if (!raw) return;
      const p: PrefillPayload = JSON.parse(raw);
      if (p.origin) {
        setOriginMessage(p.origin);
        setTitle((p.title || p.origin).slice(0, 80).split(/\n/)[0]);
      }
      if (p.members?.length) setPendingPrefillMembers(p.members);
      sessionStorage.removeItem("coop_prefill");
    } catch {}
  }, []);

  // 查白名单状态
  const wlQ = trpc.coop.isWhitelisted.useQuery();
  // 候选人列表
  const { data: rawCandidates, isLoading: candLoading } = trpc.coop.mentionCandidates.useQuery(
    { keyword: keyword || undefined, groupId: groupFilter, limit: 200 },
    { enabled: Boolean(wlQ.data?.whitelisted) }
  );
  const createMut = trpc.coop.create.useMutation({
    onSuccess: (r) => {
      toast.success("协作已发起");
      setLocation(`/coop/${r.sessionId}`);
    },
    onError: (e) => toast.error(e.message || "发起失败"),
  });

  // 候选拉回后，匹配预填的 members（来自主聊天 @ 跳转）
  useEffect(() => {
    if (!pendingPrefillMembers?.length) return;
    if (!rawCandidates) return;
    const candById = new Map<number, Candidate>();
    (rawCandidates as Candidate[]).forEach((c) => candById.set(c.userId, c));
    const matched: SelectedMember[] = [];
    const missing: string[] = [];
    for (const m of pendingPrefillMembers) {
      const c = candById.get(m.userId);
      if (c) {
        matched.push({ cand: c, subtask: originMessage });
      } else {
        missing.push(m.userName || `user#${m.userId}`);
      }
    }
    if (matched.length > 0) setSelected(matched);
    if (missing.length > 0) toast.warning(`部分成员未在候选列表中: ${missing.join(", ")}`);
    setPendingPrefillMembers(undefined);
    // originMessage 此时已通过上一个 useEffect 设好；matched 的 subtask 跟随 originMessage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawCandidates, pendingPrefillMembers]);

  // 收集 group 列表做筛选 tabs
  const groups = useMemo(() => {
    const map = new Map<number, string>();
    (rawCandidates || []).forEach((c: Candidate) => {
      if (c.groupId && c.groupName) map.set(c.groupId, c.groupName);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [rawCandidates]);

  // 候选人（按 group 筛选 + 排除已选）
  const candidates = useMemo(() => {
    const excludedIds = new Set(selected.map((s) => s.cand.userId));
    const list = (rawCandidates || []).filter((c: Candidate) => !excludedIds.has(c.userId));
    // 发起人置顶
    if (selfUserId !== undefined) {
      list.sort((a, b) => (a.userId === selfUserId ? -1 : b.userId === selfUserId ? 1 : 0));
    }
    return list;
  }, [rawCandidates, selected, selfUserId]);

  const pickCandidate = (c: Candidate) => {
    setSelected((prev) => [...prev, { cand: c, subtask: originMessage }]);
  };
  const unpickCandidate = (uid: number) => {
    setSelected((prev) => prev.filter((s) => s.cand.userId !== uid));
  };
  const updateSubtask = (uid: number, v: string) => {
    setSelected((prev) => prev.map((s) => (s.cand.userId === uid ? { ...s, subtask: v } : s)));
  };

  // originMessage 变化时，未手动改过子任务的成员跟随更新（粗略：只更新等于上一个 originMessage 的）
  const [prevOrigin, setPrevOrigin] = useState(originMessage);
  useEffect(() => {
    if (prevOrigin === originMessage) return;
    setSelected((prev) => prev.map((s) => (s.subtask === prevOrigin ? { ...s, subtask: originMessage } : s)));
    setPrevOrigin(originMessage);
  }, [originMessage, prevOrigin]);

  // 当前发起人的 adoptId（取第一个 active；真实演示可从现有登录态取）
  const { data: myClawData } = trpc.claw.me.useQuery(undefined, { retry: false });
  const creatorAdoptId = (myClawData as any)?.adoptId || "lgc-creator";

  const canSubmit =
    title.trim().length > 0 &&
    originMessage.trim().length > 0 &&
    selected.length >= 1 &&
    selected.every((s) => s.subtask.trim().length > 0);

  const handleSubmit = () => {
    createMut.mutate({
      title: title.trim(),
      originMessage: originMessage.trim(),
      creatorAdoptId,
      members: selected.map((s) => ({
        userId: s.cand.userId,
        targetAdoptId: s.cand.adoptId || `mock:${s.cand.userId}`,
        subtask: s.subtask.trim(),
      })),
    });
  };

  // 白名单拦截
  if (wlQ.isLoading) {
    return <div className="flex items-center justify-center h-screen"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }
  if (!wlQ.data?.whitelisted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center">
        <div className="text-xl font-semibold text-foreground mb-2">协作功能灰度中</div>
        <div className="text-sm text-muted-foreground mb-6">当前版本仅对内部用户开放测试，请联系管理员加入白名单</div>
        <Button variant="outline" onClick={() => setLocation("/")}><ArrowLeft className="w-4 h-4 mr-1" /> 返回首页</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30">
      {/* 顶部 */}
      <div className="sticky top-0 z-10 bg-card/80 backdrop-blur border-b border-border/50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <Button variant="ghost" size="sm" className="text-foreground" onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> 返回
          </Button>
          <div className="flex-1 flex items-center gap-2">
            <UsersIcon className="w-5 h-5 text-blue-600" />
            <h1 className="text-lg font-semibold text-foreground">发起多人协作</h1>
            <span className="text-xs text-muted-foreground">·  多智能体并行 · 自动汇总</span>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">
        {/* 1. 协作描述 */}
        <Card className="p-5 bg-card border-border/50">
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-foreground mb-1 block">协作标题</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：Q1 合规报告" className="text-sm" />
            </div>
            <div>
              <Label className="text-xs text-foreground mb-1 block">原始任务描述</Label>
              <Textarea
                value={originMessage}
                onChange={(e) => setOriginMessage(e.target.value)}
                placeholder="详细说明要协作完成的事情，未被手动修改的子任务会跟随这里更新"
                className="min-h-[80px] text-sm"
              />
            </div>
          </div>
        </Card>

        {/* 2. 选人 */}
        <Card className="p-5 bg-card border-border/50">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-semibold text-foreground">选择协作成员</div>
            <div className="text-xs text-muted-foreground">已选 {selected.length} 人</div>
          </div>
          <div className="text-[11px] text-muted-foreground mb-3">
            💡 发起人（你）默认只负责最终整合。若<strong className="text-foreground">也想让自己的 agent 干一部分活</strong>，在候选列表里选中「你（我）」即可。
          </div>
          
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索姓名/部门..." className="pl-8 text-sm h-8" />
            </div>
          </div>

          {/* group 筛选 */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <button onClick={() => setGroupFilter(undefined)} className={`text-[11px] px-2 py-0.5 rounded-full border ${groupFilter === undefined ? "bg-blue-600 text-white border-blue-600" : "bg-card text-foreground border-border"}`}>全部</button>
            {groups.map((g) => (
              <button key={g.id} onClick={() => setGroupFilter(g.id)} className={`text-[11px] px-2 py-0.5 rounded-full border ${groupFilter === g.id ? "bg-blue-600 text-white border-blue-600" : "bg-card text-foreground border-border"}`}>
                {g.name}
              </button>
            ))}
          </div>

          {/* 候选人列表 */}
          <div className="max-h-[240px] overflow-auto border border-border/40 rounded">
            {candLoading ? (
              <div className="p-4 text-center text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin inline mr-1" /> 加载中</div>
            ) : candidates.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">{(rawCandidates || []).length === 0 ? "没有候选人（需要 groupId > 0 的内部用户）" : "已全部选完 / 筛选无结果"}</div>
            ) : (
              candidates.map((c: Candidate) => (
                <button key={c.userId} onClick={() => pickCandidate(c)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 border-b border-border/30 last:border-b-0 text-left">
                  <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-foreground shrink-0">
                    {(c.userName || "?").slice(0, 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                      {c.userName || "(未命名)"}
                      {c.userId === selfUserId ? <span className="text-[10px] px-1.5 py-0 rounded-full bg-blue-100 text-blue-700 font-normal">我 · 发起人</span> : null}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {c.orgName || "—"}
                      {c.groupName ? <><span className="mx-1">·</span><span className="text-blue-600">{c.groupName}</span></> : null}
                      {c.adoptId ? <><span className="mx-1">·</span>🟢 Agent: {c.adoptId.slice(0, 12)}</> : <><span className="mx-1">·</span>⚪ 无灵虾</>}
                    </div>
                  </div>
                  <UserPlus className="w-4 h-4 text-blue-600 shrink-0" />
                </button>
              ))
            )}
          </div>
        </Card>

        {/* 3. 每人子任务（可编辑） */}
        {selected.length > 0 ? (
          <Card className="p-5 bg-card border-border/50">
            <div className="text-sm font-semibold text-foreground mb-3">给每位成员的子任务（可分别调整）</div>
            <div className="space-y-3">
              {selected.map((s) => (
                <div key={s.cand.userId} className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-700 shrink-0 mt-1">
                    {(s.cand.userName || "?").slice(0, 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs">
                        <span className="font-medium">{s.cand.userName}</span>
                        <span className="mx-1">·</span>
                        <span className="text-blue-600">{s.cand.groupName}</span>
                        {(s.cand.adoptionStatus || s.cand.adoptId) ? <span className="ml-1 text-green-600">🤖</span> : <span className="ml-1 text-muted-foreground">（模拟 agent）</span>}
                      </div>
                      <button onClick={() => unpickCandidate(s.cand.userId)} className="text-muted-foreground hover:text-red-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <Textarea
                      value={s.subtask}
                      onChange={(e) => updateSubtask(s.cand.userId, e.target.value)}
                      className="text-xs min-h-[60px]"
                      placeholder="分配给该成员的具体子任务"
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {/* 4. 提交 */}
        <div className="flex justify-end gap-2 pb-8">
          <Button variant="ghost" onClick={() => setLocation("/")}>取消</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || createMut.isPending} className="bg-blue-600 hover:bg-blue-700">
            {createMut.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            <Sparkles className="w-3 h-3 mr-1" /> 发起协作
          </Button>
        </div>
      </div>
    </div>
  );
}
