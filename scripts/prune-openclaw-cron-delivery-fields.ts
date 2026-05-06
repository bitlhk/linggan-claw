#!/usr/bin/env -S npx tsx
/**
 * Remove stale routing fields from OpenClaw cron jobs whose delivery mode is
 * already "none". OpenClaw cron.update merge-patches delivery objects, so
 * fields such as delivery.channel can remain on disk and continue to pollute
 * previews/run metadata even after runner delivery is disabled.
 *
 * Default mode is read-only:
 *   pnpm tsx scripts/prune-openclaw-cron-delivery-fields.ts --dry-run
 *
 * Apply after reviewing the output:
 *   pnpm tsx scripts/prune-openclaw-cron-delivery-fields.ts --apply
 */

import "dotenv/config";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "fs";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const DRY_RUN = argv.includes("--dry-run") || !APPLY;
const STORE_PATH = process.env.OPENCLAW_CRON_STORE || "/root/.openclaw/cron/jobs.json";
const ROUTING_FIELDS = ["channel", "to", "account", "accountId", "token"] as const;

function loadStore(): any {
  return JSON.parse(readFileSync(STORE_PATH, "utf-8"));
}

function jobsOf(store: any): any[] {
  return Array.isArray(store?.jobs) ? store.jobs : [];
}

function staleFields(job: any): string[] {
  const delivery = job?.delivery || {};
  if (String(delivery.mode || "") !== "none") return [];
  return ROUTING_FIELDS.filter((field) => delivery[field] !== undefined);
}

async function main() {
  if (!existsSync(STORE_PATH)) {
    throw new Error(`OpenClaw cron store not found: ${STORE_PATH}`);
  }

  const store = loadStore();
  const jobs = jobsOf(store);
  const dirty = jobs
    .map((job) => ({ job, fields: staleFields(job) }))
    .filter((item) => item.fields.length > 0);

  console.log(`[PRUNE] store=${STORE_PATH}`);
  console.log(`[PRUNE] scanned ${jobs.length} OpenClaw cron jobs`);
  console.log(`[PRUNE] ${dirty.length} jobs have stale delivery routing fields`);
  for (const { job, fields } of dirty) {
    console.log(`  - ${job.id} ${job.name || "(unnamed)"} remove=${fields.join(",")} delivery=${JSON.stringify(job.delivery || {})}`);
  }

  if (DRY_RUN) {
    console.log("[PRUNE] dry-run only; rerun with --apply after reviewing the list");
    return;
  }

  const backup = `${STORE_PATH}.bak-lingxia-${Date.now()}`;
  copyFileSync(STORE_PATH, backup);
  for (const { job, fields } of dirty) {
    for (const field of fields) delete job.delivery[field];
  }
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
  console.log(`[PRUNE] backup written to ${backup}`);
  console.log(`[PRUNE] pruned ${dirty.length} jobs`);
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(`[PRUNE] failed: ${err?.message || err}`);
  process.exit(1);
});
