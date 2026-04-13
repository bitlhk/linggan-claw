import express from "express";
import { sendNotification } from "./claw-notify";
import { sendWeixinMessage } from "./claw-weixin";
import {
  requireClawOwner,
  resolveRuntimeAgentId,
  callClawGatewayRpc,
} from "./helpers";

export function registerCronRoutes(app: express.Express) {
  app.get("/api/claw/cron/status", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const runtimeAgentId = resolveRuntimeAgentId(adoptId, (claw as any).agentId);
      const list = callClawGatewayRpc("cron.list", { includeDisabled: true });
      const jobs = Array.isArray((list as any)?.jobs) ? (list as any).jobs.filter((j: any) => String(j?.agentId || "") === runtimeAgentId) : [];
      const enabledJobs = jobs.filter((j: any) => j?.enabled !== false);
      const nextWakeAtMs = enabledJobs.map((j: any) => Number(j?.state?.nextRunAtMs || 0)).filter((n: number) => Number.isFinite(n) && n > 0).sort((a: number, b: number) => a-b)[0];
      return res.json({ enabled: true, jobs: jobs.length, enabledJobs: enabledJobs.length, nextWakeAtMs: nextWakeAtMs || undefined });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e || "cron status failed") });
    }
  });

  app.get("/api/claw/cron/list", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const IK = process.env.INTERNAL_API_KEY || "lingxia-bridge-2026";
      let claw: any;
      if (req.headers["x-internal-key"] === IK) {
        const { getClawByAdoptId } = await import("../db");
        claw = await getClawByAdoptId(adoptId);
        if (!claw) return res.status(404).json({ error: "NOT_FOUND" });
      } else {
        claw = await requireClawOwner(req, res, adoptId);
        if (!claw) return;
      }
      const runtimeAgentId = resolveRuntimeAgentId(adoptId, (claw as any).agentId);
      const limit = Math.max(1, Math.min(200, Number(req.query.limit || 20)));
      const offset = Math.max(0, Number(req.query.offset || 0));
      const query = String(req.query.query || "").trim().toLowerCase();
      const enabled = String(req.query.enabled || "all");
      const scheduleKind = String(req.query.scheduleKind || "all");
      const list = callClawGatewayRpc("cron.list", { includeDisabled: true });
      let jobs = Array.isArray((list as any)?.jobs) ? (list as any).jobs.filter((j: any) => String(j?.agentId || "") === runtimeAgentId) : [];
      if (query) jobs = jobs.filter((j: any) => String(j?.name || "").toLowerCase().includes(query) || String(j?.description || "").toLowerCase().includes(query));
      if (enabled === "enabled") jobs = jobs.filter((j: any) => j?.enabled !== false);
      if (enabled === "disabled") jobs = jobs.filter((j: any) => j?.enabled === false);
      if (["every","at","cron"].includes(scheduleKind)) jobs = jobs.filter((j: any) => String(j?.schedule?.kind || "") === scheduleKind);
      const total = jobs.length;
      const rows = jobs.slice(offset, offset + limit);
      return res.json({ jobs: rows, total, limit, offset });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e || "cron list failed") });
    }
  });

  app.get("/api/claw/cron/runs", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const runtimeAgentId = resolveRuntimeAgentId(adoptId, (claw as any).agentId);
      const limit = Math.max(1, Math.min(200, Number(req.query.limit || 20)));
      const offset = Math.max(0, Number(req.query.offset || 0));
      const jobId = String(req.query.jobId || "").trim();
      const scope = String(req.query.scope || "all").trim();
      const list = callClawGatewayRpc("cron.list", { includeDisabled: true });
      const jobs = Array.isArray((list as any)?.jobs) ? (list as any).jobs.filter((j: any) => String(j?.agentId || "") === runtimeAgentId) : [];
      const targetJobs = jobId ? jobs.filter((j: any) => String(j?.id) === jobId) : jobs;
      let runs: any[] = [];
      for (const j of targetJobs.slice(0, 50)) {
        try {
          const rr = callClawGatewayRpc("cron.runs", { id: String(j.id), limit: 100 });
          const rows = Array.isArray((rr as any)?.runs) ? (rr as any).runs : [];
          for (const r of rows) runs.push({ ...r, jobId: r?.jobId || j.id, jobName: r?.jobName || j.name });
        } catch {}
      }
      if (["ok","error","skipped"].includes(scope)) runs = runs.filter((r: any) => String(r?.status || "") === scope);
      runs.sort((a: any, b: any) => Number(b?.ts || 0) - Number(a?.ts || 0));
      const total = runs.length;
      // 发通知：最新一条 ok 的 run，如果 ts 在 2 分钟内，按 job delivery 配置推送
      const latestOk = runs.find((r: any) => r.status === "ok");
      if (latestOk && (Date.now() - Number(latestOk.ts || 0)) < 120000) {
        const job = targetJobs.find((j: any) => String(j.id) === String(latestOk.jobId));
        const delivery = job?.delivery || {};
        const msg = `定时任务「${latestOk.jobName || "未命名"}」已完成`;
        if (delivery.weixin) {
          sendWeixinMessage(adoptId, "", "🦞 " + msg).catch(() => {});
        } else if (delivery.mode === "announce") {
          // 主聊天由 OpenClaw gateway 自己处理，这里推企微/飞书
          sendNotification(adoptId, msg, "🦞 灵虾定时任务").catch(() => {});
        }
        // mode === "none" 不推送
      }
      return res.json({ runs: runs.slice(offset, offset + limit), total, limit, offset });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e || "cron runs failed") });
    }
  });

  app.post("/api/claw/cron/add", async (req, res) => {
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      const job = req.body?.job || {};
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      // 内部 API key 绕过 auth（供 platform tool 调用）
      const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "lingxia-bridge-2026";
      let claw: any;
      if (req.headers["x-internal-key"] === INTERNAL_KEY) {
        const { getClawByAdoptId } = await import("../db");
        claw = await getClawByAdoptId(adoptId);
        if (!claw) return res.status(404).json({ error: "NOT_FOUND" });
      } else {
        claw = await requireClawOwner(req, res, adoptId);
        if (!claw) return;
      }
      const runtimeAgentId = resolveRuntimeAgentId(adoptId, (claw as any).agentId);
      // ── 安全限制：最小间隔 30 分钟，每 agent 最多 5 个 job ──
      const CRON_MIN_INTERVAL_MS = 30 * 60 * 1000; // 30 分钟
      const CRON_MAX_JOBS_PER_AGENT = 5;

      const rawSched = job?.schedule || {};
      const schedKind = String(rawSched.kind || "every");

      // 间隔校验
      if (schedKind === "every") {
        const ms = Number(rawSched.everyMs || 0);
        if (ms < CRON_MIN_INTERVAL_MS) {
          return res.status(400).json({ error: `执行间隔不能低于 ${CRON_MIN_INTERVAL_MS / 60000} 分钟` });
        }
      }
      if (schedKind === "cron") {
        // 简单校验 cron 表达式分钟字段：不允许 */1 ~ */29 或纯 * 分钟级
        const expr = String(rawSched.expr || "").trim();
        const minutePart = expr.split(/\s+/)[0] || "";
        const stepMatch = minutePart.match(/^\*\/(\d+)$/);
        if (minutePart === "*" || (stepMatch && Number(stepMatch[1]) < 30)) {
          return res.status(400).json({ error: "cron 表达式执行频率不能高于每 30 分钟" });
        }
      }

      // 数量上限校验
      try {
        const existingJobs = callClawGatewayRpc("cron.list", { includeDisabled: true });
        const agentJobs = Array.isArray((existingJobs as any)?.jobs)
          ? (existingJobs as any).jobs.filter((j: any) => String(j?.agentId || "") === runtimeAgentId)
          : [];
        if (agentJobs.length >= CRON_MAX_JOBS_PER_AGENT) {
          return res.status(400).json({ error: `每个子虾最多 ${CRON_MAX_JOBS_PER_AGENT} 个定时任务，当前已有 ${agentJobs.length} 个` });
        }
      } catch {}

      // 清理 schedule：只保留当前 kind 需要的字段，避免 gateway schema 校验失败
      let cleanSchedule: any;
      if (schedKind === "every") {
        cleanSchedule = { kind: "every", everyMs: Number(rawSched.everyMs || 60000) };
      } else if (schedKind === "at") {
        cleanSchedule = { kind: "at", at: String(rawSched.at || "") };
      } else {
        cleanSchedule = { kind: "cron", expr: String(rawSched.expr || "0 8 * * *") };
        if (rawSched.tz) cleanSchedule.tz = String(rawSched.tz);
      }
      // 清理 payload：只保留当前 kind 需要的字段
      const rawPayload = job?.payload || {};
      const payKind = String(rawPayload.kind || "agentTurn");
      let cleanPayload: any;
      if (payKind === "agentTurn") {
        cleanPayload = { kind: "agentTurn", message: String(rawPayload.message || "") };
        if (rawPayload.model) cleanPayload.model = String(rawPayload.model);
      } else {
        cleanPayload = { kind: "systemEvent", text: String(rawPayload.text || "") };
      }
      // 清理 delivery
      const rawDelivery = job?.delivery || {};
      const cleanDelivery: any = { mode: String(rawDelivery.mode || "announce"), to: String(rawDelivery.to || "conversation") };
      if (rawDelivery.channel) cleanDelivery.channel = String(rawDelivery.channel);

      const payload = {
        name: String(job?.name || "").trim(),
        description: String(job?.description || "").trim() || undefined,
        enabled: job?.enabled !== false,
        schedule: cleanSchedule,
        payload: cleanPayload,
        sessionTarget: job?.sessionTarget || "isolated",
        delivery: cleanDelivery,
        agentId: runtimeAgentId,
      };
      const out = callClawGatewayRpc("cron.add", payload as any);
      return res.json(out);
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e || "cron add failed") });
    }
  });

  app.post("/api/claw/cron/update", async (req, res) => {
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      const id = String(req.body?.id || "").trim();
      const patch = req.body?.patch || {};
      if (!adoptId || !id) return res.status(400).json({ error: "adoptId and id required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const out = callClawGatewayRpc("cron.update", { id, patch });
      return res.json(out);
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e || "cron update failed") });
    }
  });

  app.post("/api/claw/cron/run", async (req, res) => {
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      const id = String(req.body?.id || "").trim();
      if (!adoptId || !id) return res.status(400).json({ error: "adoptId and id required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const out = callClawGatewayRpc("cron.run", { id, mode: "force" });
      return res.json(out);
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e || "cron run failed") });
    }
  });

  app.post("/api/claw/cron/remove", async (req, res) => {
    try {
      const adoptId = String(req.body?.adoptId || "").trim();
      const id = String(req.body?.id || "").trim();
      if (!adoptId || !id) return res.status(400).json({ error: "adoptId and id required" });
      const IK = process.env.INTERNAL_API_KEY || "lingxia-bridge-2026";
      let claw: any;
      if (req.headers["x-internal-key"] === IK) {
        const { getClawByAdoptId } = await import("../db");
        claw = await getClawByAdoptId(adoptId);
        if (!claw) return res.status(404).json({ error: "NOT_FOUND" });
      } else {
        claw = await requireClawOwner(req, res, adoptId);
        if (!claw) return;
      }
      const out = callClawGatewayRpc("cron.remove", { id });
      return res.json(out);
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e || "cron remove failed") });
    }
  });
}
