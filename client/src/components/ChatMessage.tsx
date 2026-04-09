import { BrandIcon } from "@/components/BrandIcon";
import { memo, useState, useRef } from "react";
import { ChatMarkdown } from "@/components/ChatMarkdown";

export type ToolCallEntry = {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  status: "running" | "done" | "error";
  durationMs?: number;
  ts: number;
  executor?: "sandbox" | "native" | "none" | "gateway";
  truncated?: boolean;
  suppressedOriginalResult?: boolean;
  policyDenyReason?: string;
  auditId?: string;
  outputFiles?: Array<{ name: string; size: number }>;
  adoptId?: string;
  _gateway?: boolean;
};

type ChatMessageProps = {
  role: "user" | "assistant";
  text: string;
  isLast: boolean;
  isPlaceholder: boolean;
  streaming: boolean;
  displayName: string;
  modelId: string;
  timeLabel: string;
  toolCalls?: ToolCallEntry[];
  showToolCalls?: boolean;
  usage?: { input: number; output: number };
  contextPercent?: number | null;
  onDelete?: () => void;
};

function prettyModelName(modelId: string) {
  const m = String(modelId || "").trim();
  if (!m) return "default";
  if (m === "modelarts-maas/glm-5" || m === "glm5/glm-5" || m === "glm5/glm-5.1" || m === "modelarts-maas/glm-5.1") return "GLM-5.1";
  if (m.includes("/")) return m.split("/").pop() || m;
  return m;
}

// ── Gateway 内部工具内联状态（web_search / memory_search 等）──
const GATEWAY_TOOL_META: Record<string, { icon: string; label: string }> = {
  web_search:    { icon: "🔍", label: "搜索网页" },
  web_fetch:     { icon: "🌐", label: "获取网页" },
  memory_search: { icon: "🧠", label: "查找记忆" },
  read:          { icon: "📄", label: "读取文件" },
  thinking:      { icon: "💭", label: "深度思考" },
};

