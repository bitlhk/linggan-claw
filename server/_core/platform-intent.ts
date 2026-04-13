/**
 * platform-intent.ts — 平台意图执行器
 * 
 * 接收已分类的 intent + StreamWriter，执行具体操作。
 * 不做分类（分类在 platform-router.ts），不关心传输协议（StreamWriter 抽象）。
 */
import type { StreamWriter } from "./stream-writer";

const BASE = "http://127.0.0.1:5180";
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "lingxia-bridge-2026";

async function getUserChannels(adoptId: string): Promise<string[]> {
  const channels: string[] = ["conversation"];
  try {
    const wxResp = await fetch(`${BASE}/api/claw/weixin/status?adoptId=${encodeURIComponent(adoptId)}`, { headers: { "X-Internal-Key": INTERNAL_KEY } });
    const wxData = await wxResp.json() as any;
    if (wxData?.bound) channels.push("weixin");
  } catch {}
  try {
    const nResp = await fetch(`${BASE}/api/claw/notify/config?adoptId=${encodeURIComponent(adoptId)}`, { headers: { "X-Internal-Key": INTERNAL_KEY } });
    const nData = await nResp.json() as any;
    const cfg = nData?.config || {};
    if (cfg.wecom?.enabled) channels.push("wecom");
    if (cfg.feishu?.enabled) channels.push("feishu");
    if (cfg.webhook?.enabled) channels.push("webhook");
  } catch {}
  return channels;
}

