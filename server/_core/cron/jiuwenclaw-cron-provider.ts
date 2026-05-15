import { randomUUID } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { WebSocket, type RawData } from "ws";
import type {
  ChannelId,
  CronDeliveryConfig,
  CronJob,
  CronJobInput,
  CronProvider,
  CronProviderCapabilities,
  CronProviderHandle,
  CronResult,
  CronRunRecord,
  PreviewRunsRequest,
  PreviewRunsResponse,
} from "@shared/types/cron";
import { getCronDeliveryChannel } from "../cron-delivery";
import { jiuwenClawServiceId, resolveRuntimeWorkspaceByIds } from "../helpers";
import { computePreviewRuns } from "./openclaw-cron-provider";
import { normalizeChannelId } from "./channel-provider-registry";

const DEFAULT_AGENTSERVER_WS_URL = "ws://127.0.0.1:18092";
const APP_ROOT = process.env.APP_ROOT || process.cwd();
const META_PATH = path.join(APP_ROOT, "data", "jiuwen-cron-meta.json");

const JIUWEN_CRON_CAPABILITIES: CronProviderCapabilities = {
  scheduleKinds: ["interval"],
  promptRequired: true,
  supportsTimezone: false,
  supportsWakeOffset: false,
  // Preview is Lingxia-computed. JiuwenClaw native schedule only accepts
  // interval_hours, so creation is validated more strictly than preview.
  supportsPreview: true,
  supportsRunNow: false,
  supportedChannels: ["wechat", "feishu"],
};

type JiuwenTask = {
  task_id?: string;
  query?: string;
  status?: string;
  interval_hours?: number;
  next_run_time?: string;
  created_at?: string;
  is_one_time?: boolean;
  current_execution_id?: string | null;
  execution_history?: any[];
};

type JiuwenCronMeta = {
  jobs?: Array<{
    adoptId: string;
    taskId: string;
    name?: string;
    description?: string;
    channelId?: ChannelId;
    createdBy?: number;
    updatedAt?: string;
  }>;
};

function ok<T>(value: T): CronResult<T> {
  return { ok: true, value };
}

function validationFailed<T>(detail: string): CronResult<T> {
  return { ok: false, error: { kind: "validation_failed", detail } };
}

function runtimeUnavailable<T>(detail: string): CronResult<T> {
  return { ok: false, error: { kind: "runtime_unavailable", detail } };
}

function notFound<T>(detail: string): CronResult<T> {
  return { ok: false, error: { kind: "not_found", detail } };
}

function notImplemented<T>(detail: string): CronResult<T> {
  return { ok: false, error: { kind: "not_implemented", detail } };
}

function ensureDataDir() {
  mkdirSync(path.dirname(META_PATH), { recursive: true });
}

function readMeta(): JiuwenCronMeta {
  try {
    if (existsSync(META_PATH)) return JSON.parse(readFileSync(META_PATH, "utf-8"));
  } catch {}
  return { jobs: [] };
}

function writeMeta(meta: JiuwenCronMeta) {
  ensureDataDir();
  writeFileSync(META_PATH, JSON.stringify({ jobs: meta.jobs || [] }, null, 2), "utf-8");
}

function getMeta(adoptId: string, taskId: string) {
  return (readMeta().jobs || []).find((job) => job.adoptId === adoptId && job.taskId === taskId);
}

function upsertMeta(handle: CronProviderHandle, taskId: string, input: CronJobInput) {
  const meta = readMeta();
  const jobs = meta.jobs || [];
  const existing = jobs.find((job) => job.adoptId === handle.adoptId && job.taskId === taskId);
  const target = input.delivery.targets[0];
  const channelId = normalizeChannelId(String(target?.channelId || "")) || undefined;
  const next = {
    adoptId: handle.adoptId,
    taskId,
    name: input.name,
    description: input.description,
    channelId,
    createdBy: handle.userId,
    updatedAt: new Date().toISOString(),
  };
  if (existing) Object.assign(existing, next);
  else jobs.push(next);
  writeMeta({ jobs });
}

function removeMeta(adoptId: string, taskId: string) {
  const meta = readMeta();
  const jobs = (meta.jobs || []).filter((job) => !(job.adoptId === adoptId && job.taskId === taskId));
  writeMeta({ jobs });
}

function parseJsonFrame(raw: RawData): any | null {
  try {
    const text = Array.isArray(raw)
      ? Buffer.concat(raw).toString("utf8")
      : Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : String(raw);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function wsOriginFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const protocol = url.protocol === "wss:" ? "https:" : "http:";
    return `${protocol}//${url.host}`;
  } catch {
    return "http://127.0.0.1";
  }
}

