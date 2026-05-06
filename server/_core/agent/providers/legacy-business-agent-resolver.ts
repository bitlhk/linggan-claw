import type { AgentDefinition, AgentProvider, AgentResult } from "../../../../shared/types/agent";
import { SecretHandle } from "../../../../shared/lib/secret-handle";
import type { ProviderResolvedBinding } from "./types";
import { getBusinessAgent } from "../../../db/agents";
import { resolveLegacyBusinessAgentSystemPrompt } from "./legacy-agent-prompts";

type LegacyBusinessAgentRow = {
  id: string;
  kind?: string | null;
  apiUrl?: string | null;
  apiToken?: string | null;
  remoteAgentId?: string | null;
  localAgentId?: string | null;
  enabled?: number | boolean | null;
  healthStatus?: string | null;
  allowedProfiles?: string | null;
  expiresAt?: Date | string | null;
  maxDailyRequests?: number | null;
  tags?: string | null;
  systemPrompt?: string | null;
};

type LegacyBusinessAgentLookup = (id: string) => Promise<LegacyBusinessAgentRow | undefined | null>;

function validationFailed(detail: string): AgentResult<ProviderResolvedBinding> {
  return { ok: false, error: { kind: "validation_failed", detail } };
}

function notFound(detail: string): AgentResult<ProviderResolvedBinding> {
  return { ok: false, error: { kind: "not_found", detail } };
}

function isEnabled(row: LegacyBusinessAgentRow): boolean {
  return row.enabled === true || row.enabled === 1;
}

function cleanMetadata(row: LegacyBusinessAgentRow, provider: AgentProvider): Record<string, unknown> {
  const transportKind = inferTransportKind(row.apiUrl || "");
  return {
    businessAgentId: row.id,
    legacyKind: row.kind || null,
    providerKey: provider.providerKey,
    healthStatus: row.healthStatus || null,
    allowedProfiles: row.allowedProfiles || null,
    expiresAt: row.expiresAt ? String(row.expiresAt) : null,
    maxDailyRequests: row.maxDailyRequests ?? null,
    tags: row.tags || null,
    adapterProtocol: inferAdapterProtocol(row, provider),
    transportKind,
  };
}

function inferTransportKind(apiUrl: string): "direct" | "ssh-reverse-tunnel" {
  try {
    const url = new URL(apiUrl);
    if ((url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.port === "8642") {
      return "ssh-reverse-tunnel";
    }
  } catch {}
  return "direct";
}

function inferAdapterProtocol(row: LegacyBusinessAgentRow, provider: AgentProvider): string {
  if (row.id === "task-stock") return "stock-analysis-v1-agent-stream";
  if (provider.runtimeFamily === "claude-code") return "openai-chat-completions";
  if (provider.runtimeFamily !== "hermes") return "http-json";
  try {
    const url = new URL(row.apiUrl || "");
    if ((url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.port === "8642") {
      return "hermes-v1-runs";
    }
  } catch {}
  return "http-json";
}

export class LegacyBusinessAgentResolver {
  constructor(private readonly lookup: LegacyBusinessAgentLookup = getBusinessAgent) {}

  async resolve(definition: AgentDefinition, provider: AgentProvider): Promise<AgentResult<ProviderResolvedBinding>> {
    const row = await this.lookup(definition.id);
    if (!row) return notFound(`legacy business agent not found: ${definition.id}`);
    if (!isEnabled(row)) return notFound(`legacy business agent is disabled: ${definition.id}`);
    if (!row.apiUrl) return validationFailed(`legacy business agent endpoint is missing: ${definition.id}`);

    return {
      ok: true,
      value: {
        endpoint: row.apiUrl,
        auth: SecretHandle.of(row.apiToken),
        remoteAgentId: row.remoteAgentId || null,
        localAgentId: row.localAgentId || definition.profileRef || null,
        systemPrompt: resolveLegacyBusinessAgentSystemPrompt(row.id, row.systemPrompt),
        healthStatus: row.healthStatus || null,
        transport: { kind: inferTransportKind(row.apiUrl) },
        metadata: cleanMetadata(row, provider),
      },
    };
  }
}
