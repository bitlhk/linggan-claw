/**
 * cron-delivery.ts — 灵虾平台侧 cron 结果投递
 * 
 * Gateway cron 不认识灵虾的渠道（微信/飞书等），
 * 灵虾轮询 cron runs，发现新完成的结果推送到用户指定渠道。
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";

const CONFIG_PATH = "/root/linggan-platform/data/cron-delivery-config.json";
const POLL_INTERVAL_MS = 60_000;

interface DeliveryConfig {
  adoptId: string;
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

export async function saveCronDeliveryConfig(adoptId: string, jobName: string, channel: string) {
  const configs = loadConfigs();
  const existing = configs.find(c => c.adoptId === adoptId && c.jobName === jobName);
  if (existing) {
    existing.channel = channel;
  } else {
    configs.push({ adoptId, jobName, channel });
  }
  saveConfigs(configs);
}

async function pollAndDeliver() {
  const configs = loadConfigs();
  if (configs.length === 0) return;

  // 一次性拉所有 cron jobs
  let allJobs: any[] = [];
  try {
    const listOut = execSync("openclaw cron list --json 2>/dev/null", { timeout: 10000 }).toString();
    const listData = JSON.parse(listOut);
    allJobs = Array.isArray(listData?.jobs) ? listData.jobs : [];
  } catch (e: any) {
    console.error("[CRON-DELIVERY] failed to list jobs:", e?.message?.slice(0, 100));
    return;
  }

  for (const cfg of configs) {
    try {
      const job = allJobs.find((j: any) =>
        (j.name || "").includes(cfg.jobName) || (cfg.jobName || "").includes(j.name || "___")
      );
      if (!job) continue;

      // 拉最近一条 run
      let latestRun: any = null;
      try {
        const runsOut = execSync(`openclaw cron runs --id ${job.id} --limit 1 2>/dev/null`, { timeout: 10000 }).toString();
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

      if (cfg.channel === "weixin") {
        try {
          const { sendMessageToWeixin } = await import("./claw-weixin-bridge");
          await sendMessageToWeixin(cfg.adoptId, `⏰ 定时任务「${cfg.jobName}」\n\n${summary}`);
          console.log(`[CRON-DELIVERY] weixin sent OK`);
        } catch (e: any) {
          console.error(`[CRON-DELIVERY] weixin send failed:`, e?.message);
        }
      } else {
        try {
          const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "lingxia-bridge-2026";
          await fetch("http://127.0.0.1:5180/api/claw/notify/test", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Internal-Key": INTERNAL_KEY },
            body: JSON.stringify({ adoptId: cfg.adoptId, channel: cfg.channel, message: `⏰ ${cfg.jobName}\n\n${summary}` }),
          });
        } catch {}
      }

      cfg.lastDeliveredRunTs = runTs;
      saveConfigs(configs);
    } catch (e: any) {
      console.error(`[CRON-DELIVERY] error for ${cfg.adoptId}/${cfg.jobName}:`, e?.message);
    }
  }
}

export function startCronDeliveryPoller() {
  console.log("[CRON-DELIVERY] poller started");
  setInterval(pollAndDeliver, POLL_INTERVAL_MS);
  setTimeout(pollAndDeliver, 5000);
}