export async function executePlatformIntent(
  adoptId: string,
  intent: any,
  writer: StreamWriter,
): Promise<void> {

  // ── 创建定时任务 ──
  if (intent.type === "schedule_create") {
    const channels = await getUserChannels(adoptId);
    let channel = intent.channel || "conversation";
    if (channel !== "conversation" && !channels.includes(channel)) {
      const chName = channel === "weixin" ? "微信" : channel;
      writer.writeText(`⚠️ ${chName}未绑定，改为推送到主聊天。可在侧边栏绑定后修改。\n\n`);
      channel = "conversation";
    }
    // Gateway 不认识灵虾的渠道（weixin/feishu等），delivery 设为 none
    // 灵虾平台层负责轮询 cron runs 并投递到用户渠道
    const job = {
      name: String(intent.name || "定时任务"),
      description: String(intent.task || "").slice(0, 100),
      enabled: true,
      schedule: { kind: "cron", expr: String(intent.cron_expr || "0 9 * * *") },
      payload: { kind: "agentTurn", message: String(intent.task || "") },
      sessionTarget: "isolated",
      delivery: channel === "conversation"
        ? { mode: "announce", to: "conversation" }
        : { mode: "none" },
    };
    // 记录灵虾侧的投递配置（Gateway 不管这部分）
    if (channel !== "conversation") {
      try {
        const { saveCronDeliveryConfig } = await import("./cron-delivery");
        // jobId 在创建后才知道，先存 adoptId + jobName 映射
        await saveCronDeliveryConfig(adoptId, String(intent.name || "定时任务"), channel);
      } catch {}
    }
    try {
      const resp = await fetch(`${BASE}/api/claw/cron/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Key": INTERNAL_KEY },
        body: JSON.stringify({ adoptId, job }),
      });
      const data = await resp.json() as any;
      if (!resp.ok) { writer.writeError(`创建失败: ${data?.error || resp.status}`); return; }
      const chName = channel === "weixin" ? "微信" : channel === "wecom" ? "企业微信" : channel === "feishu" ? "飞书" : "主聊天";
      writer.writeText(`✅ **定时任务已创建**\n\n`);
      writer.writeText(`| 项目 | 内容 |\n|------|------|\n`);
      writer.writeText(`| 任务名称 | ${job.name} |\n`);
      writer.writeText(`| 执行内容 | ${intent.task} |\n`);
      writer.writeText(`| cron | \`${intent.cron_expr}\` |\n`);
      writer.writeText(`| 推送渠道 | ${chName} |\n\n`);
      writer.writeText(`> 可在侧边栏「定时任务」页面管理。\n`);
    } catch (e: any) { writer.writeError(e?.message || String(e)); return; }
    writer.writeEnd();
    return;
  }

  // ── 查询定时任务 ──
  if (intent.type === "schedule_list") {
    try {
      const resp = await fetch(`${BASE}/api/claw/cron/list?adoptId=${encodeURIComponent(adoptId)}`, { headers: { "X-Internal-Key": INTERNAL_KEY } });
      const data = await resp.json() as any;
      const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      if (jobs.length === 0) {
        writer.writeText("📋 当前没有定时任务。\n\n说「每天 9 点查工行股价发微信」就能创建一个。\n");
      } else {
        writer.writeText(`📋 **你的定时任务（${jobs.length} 个）**\n\n`);
        writer.writeText(`| # | 名称 | 状态 | 计划 | 渠道 |\n|---|------|------|------|------|\n`);
        jobs.forEach((j: any, i: number) => {
          const status = j.enabled ? "✅ 启用" : "⏸ 暂停";
          const sched = j.schedule?.expr || (j.schedule?.everyMs ? `每${Math.round(j.schedule.everyMs / 60000)}分钟` : "—");
          const ch = j.delivery?.to || j.delivery?.channel || "conversation";
          writer.writeText(`| ${i + 1} | ${j.name || "—"} | ${status} | ${sched} | ${ch} |\n`);
        });
        writer.writeText(`\n> 在侧边栏「定时任务」页面可以编辑或删除。\n`);
      }
    } catch (e: any) { writer.writeError(`查询失败: ${e?.message}`); return; }
    writer.writeEnd();
    return;
  }

  // ── 删除定时任务 ──
  if (intent.type === "schedule_delete") {
    const keyword = String(intent.task_name || "").toLowerCase();
    try {
      const resp = await fetch(`${BASE}/api/claw/cron/list?adoptId=${encodeURIComponent(adoptId)}`, { headers: { "X-Internal-Key": INTERNAL_KEY } });
      const data = await resp.json() as any;
      const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      const match = jobs.find((j: any) =>
        (j.name || "").toLowerCase().includes(keyword) ||
        (j.description || "").toLowerCase().includes(keyword)
      );
      if (!match) {
        writer.writeText(`❌ 没找到包含「${intent.task_name}」的定时任务。\n\n`);
        if (jobs.length > 0) writer.writeText(`当前任务：${jobs.map((j: any) => j.name).join("、")}\n`);
        writer.writeEnd();
        return;
      }
      const delResp = await fetch(`${BASE}/api/claw/cron/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Key": INTERNAL_KEY },
        body: JSON.stringify({ adoptId, id: match.id }),
      });
      if (!delResp.ok) {
        const d = await delResp.json() as any;
        writer.writeError(`删除失败: ${d?.error || delResp.status}`);
        return;
      }
      writer.writeText(`✅ 已删除定时任务「${match.name}」\n`);
    } catch (e: any) { writer.writeError(e?.message || String(e)); return; }
    writer.writeEnd();
    return;
  }

  // ── 查询渠道 ──
  if (intent.type === "channels_query") {
    const channels = await getUserChannels(adoptId);
    writer.writeText(`📡 **你的可用推送渠道**\n\n`);
    for (const ch of channels) {
      const name = ch === "conversation" ? "💬 主聊天（默认）" :
        ch === "weixin" ? "📱 微信（已绑定）" :
        ch === "wecom" ? "🏢 企业微信（已配置）" :
        ch === "feishu" ? "🐦 飞书（已配置）" :
        ch === "webhook" ? "🔗 Webhook（已配置）" : ch;
      writer.writeText(`- ${name}\n`);
    }
    writer.writeText(`\n> 在侧边栏「微信」和「设置」页面可以绑定更多渠道。\n`);
    writer.writeEnd();
    return;
  }

  // ── 立即发送通知 ──
  if (intent.type === "send") {
    const channel = String(intent.channel || "weixin");
    const content = String(intent.content || "");
    if (!content) { writer.writeError("发送内容不能为空"); return; }
    const channels = await getUserChannels(adoptId);
    if (!channels.includes(channel)) { writer.writeError(`${channel === "weixin" ? "微信" : channel} 未绑定`); return; }
    writer.writeText(`📤 正在发送...\n\n`);
    if (channel === "weixin") {
      try {
        const { sendMessageToWeixin } = await import("./claw-weixin-bridge");
        await sendMessageToWeixin(adoptId, content);
        writer.writeText(`✅ 已发送到微信\n`);
      } catch (e: any) { writer.writeError(`微信发送失败: ${e?.message}`); return; }
    } else {
      try {
        const resp = await fetch(`${BASE}/api/claw/notify/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal-Key": INTERNAL_KEY },
          body: JSON.stringify({ adoptId, channel, message: content }),
        });
        if (!resp.ok) { writer.writeError("发送失败"); return; }
        writer.writeText(`✅ 已通过${channel}发送\n`);
      } catch (e: any) { writer.writeError(e?.message || String(e)); return; }
    }
    writer.writeEnd();
    return;
  }

  writer.writeText("🤔 识别到平台操作意图但暂不支持，试试换个说法？\n");
  writer.writeEnd();
}
