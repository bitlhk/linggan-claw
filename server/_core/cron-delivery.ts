/**
 * cron-delivery.ts — 灵虾平台侧 cron 结果投递
 * 
 * Gateway cron 不认识灵虾的渠道（微信/飞书等），
 * 灵虾轮询 cron runs，发现新完成的结果推送到用户指定渠道。
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync, execFileSync } from "child_process";

const CONFIG_PATH = "/root/linggan-platform/data/cron-delivery-config.json";
const POLL_INTERVAL_MS = 60_000;

interface DeliveryConfig {
  adoptId: string;
  // jobId 是主 key（优先使用）；jobName 只作 display 和旧数据 fallback
  jobId?: string;
  jobName: string;
  channel: string;
  lastDeliveredRunTs?: number;
}

function loadConfigs(): DeliveryConfig[] {
  try {
    if (existsSync(CONFIG_PATH)) return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {}
  return [];
}

function saveConfigs(configs: DeliveryConfig[]) {
  writeFileSync(CONFIG_PATH, JSON.stringify(configs, null, 2), "utf-8");
}

export async function saveCronDeliveryConfig(
  adoptId: string,
  jobName: string,
  channel: string,
  jobId?: string,
) {
  const configs = loadConfigs();
  // 优先按 jobId 命中（精确）；退化到 jobName（旧数据兼容）
  const existing = configs.find(c =>
    c.adoptId === adoptId && (
      (jobId && c.jobId === jobId) ||
      (!jobId && !c.jobId && c.jobName === jobName)
    )
  );
  if (existing) {
    existing.channel = channel;
    if (jobId) existing.jobId = jobId;
    existing.jobName = jobName;
  } else {
    configs.push({ adoptId, jobId, jobName, channel });
  }
  saveConfigs(configs);
}

/** 删除某个 job 的投递配置（按 jobId 精确匹配）。用于 schedule_delete 清理。 */
export async function deleteCronDeliveryConfig(adoptId: string, jobId: string) {
  if (!adoptId || !jobId) return;
  const configs = loadConfigs();
  const next = configs.filter(c => !(c.adoptId === adoptId && c.jobId === jobId));
  if (next.length !== configs.length) saveConfigs(next);
}

/** 给 platform 层用的只读查询：按 adoptId+jobId 返回渠道（无配置返回 undefined） */
export function getCronDeliveryChannel(adoptId: string, jobId: string, jobName?: string): string | undefined {
  const configs = loadConfigs();
  const hit = configs.find(c => c.adoptId === adoptId && (
    (c.jobId && c.jobId === jobId) ||
    (!c.jobId && jobName && c.jobName === jobName)
  ));
  return hit?.channel;
}

async function pollAndDeliver() {
  const configs = loadConfigs();
  if (configs.length === 0) return;

  // 一次性拉所有 cron jobs
  let allJobs: any[] = [];
  try {
    const listOut = execFileSync("openclaw", ["cron", "list", "--json"], { timeout: 10000, stdio: ["pipe","pipe","pipe"] }).toString();
    const listData = JSON.parse(listOut);
    allJobs = Array.isArray(listData?.jobs) ? listData.jobs : [];
  } catch (e: any) {
    console.error("[CRON-DELIVERY] failed to list jobs:", e?.message?.slice(0, 100));
    return;
  }

  for (const cfg of configs) {
    try {
      // 优先 jobId 精确匹配；没有 jobId 的旧数据才 fallback 到 jobName 精确匹配
      const job = cfg.jobId
        ? allJobs.find((j: any) => String(j?.id || "") === cfg.jobId)
        : allJobs.find((j: any) => String(j?.name || "") === cfg.jobName);
      if (!job) continue;

      // 拉最近一条 run
      let latestRun: any = null;
      // 校验 job.id 格式（UUID），防止命令注入
      if (!/^[a-f0-9-]{36}$/.test(job.id)) continue;
      try {
        const runsOut = execFileSync("openclaw", ["cron", "runs", "--id", job.id, "--limit", "1"], { timeout: 10000, stdio: ["pipe","pipe","pipe"] }).toString();
        const runsData = JSON.parse(runsOut);
        const entries = Array.isArray(runsData?.entries) ? runsData.entries : [];
        if (entries.length > 0) latestRun = entries[0];
      } catch { continue; }

      if (!latestRun) continue;
      const runTs = latestRun.ts || latestRun.runAtMs || 0;

      // 跳过已投递的
      if (cfg.lastDeliveredRunTs && runTs <= cfg.lastDeliveredRunTs) continue;

      const summary = latestRun.summary || "";
      if (!summary) continue;

      console.log(`[CRON-DELIVERY] delivering "${cfg.jobName}" to ${cfg.channel} for ${cfg.adoptId}`);

      let deliveryOk = false;
      if (cfg.channel === "weixin") {
        try {
          const { sendMessageToWeixin } = await import("./claw-weixin-bridge");
          await sendMessageToWeixin(cfg.adoptId, `⏰ 定时任务「${cfg.jobName}」\n\n${summary}`);
          console.log(`[CRON-DELIVERY] weixin sent OK`);
          deliveryOk = true;
        } catch (e: any) {
          console.error(`[CRON-DELIVERY] weixin send failed:`, e?.message);
        }
      } else {
        try {
          const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "lingxia-bridge-2026"; // TODO: import from constants.ts
          const resp = await fetch("http://127.0.0.1:5180/api/claw/notify/test", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Internal-Key": INTERNAL_KEY },
            body: JSON.stringify({ adoptId: cfg.adoptId, channel: cfg.channel, message: `⏰ ${cfg.jobName}\n\n${summary}` }),
          });
          if (resp.ok) {
            const body = await resp.json() as any;
            deliveryOk = body?.ok !== false;
            if (!deliveryOk) console.error(`[CRON-DELIVERY] notify returned ok=false`);
          } else {
            console.error(`[CRON-DELIVERY] notify HTTP ${resp.status}`);
          }
        } catch (e: any) {
          console.error(`[CRON-DELIVERY] notify send error:`, e?.message);
        }
      }

      // 只在投递成功时标记，失败则下次轮询会重试
      if (deliveryOk) {
        cfg.lastDeliveredRunTs = runTs;
        saveConfigs(configs);
      }
    } catch (e: any) {
      console.error(`[CRON-DELIVERY] error for ${cfg.adoptId}/${cfg.jobName}:`, e?.message);
    }
  }
}

let pollInterval: ReturnType<typeof setInterval> | null = null;

export function startCronDeliveryPoller() {
  if (pollInterval) return; // 防止重复启动
  console.log("[CRON-DELIVERY] poller started");
  pollInterval = setInterval(pollAndDeliver, POLL_INTERVAL_MS);
  setTimeout(pollAndDeliver, 5000);
}

export function stopCronDeliveryPoller() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}
