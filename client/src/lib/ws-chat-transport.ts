import type { ChatEvent } from "@shared/runtime/chat-event";
import { OpenClawWSClient, type WSState } from "./openclaw-ws";
import { parseWirePayloadToChatEvents } from "./chat-event-parser";
import type {
  ChatEventHandler,
  ChatSendPayload,
  ChatTransport,
  ChatTransportContext,
  ChatTransportSnapshot,
  ChatTransportState,
} from "./chat-transport";
import { ChatTransportError } from "./chat-transport";

function mapWsState(state: WSState): ChatTransportState {
  if (state === "idle") return "idle";
  if (state === "connecting") return "connecting";
  if (state === "connected") return "connected";
  return "closed";
}

export class WsChatTransport implements ChatTransport {
  readonly kind = "ws" as const;
  private client: OpenClawWSClient | null = null;
  private readonly apiBase: string;
  private readonly handlers = new Set<ChatEventHandler>();
  private state: ChatTransportState = "idle";
  private lastEventAt: number | undefined;
  private error: string | undefined;
  private context: ChatTransportContext = {};

  constructor(apiBase = "") {
    this.apiBase = apiBase;
  }

  getSnapshot(): ChatTransportSnapshot {
    return {
      kind: this.kind,
      state: this.state,
      context: this.context,
      lastEventAt: this.lastEventAt,
      error: this.error,
    };
  }

  subscribe(handler: ChatEventHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async send(payload: ChatSendPayload, _signal?: AbortSignal): Promise<void> {
    this.context = { ...this.context, adoptId: payload.adoptId };
    const client = await this.ensureClient(payload.adoptId);
    this.state = "streaming";
    const sent = client.sendChat(payload.message, undefined, {
      clientRunId: payload.clientRunId,
      userMessageId: payload.userMessageId,
    });
    if (!sent) {
      throw new ChatTransportError(this.kind, "WebSocket chat send failed");
    }
  }

  close(reason?: string): void {
    this.client?.setRawHandler(null);
    this.client?.disconnect();
    this.client = null;
    this.state = "closed";
    this.emit({ type: "transport.disconnected", transport: "ws", reason });
  }

  private async ensureClient(adoptId: string): Promise<OpenClawWSClient> {
    if (!this.client || this.context.adoptId !== adoptId) {
      this.client?.disconnect();
      this.client = new OpenClawWSClient(adoptId, this.apiBase);
      this.client.setHandlers(
        (delta) => {
          if (delta.error) this.emit({ type: "transport.error", transport: "ws", message: delta.error });
        },
        (state) => {
          this.state = mapWsState(state);
          if (state === "connected") this.emit({ type: "transport.connected", transport: "ws", adoptId } as ChatEvent);
        },
      );
      this.client.setRawHandler((payload) => this.emitMany(parseWirePayloadToChatEvents(payload)));
    }

    if (this.client.state !== "connected") {
      this.state = "connecting";
      const ok = await this.client.connect();
      if (!ok) {
        this.error = "WebSocket connect failed";
        this.state = "error";
        throw new ChatTransportError(this.kind, this.error);
      }
    }

    return this.client;
  }

  private emitMany(events: ChatEvent[]) {
    for (const event of events) this.emit(event);
  }

  private emit(event: ChatEvent) {
    this.lastEventAt = Date.now();
    for (const handler of this.handlers) handler(event);
  }
}
