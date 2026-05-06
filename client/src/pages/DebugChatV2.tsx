import { useState } from "react";
import { useRoute } from "wouter";
import { useLingxiaChat } from "@/hooks/useLingxiaChat";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function DebugChatV2() {
  const [, params] = useRoute("/debug/chat-v2/:adoptId");
  const adoptId = params?.adoptId ?? "";
  const [input, setInput] = useState("");
  const chat = useLingxiaChat({ adoptId, isHermesRuntime: adoptId.startsWith("lgh-") });

  const send = async () => {
    const text = input.trim();
    if (!text || chat.isStreaming) return;
    setInput("");
    await chat.send(text);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-950">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Internal Debug</p>
          <h1 className="text-2xl font-semibold">ChatEvent Transport V2</h1>
          <p className="mt-1 text-sm text-slate-600">
            This page mounts useLingxiaChat without touching the production Home.tsx chat path.
          </p>
        </div>

        <Card className="p-4">
          <div className="grid gap-2 text-sm md:grid-cols-4">
            <div><span className="text-slate-500">adoptId:</span> {adoptId || "-"}</div>
            <div><span className="text-slate-500">streaming:</span> {String(chat.isStreaming)}</div>
            <div><span className="text-slate-500">conn:</span> {chat.connStatus}</div>
            <div><span className="text-slate-500">messages:</span> {chat.messages.length}</div>
          </div>
        </Card>

        <Card className="min-h-[420px] p-4">
          <div className="flex flex-col gap-3">
            {chat.messages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                Send a message to test the new ChatEvent transport pipeline.
              </div>
            ) : chat.messages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded-2xl p-3 text-sm ${msg.role === "user" ? "ml-auto max-w-[78%] bg-slate-900 text-white" : "mr-auto max-w-[86%] bg-white shadow-sm"}`}
              >
                <div className="mb-1 flex items-center gap-2 text-[11px] opacity-60">
                  <span>{msg.role}</span>
                  <span>{msg.timeLabel}</span>
                  {msg.status && <span>status: {msg.status}</span>}
                  {msg.recovering && <span>recovering</span>}
                  {msg.recovered && <span>recovered</span>}
                  {msg.recoveryFailed && <span>recovery failed</span>}
                </div>
                <pre className="whitespace-pre-wrap break-words font-sans">{msg.text || "..."}</pre>
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mt-2 rounded-lg bg-slate-100 p-2 text-xs text-slate-700">
                    {msg.toolCalls.map((tool) => (
                      <div key={tool.id}>
                        {tool.name} / {tool.status}
                        {tool.durationMs != null ? ` / ${tool.durationMs}ms` : ""}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="Type a debug message..."
            disabled={chat.isStreaming}
          />
          <Button onClick={() => void send()} disabled={chat.isStreaming || !input.trim()}>
            Send
          </Button>
          <Button variant="outline" onClick={() => chat.abort("debug_abort")} disabled={!chat.isStreaming}>
            Abort
          </Button>
        </div>
      </div>
    </div>
  );
}

