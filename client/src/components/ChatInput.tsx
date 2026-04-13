import { useRef, useState, useCallback, type KeyboardEvent } from "react";

type ChatInputProps = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop?: () => void;
  onNewChat?: () => void;
  disabled?: boolean;
  streaming?: boolean;
  placeholder?: string;
  maxLength?: number;
  messages?: Array<{ role: string; text: string; timeLabel: string }>;
};

export function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  onNewChat,
  disabled = false,
  streaming = false,
  placeholder = "Message…",
  maxLength = 4000,
  messages = [],
}: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachments, setAttachments] = useState<File[]>([]);

  // ── 语音录制状态 ──
  const [recording, setRecording] = useState(false);


  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (streaming) onStop?.();
      else onSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) setAttachments(prev => [...prev, ...files]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const exportMarkdown = () => {
    if (!messages.length) { alert("暂无对话内容"); return; }
    const content = messages.map(m =>
      `## ${m.role === "user" ? "**用户**" : "**助手**"}\n\n${m.text}\n\n---\n`
    ).join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conversation-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── 语音录制 ──
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        if (audioBlob.size < 100) return; // too short

        setTranscribing(true);
        try {
          const res = await fetch("/api/claw/voice/transcribe", {
            method: "POST",
            headers: { "Content-Type": mimeType },
            body: audioBlob,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert("语音识别失败：" + (err.error || res.status));
            return;
          }
          const data = await res.json();
          if (data.text) {
            onChange(value + (value && !value.endsWith(" ") && !value.endsWith("\n") ? " " : "") + data.text);
            textareaRef.current?.focus();
          }
        } catch (err) {
          alert("语音识别出错：" + String(err));
        } finally {
          setTranscribing(false);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        alert("请允许麦克风权限");
      } else {
        alert("无法启动录音：" + err.message);
      }
    }
  }, [value, onChange]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }, []);

  const toggleRecording = () => {
    if (recording) stopRecording();
    else startRecording();
  };

  return (
    <div className="flex-none mb-4 mt-0" style={{ position: "relative", paddingLeft: 40, paddingRight: 40 }}>
      {/* 附件预览 */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {attachments.map((file, i) => (
            <div key={i} className="lingxia-attachment-chip flex items-center gap-1 px-2 py-1 rounded-md text-xs">
              <span className="max-w-[120px] truncate">{file.name}</span>
              <button onClick={() => removeAttachment(i)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: "0 2px", lineHeight: 1, opacity: 0.7 }}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* 主输入卡片 */}
      <div
        className={`lingxia-input-wrap ${streaming ? "is-streaming" : ""}`}
        style={{
          background: "var(--oc-card)",
          border: recording ? "1px solid var(--oc-accent)" : "1px solid var(--oc-border)",
          borderRadius: 14,
          boxShadow: recording
            ? "0 0 0 2px rgba(255,92,92,0.2), 0 2px 16px rgba(0,0,0,0.14)"
            : "0 2px 16px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.08)",
          overflow: "hidden",
          transition: "border-color 0.2s, box-shadow 0.2s",
        }}
      >
        {/* 上：文字输入区 */}
        <div className="px-4 pt-3 pb-1">
          {recording ? (
            <div className="flex items-center gap-2" style={{ minHeight: 22, color: "var(--oc-accent)" }}>
              <span className="animate-pulse" style={{ fontSize: 14 }}>●</span>
              <span className="text-sm">正在录音… 点击麦克风停止</span>
            </div>
          ) : transcribing ? (
            <div className="flex items-center gap-2" style={{ minHeight: 22, color: "var(--oc-text-secondary)" }}>
              <span className="animate-spin" style={{ fontSize: "var(--oc-text-sm)" }}>◌</span>
              <span className="text-sm">识别中…</span>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                onChange(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 144) + "px";
              }}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              rows={1}
              className="w-full bg-transparent text-sm resize-none focus:outline-none"
              style={{
                color: "var(--oc-text-primary)",
                lineHeight: "22px",
                minHeight: 22,
                maxHeight: 144,
                overflowY: "hidden",
                display: "block",
              }}
            />
          )}
        </div>

        {/* 下：图标工具栏 */}
        <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
          <div className="flex items-center gap-1">
            <input ref={fileInputRef} type="file" multiple
              accept="image/*,.pdf,.txt,.md,.csv,.json,.docx,.xlsx"
              onChange={handleFileSelect} style={{ display: "none" }} />
            <button onClick={() => fileInputRef.current?.click()} title="上传文件" className="lingxia-toolbar-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            <button
              onClick={toggleRecording}
              title={recording ? "停止录音" : "语音输入"}
              className={`lingxia-toolbar-icon ${recording ? "is-active" : ""}`}
              style={recording ? { color: "var(--oc-accent)" } : undefined}
              disabled={transcribing}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button onClick={onNewChat} title="新对话" className="lingxia-toolbar-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
            <button onClick={exportMarkdown} title="导出 Markdown" className="lingxia-toolbar-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
            <button
              onClick={streaming ? (() => onStop?.()) : onSend}
              disabled={streaming ? false : (disabled || !value.trim())}
              title={streaming ? "停止生成" : "发送"}
              className="lingxia-send-btn"
              style={{
                background: (streaming || value.trim()) ? "var(--oc-accent)" : "rgba(128,128,128,0.2)",
              }}
            >
              {streaming ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                  <rect x="6" y="6" width="12" height="12" rx="2"/>
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 底部提示 */}
      <div className="mt-1.5 flex items-center justify-between px-1">
        <p className="text-[10px]" style={{ color: "var(--oc-text-secondary)", opacity: 0.7 }}>
          Enter 发送 · Shift+Enter 换行
        </p>
        <p className="text-[10px] font-mono" style={{ color: "var(--oc-text-secondary)", opacity: 0.5 }}>
          {value.length} / {maxLength}
        </p>
      </div>
    </div>
  );
}