function GatewayToolInline({ tc }: { tc: ToolCallEntry }) {
  const meta = GATEWAY_TOOL_META[tc.name] || { icon: "⚙️", label: tc.name };
  const isRunning = tc.status === "running";
  const elapsed = tc.durationMs != null ? tc.durationMs : (isRunning ? Date.now() - tc.ts : 0);
  const elapsedSec = Math.max(0, Math.round(elapsed / 1000));

  return (
    <div className="gw-tool-inline" style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 12px", margin: "6px 0",
      borderRadius: 10,
      background: isRunning ? "rgba(99,102,241,0.06)" : "rgba(120,120,140,0.04)",
      border: `1px solid ${isRunning ? "rgba(99,102,241,0.15)" : "rgba(120,120,140,0.1)"}`,
      fontSize: 13, color: isRunning ? "#818cf8" : "#8b8fa3",
      transition: "all 0.3s ease",
      position: "relative", overflow: "hidden",
    }}>
      {/* shimmer 动画条 */}
      {isRunning && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: 2,
          background: "linear-gradient(90deg, transparent 0%, rgba(99,102,241,0.4) 50%, transparent 100%)",
          backgroundSize: "200% 100%",
          animation: "gw-shimmer 1.8s ease-in-out infinite",
        }} />
      )}
      <span style={{ fontSize: 15, lineHeight: 1, flexShrink: 0 }}>{meta.icon}</span>
      <span style={{ fontWeight: 500 }}>
        {isRunning ? `正在${meta.label}` : meta.label}
      </span>
      {isRunning ? (
        <span style={{ display: "inline-flex", gap: 2, marginLeft: 2 }}>
          <span style={{ animation: "gw-dot 1.4s infinite", animationDelay: "0s" }}>·</span>
          <span style={{ animation: "gw-dot 1.4s infinite", animationDelay: "0.2s" }}>·</span>
          <span style={{ animation: "gw-dot 1.4s infinite", animationDelay: "0.4s" }}>·</span>
        </span>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      )}
      {elapsedSec > 0 && (
        <span style={{ fontSize: 11, opacity: 0.6, marginLeft: "auto" }}>{elapsedSec}s</span>
      )}
      <style>{`
        @keyframes gw-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes gw-dot {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}

function ToolCallCard({ tc }: { tc: ToolCallEntry }) {
  const isRunning = tc.status === "running";
  const isDone    = tc.status === "done";
  const isError   = tc.status === "error";

  let argsDisplay = tc.arguments;
  try {
    const parsed = JSON.parse(tc.arguments);
    argsDisplay = JSON.stringify(parsed, null, 2);
  } catch {}

  const duration = tc.durationMs != null ? `${tc.durationMs}ms` : null;

  return (
    <div className="lingxia-toolcard">
      <div className="lingxia-toolcard__header">
        <span>🛠️</span>
        <span className="lingxia-toolcard__title">{tc.name}</span>
        <span className="lingxia-toolcard__status">
          {isRunning && <span className="animate-pulse">执行中…</span>}
          {isDone    && "✓"}
          {isError   && "✕"}
        </span>
        <div className="lingxia-toolcard__meta">
          {tc.executor === "sandbox" && (
            <span className="lingxia-toolcard__chip lingxia-toolcard__chip--sandbox">沙箱</span>
          )}
          {tc.truncated && (
            <span className="lingxia-toolcard__chip lingxia-toolcard__chip--warn">输出已截断</span>
          )}
          {tc.policyDenyReason && (
            <span className="lingxia-toolcard__chip lingxia-toolcard__chip--danger">安全策略拒绝</span>
          )}
          {duration && <span className="lingxia-toolcard__status">{duration}</span>}
        </div>
      </div>

      <div className="lingxia-toolcard__body">
        {argsDisplay && (
          <div className="lingxia-toolcard__section">
            <div className="lingxia-toolcard__label">参数</div>
            <pre className="lingxia-toolcard__pre">{argsDisplay}</pre>
          </div>
        )}

        {!isRunning && (
          <div className="lingxia-toolcard__section">
            <div className="lingxia-toolcard__label">{isError ? "错误" : "结果"}</div>
            <pre className="lingxia-toolcard__pre">{tc.result || "(无输出)"}</pre>
          </div>
        )}

        {tc.outputFiles && tc.outputFiles.length > 0 && (
          <div className="lingxia-toolcard__section">
            <div className="lingxia-toolcard__label">产出文件</div>
            <div className="lingxia-toolcard__files">
              {tc.outputFiles.map((f) => {
                const sizeStr =
                  f.size > 1024 * 1024
                    ? `${(f.size / 1024 / 1024).toFixed(1)} MB`
                    : f.size > 1024
                    ? `${(f.size / 1024).toFixed(1)} KB`
                    : `${f.size} B`;

                const wsPath = (f as any).wsPath as string | undefined;
                const adoptId = tc.adoptId || "";

                const handleDownload = async (e: React.MouseEvent) => {
                  e.preventDefault();
                  try {
                    const path = wsPath ? wsPath : `sandbox-files/${f.name}`;
                    const resp = await fetch("/api/claw/files/token", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ adoptId, path }),
                    });
                    if (!resp.ok) {
                      const err = await resp.json().catch(() => ({}));
                      alert(`下载失败：${err.error || resp.status}`);
                      return;
                    }
                    const { url } = await resp.json();
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = f.name;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                  } catch (err) {
                    alert(`下载异常：${String(err)}`);
                  }
                };

                return (
                  <a key={f.name} href="#" onClick={handleDownload} className="lingxia-toolcard__file">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    <span>{f.name}</span>
                    <span style={{ opacity: 0.6 }}>({sizeStr})</span>
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatMessageInner({
  role,
  text,
  isLast,
  isPlaceholder,
  streaming,
  displayName,
  modelId,
  timeLabel,
  toolCalls,
  showToolCalls = true,
  usage,
  contextPercent,
  onDelete,
}: ChatMessageProps) {
  if (role === "user") {
    return (
      <div className="flex items-start gap-3 justify-end lingxia-msg-fade">
        <div className="lingxia-user-bubble">
          <div className="rounded-2xl rounded-tr-sm px-4 py-3 text-sm whitespace-pre-wrap lingxia-user-msg-text lingxia-bubble-user">
            {text}
          </div>
          <p className="text-[10px] mt-1 px-1 text-right" style={{ color: "#697086" }}>You · {timeLabel}</p>
        </div>
        <div
          className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center"
          style={{
            marginTop: 2,
            background: "linear-gradient(135deg, #be1e2d, #8b1520)",
            border: "1px solid rgba(190,30,45,0.5)",
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
          </svg>
        </div>
      </div>
    );
  }

  if (isPlaceholder) {
    return (
      <div className="flex items-start gap-3 lingxia-ai-bubble-wrap lingxia-msg-fade">
        <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center lingxia-avatar-ai" style={{ marginTop: 2 }}><BrandIcon size={22} /></div>
        <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm flex items-center gap-2 lingxia-bubble-ai" style={{ color: "#697086" }}>
          <span className="animate-pulse">●</span>
          <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>●</span>
          <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>●</span>
        </div>
      </div>
    );
  }

  const [copied, setCopied] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const onCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="flex items-start gap-3 lingxia-ai-bubble-wrap lingxia-msg-fade">
      <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center lingxia-avatar-ai" style={{ marginTop: 2 }}><BrandIcon size={22} /></div>
      <div>
        {showToolCalls && toolCalls && toolCalls.length > 0 && (
          <div className="mb-2">
            {toolCalls.map((tc) =>
              tc._gateway
                ? <GatewayToolInline key={tc.id} tc={tc} />
                : <ToolCallCard key={tc.id} tc={tc} />
            )}
          </div>
        )}
        <div className="relative group">
          <div
            className={`relative rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed lingxia-bubble-ai ${(isLast && streaming && text) ? "lingxia-token-active" : ""}`}
          >
            {/* 复制按钮 — 气泡右上角 */}
            {!streaming && text && (
              <div className="lingxia-msg-copy absolute top-2 right-2 z-10 flex items-center gap-0.5">
                <button
                  onClick={onCopyMarkdown}
                  type="button"
                  title="复制"
                  className="lingxia-msg-action-btn"
                  style={{ color: copied ? "#4ade80" : undefined }}
                >
                  {copied ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  )}
                </button>
              </div>
            )}
            <ChatMarkdown content={text} />
            {isLast && streaming && <span className="animate-pulse ml-0.5" style={{ color: "#697086" }}>▌</span>}
          </div>
        </div>
        {/* 时间戳行 + 朗读/删除 */}
        <p className="text-[10px] mt-1 px-1 font-mono flex items-center gap-1.5 flex-wrap" style={{ color: "#5f667b" }}>
          <span>
            {displayName} · {prettyModelName(modelId)} · {timeLabel}
            {usage && usage.input + usage.output > 0 && (
              <> · ↑{usage.input} ↓{usage.output}</>
            )}
            {contextPercent != null && (
              <> · {contextPercent}% ctx</>
            )}
          </span>
          {!streaming && text && (
            <>
              <button
                onClick={() => {
                  if (ttsPlaying) { ttsAudioRef.current?.pause(); setTtsPlaying(false); return; }
                  setTtsPlaying(true);
                  fetch("/api/claw/voice/tts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: text.slice(0, 2000) }),
                  })
                    .then(r => { if (!r.ok) throw new Error("TTS failed"); return r.blob(); })
                    .then(blob => {
                      const url = URL.createObjectURL(blob);
                      const audio = new Audio(url);
                      ttsAudioRef.current = audio;
                      audio.onended = () => { setTtsPlaying(false); URL.revokeObjectURL(url); };
                      audio.onerror = () => { setTtsPlaying(false); URL.revokeObjectURL(url); };
                      audio.play();
                    })
                    .catch(() => setTtsPlaying(false));
                }}
                type="button"
                title={ttsPlaying ? "停止朗读" : "朗读"}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", color: ttsPlaying ? "var(--oc-accent)" : "#5f667b", lineHeight: 1 }}
              >
                {ttsPlaying ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                )}
              </button>
              {onDelete && (
                <button
                  onClick={onDelete}
                  type="button"
                  title="删除此消息"
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", color: "#5f667b", lineHeight: 1 }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              )}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export const ChatMessage = memo(ChatMessageInner, (prev, next) => {
  return (
    prev.role === next.role &&
    prev.text === next.text &&
    prev.isLast === next.isLast &&
    prev.isPlaceholder === next.isPlaceholder &&
    prev.streaming === next.streaming &&
    prev.displayName === next.displayName &&
    prev.modelId === next.modelId &&
    prev.timeLabel === next.timeLabel &&
    prev.showToolCalls === next.showToolCalls &&
    prev.toolCalls?.length === next.toolCalls?.length &&
    prev.usage?.input === next.usage?.input &&
    prev.usage?.output === next.usage?.output &&
    prev.contextPercent === next.contextPercent
  );
});