function buildScheduleRequest(handle: CronProviderHandle, method: string, params: Record<string, any>) {
  const requestId = `linggan-jiuwen-cron-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const serviceId = jiuwenClawServiceId();
  const agentId = handle.agentId || `jiuwen_${handle.adoptId}`;
  const sessionId = `cron_${handle.adoptId}`;
  const workspaceDir = resolveRuntimeWorkspaceByIds(handle.adoptId, agentId);
  return {
    requestId,
    payload: {
      protocol_version: "1.0",
      request_id: requestId,
      timestamp: new Date().toISOString(),
      identity_origin: "user",
      channel: "web",
      channel_context: {
        effective_project_dir: workspaceDir,
        cwd: workspaceDir,
        source_channel: "web",
      },
      method,
      is_stream: false,
      service_id: serviceId,
      agent_id: agentId,
      session_id: sessionId,
      params: {
        service_id: serviceId,
        agent_id: agentId,
        session_id: sessionId,
        project_dir: workspaceDir,
        ...params,
      },
    },
  };
}

function unwrapJiuwenResult(frame: any): any {
  if (frame?.status === "failed" || frame?.response_kind === "e2a.error") {
    const body = frame?.body || {};
    const detail = body?.message || body?.details?.error || body?.error || "JiuwenClaw schedule request failed";
    throw new Error(String(detail));
  }
  if (frame?.body?.result !== undefined) return frame.body.result;
  if (frame?.payload !== undefined) return frame.payload;
  return frame?.body || frame;
}

async function callJiuwenSchedule<T = any>(
  handle: CronProviderHandle,
  method: string,
  params: Record<string, any> = {},
  timeoutMs = 20_000,
): Promise<T> {
  const wsUrl = String(process.env.JIUWENCLAW_AGENTSERVER_WS_URL || DEFAULT_AGENTSERVER_WS_URL);
  const { requestId, payload } = buildScheduleRequest(handle, method, params);

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    let sent = false;
    let ackTimer: NodeJS.Timeout | null = null;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (ackTimer) clearTimeout(ackTimer);
      clearTimeout(timeout);
      try { ws.close(1000); } catch {}
      fn();
    };
    const sendRequest = () => {
      if (sent || ws.readyState !== WebSocket.OPEN) return;
      sent = true;
      ws.send(JSON.stringify(payload));
    };

    const ws = new WebSocket(wsUrl, {
      headers: {
        Origin: process.env.JIUWENCLAW_WS_ORIGIN || wsOriginFromUrl(wsUrl),
      },
    });
    const timeout = setTimeout(() => {
      finish(() => reject(new Error(`JiuwenClaw schedule request timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    ws.on("open", () => {
      ackTimer = setTimeout(sendRequest, 1500);
    });
    ws.on("message", (raw) => {
      const frame = parseJsonFrame(raw);
      if (!frame) return;
      if (frame?.event === "connection.ack") {
        sendRequest();
        return;
      }
      const frameRequestId = String(frame?.request_id || frame?.response_id || "");
      if (frameRequestId && frameRequestId !== requestId) return;
      if (!frameRequestId && String(frame?.event || "") === "connection.ack") return;
      try {
        const value = unwrapJiuwenResult(frame);
        finish(() => resolve(value as T));
      } catch (error: any) {
        finish(() => reject(error));
      }
    });
    ws.on("error", (error) => {
      finish(() => reject(error));
    });
    ws.on("close", () => {
      if (!settled) finish(() => reject(new Error("JiuwenClaw schedule websocket closed before response")));
    });
  });
}

function channelLabel(channelId: ChannelId) {
  if (channelId === "wechat") return "微信";
  if (channelId === "feishu") return "飞书";
  return "企业微信";
}

function deliveryConfigFromMeta(handle: CronProviderHandle, taskId: string): CronDeliveryConfig {
  const configured = normalizeChannelId(getCronDeliveryChannel(handle.adoptId, taskId) || "");
  const local = getMeta(handle.adoptId, taskId)?.channelId;
  const channelId = configured || local || "wechat";
  return {
    targets: [{
      channelId,
      channelLabel: channelLabel(channelId),
    }],
  };
}

function parseDateIso(raw: unknown, fallback = new Date(0).toISOString()) {
  const date = new Date(String(raw || ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function taskStatus(raw: JiuwenTask): CronJob["state"]["status"] {
  const status = String(raw.status || "").toLowerCase();
  if (status === "running") return "running";
  if (status === "completed" || status === "success") return "completed";
  if (status === "failed" || status === "error") return "failed";
  if (status === "cancelled" || status === "canceled") return "paused";
  return "scheduled";
}

function lastExecution(raw: JiuwenTask): any | undefined {
  const history = Array.isArray(raw.execution_history) ? raw.execution_history : [];
  return history[history.length - 1];
}

function executionStatus(raw: any): CronRunRecord["status"] {
  const status = String(raw?.status || "").toLowerCase();
  if (status === "success" || status === "ok") return "ok";
  if (status === "cancelled" || status === "canceled") return "canceled";
  if (["running", "error", "skipped", "timeout"].includes(status)) return status as CronRunRecord["status"];
  return status === "failed" ? "error" : "ok";
}

function jiuwenTaskToCronJob(raw: JiuwenTask, handle: CronProviderHandle): CronJob {
  const id = String(raw.task_id || "");
  const intervalHours = Math.max(1, Number(raw.interval_hours || 1));
  const meta = getMeta(handle.adoptId, id);
  const createdAt = parseDateIso(raw.created_at);
  const updatedAt = meta?.updatedAt || createdAt;
  const last = lastExecution(raw);
  const totalRuns = Array.isArray(raw.execution_history) ? raw.execution_history.length : 0;
  const successRuns = Array.isArray(raw.execution_history)
    ? raw.execution_history.filter((item) => executionStatus(item) === "ok").length
    : 0;
  return {
    id,
    runtime: "jiuwenclaw",
    adoptId: handle.adoptId,
    userId: handle.userId,
    name: meta?.name || String(raw.query || id || "JiuwenClaw 定时任务").slice(0, 40),
    enabled: !["cancelled", "canceled", "completed"].includes(String(raw.status || "").toLowerCase()),
    prompt: raw.query ? String(raw.query) : undefined,
    description: meta?.description,
    schedule: raw.is_one_time
      ? { kind: "once", runAt: parseDateIso(raw.next_run_time), display: parseDateIso(raw.next_run_time) }
      : { kind: "interval", intervalMinutes: intervalHours * 60, display: `每 ${intervalHours} 小时` },
    state: {
      status: taskStatus(raw),
      nextRunAt: raw.next_run_time ? parseDateIso(raw.next_run_time) : undefined,
      lastRunAt: last?.started_at ? parseDateIso(last.started_at) : undefined,
      lastStatus: last ? executionStatus(last) === "ok" ? "ok" : executionStatus(last) === "canceled" ? "canceled" : "error" : undefined,
      totalRuns,
      successRuns,
    },
    delivery: deliveryConfigFromMeta(handle, id),
    meta: {
      currentExecutionId: raw.current_execution_id || undefined,
      runNowSupported: false,
      updateSupported: false,
      deliveryManagedBy: "jiuwenclaw-native",
      nativeStatus: raw.status,
    },
    createdBy: meta?.createdBy || handle.userId,
    createdAt,
    updatedBy: handle.userId,
    updatedAt,
  };
}

function rawTasks(response: any): JiuwenTask[] {
  if (Array.isArray(response?.tasks)) return response.tasks;
  if (Array.isArray(response)) return response;
  return [];
}

function jiuwenExecutionToRunRecord(raw: any, jobId: string): CronRunRecord {
  const startedAt = parseDateIso(raw?.started_at, new Date().toISOString());
  const finishedAt = raw?.completed_at ? parseDateIso(raw.completed_at) : undefined;
  const startedMs = Date.parse(startedAt);
  const finishedMs = finishedAt ? Date.parse(finishedAt) : NaN;
  return {
    id: String(raw?.execution_id || `${jobId}:${startedAt}`),
    jobId,
    startedAt,
    finishedAt,
    durationMs: Number.isFinite(startedMs) && Number.isFinite(finishedMs) ? Math.max(0, finishedMs - startedMs) : undefined,
    status: executionStatus(raw),
    errorMessage: raw?.error ? String(raw.error) : undefined,
    triggeredBy: "schedule",
  };
}

export class JiuwenClawCronProvider implements CronProvider {
  readonly runtime = "jiuwenclaw";

  capabilities(): CronProviderCapabilities {
    return JIUWEN_CRON_CAPABILITIES;
  }

  async listJobs(handle: CronProviderHandle): Promise<CronResult<CronJob[]>> {
    try {
      const response = await callJiuwenSchedule(handle, "schedule.list");
      return ok(rawTasks(response).map((task) => jiuwenTaskToCronJob(task, handle)));
    } catch (error: any) {
      return runtimeUnavailable(`schedule.list failed: ${error?.message || error}`);
    }
  }

  async addJob(handle: CronProviderHandle, input: CronJobInput): Promise<CronResult<CronJob>> {
    if (input.schedule.kind !== "interval") {
      return validationFailed("JiuwenClaw 当前仅支持按小时的间隔定时任务");
    }
    if (!input.prompt?.trim()) return validationFailed("prompt is required for JiuwenClaw cron jobs");
    if (input.enabled === false) return validationFailed("JiuwenClaw 暂不支持创建停用状态的定时任务");

    const intervalMinutes = Number(input.schedule.intervalMinutes || 0);
    if (intervalMinutes < 60 || intervalMinutes % 60 !== 0) {
      return validationFailed("JiuwenClaw 当前定时任务间隔必须是 60 分钟的整数倍");
    }

    const target = input.delivery.targets[0];
    if (!target) return validationFailed("delivery target is required");
    if (!JIUWEN_CRON_CAPABILITIES.supportedChannels.includes(target.channelId)) {
      return validationFailed(`JiuwenClaw cron does not support channel ${target.channelId}`);
    }

    try {
      const response = await callJiuwenSchedule(handle, "schedule.create", {
        interval_hours: Math.max(1, Math.round(intervalMinutes / 60)),
        query: input.prompt.trim(),
        run_immediately: false,
        ...(input.meta?.model ? { model_name: input.meta.model } : {}),
      });
      if (response?.error) return runtimeUnavailable(`schedule.create failed: ${String(response.error)}`);

      const taskId = String(response?.task_id || "");
      if (!taskId) return runtimeUnavailable("schedule.create did not return task_id");
      upsertMeta(handle, taskId, input);

      const status = await callJiuwenSchedule(handle, "schedule.status", { task_id: taskId }).catch(() => null);
      return ok(jiuwenTaskToCronJob(status?.task_id ? status : {
        task_id: taskId,
        query: input.prompt.trim(),
        status: "pending",
        interval_hours: Math.max(1, Math.round(intervalMinutes / 60)),
        next_run_time: response?.next_run_time,
        created_at: new Date().toISOString(),
        execution_history: [],
      }, handle));
    } catch (error: any) {
      return runtimeUnavailable(`schedule.create failed: ${error?.message || error}`);
    }
  }

  async updateJob(handle: CronProviderHandle, id: string, patch: Partial<CronJobInput>): Promise<CronResult<CronJob>> {
    const unsupported = patch.enabled !== undefined || patch.schedule !== undefined || patch.prompt !== undefined;
    if (unsupported) {
      return notImplemented("JiuwenClaw 原生 schedule 暂不支持编辑启停、计划和任务内容；请删除后重建");
    }
    const current = await this.listJobs(handle);
    if (!current.ok) return current as CronResult<CronJob>;
    const found = current.value.find((job) => job.id === id);
    if (!found) return notFound("JiuwenClaw cron job not found");
    upsertMeta(handle, id, {
      name: patch.name || found.name,
      description: patch.description ?? found.description,
      enabled: found.enabled,
      schedule: found.schedule,
      prompt: found.prompt,
      delivery: patch.delivery || found.delivery,
      meta: found.meta,
    });
    const refreshed = await this.listJobs(handle);
    if (!refreshed.ok) return refreshed as CronResult<CronJob>;
    const updated = refreshed.value.find((job) => job.id === id);
    return updated ? ok(updated) : notFound("JiuwenClaw cron job not found");
  }

  async removeJob(handle: CronProviderHandle, id: string): Promise<CronResult<void>> {
    try {
      const response = await callJiuwenSchedule(handle, "schedule.delete", { task_id: id });
      if (response?.error) return notFound(String(response.error));
      removeMeta(handle.adoptId, id);
      return ok(undefined);
    } catch (error: any) {
      return runtimeUnavailable(`schedule.delete failed: ${error?.message || error}`);
    }
  }

  async runJobNow(_handle: CronProviderHandle, _id: string): Promise<CronResult<{ runId: string }>> {
    return notImplemented("JiuwenClaw 原生 schedule 暂不支持对已有周期任务立即执行");
  }

  async listRuns(handle: CronProviderHandle, id: string, limit: number): Promise<CronResult<CronRunRecord[]>> {
    try {
      const response = await callJiuwenSchedule<JiuwenTask>(handle, "schedule.status", { task_id: id });
      if ((response as any)?.error) return notFound(String((response as any).error));
      const history = Array.isArray(response?.execution_history) ? response.execution_history : [];
      return ok(history.slice(-Math.max(1, limit)).reverse().map((run) => jiuwenExecutionToRunRecord(run, id)));
    } catch (error: any) {
      return runtimeUnavailable(`schedule.status failed: ${error?.message || error}`);
    }
  }

  async previewRuns(request: PreviewRunsRequest): Promise<CronResult<PreviewRunsResponse>> {
    if (request.schedule.kind !== "interval") {
      return validationFailed("JiuwenClaw 当前仅支持按小时的间隔定时任务");
    }
    const intervalMinutes = Number(request.schedule.intervalMinutes || 0);
    if (intervalMinutes < 60 || intervalMinutes % 60 !== 0) {
      return validationFailed("JiuwenClaw 当前定时任务间隔必须是 60 分钟的整数倍");
    }
    try {
      return ok(computePreviewRuns(request));
    } catch (error: any) {
      return validationFailed(`preview failed: ${error?.message || error}`);
    }
  }
}
