import { desc, eq, sql } from "drizzle-orm";
import { businessAgents, skillMarketplace, agentCallLogs, BusinessAgent, InsertBusinessAgent } from "../../drizzle/schema";
import { getDb } from "./connection";

// ── Business Agents CRUD ────────────────────────────────────────────────
export async function listBusinessAgents(): Promise<BusinessAgent[]> {
  const db = await getDb();
  return db.select().from(businessAgents).orderBy(businessAgents.sortOrder);
}

export async function listEnabledBusinessAgents(): Promise<BusinessAgent[]> {
  const db = await getDb();
  return db.select().from(businessAgents)
    .where(eq(businessAgents.enabled, 1))
    .orderBy(businessAgents.sortOrder);
}

export async function getBusinessAgent(id: string): Promise<BusinessAgent | undefined> {
  const db = await getDb();
  const rows = await db.select().from(businessAgents).where(eq(businessAgents.id, id)).limit(1);
  return rows[0];
}

export async function upsertBusinessAgent(data: InsertBusinessAgent): Promise<void> {
  const db = await getDb();
  await db.insert(businessAgents).values(data)
    .onDuplicateKeyUpdate({ set: {
      name: data.name,
      description: data.description,
      kind: data.kind,
      apiUrl: data.apiUrl,
      apiToken: data.apiToken,
      remoteAgentId: data.remoteAgentId,
      localAgentId: data.localAgentId,
      skills: data.skills,
      icon: data.icon,
      enabled: data.enabled,
      sortOrder: data.sortOrder,
    }});
}

export async function deleteBusinessAgent(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(businessAgents).where(eq(businessAgents.id, id));
}

export async function updateBusinessAgentEnabled(id: string, enabled: number): Promise<void> {
  const db = await getDb();
  await db.update(businessAgents).set({ enabled }).where(eq(businessAgents.id, id));
}


// ── 技能市场 DB helpers ──
export async function listSkillMarketItems(status?: string): Promise<any[]> {
  const db = await getDb();
  if (status && status !== "all") {
    return db.select().from(skillMarketplace).where(eq(skillMarketplace.status, status as any)).orderBy(skillMarketplace.createdAt);
  }
  return db.select().from(skillMarketplace).orderBy(skillMarketplace.createdAt);
}

export async function listApprovedSkillMarketItems(): Promise<any[]> {
  const db = await getDb();
  return db.select().from(skillMarketplace).where(eq(skillMarketplace.status, "approved")).orderBy(skillMarketplace.downloadCount);
}

export async function getSkillMarketItem(id: number): Promise<any | undefined> {
  const db = await getDb();
  const rows = await db.select().from(skillMarketplace).where(eq(skillMarketplace.id, id)).limit(1);
  return rows[0];
}

export async function insertSkillMarketItem(data: any): Promise<number> {
  const db = await getDb();
  const result = await db.insert(skillMarketplace).values(data);
  return Number(result[0].insertId);
}

export async function updateSkillMarketItem(id: number, data: Record<string, any>): Promise<void> {
  const db = await getDb();
  await db.update(skillMarketplace).set(data).where(eq(skillMarketplace.id, id));
}

export async function deleteSkillMarketItem(id: number): Promise<void> {
  const db = await getDb();
  await db.delete(skillMarketplace).where(eq(skillMarketplace.id, id));
}

export async function incrementSkillDownload(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(sql`UPDATE skill_marketplace SET download_count = download_count + 1 WHERE id = ${id}`);
}


// ── Agent 调用日志 + 健康检查 DB helpers ──
export async function insertCallLog(data: { agentId: string; userId?: number; adoptId?: string; status: "success" | "error" | "timeout"; durationMs: number; errorMessage?: string }): Promise<void> {
  const db = await getDb();
  await db.insert(agentCallLogs).values(data as any);
}

export async function getCallLogs(agentId: string, limit = 50): Promise<any[]> {
  const db = await getDb();
  return db.select().from(agentCallLogs).where(eq(agentCallLogs.agentId, agentId)).orderBy(desc(agentCallLogs.createdAt)).limit(limit);
}

export async function getCallStats(agentId: string): Promise<{ total: number; today: number; errors: number }> {
  const db = await getDb();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const all = await db.select().from(agentCallLogs).where(eq(agentCallLogs.agentId, agentId));
  const today = all.filter(r => new Date(r.createdAt) >= todayStart);
  const errors = all.filter(r => r.status !== "success");
  return { total: all.length, today: today.length, errors: errors.length };
}

export async function updateAgentHealth(id: string, healthStatus: string): Promise<void> {
  const db = await getDb();
  await db.update(businessAgents).set({ healthStatus: healthStatus as any, lastHealthCheck: new Date() } as any).where(eq(businessAgents.id, id));
}

export async function updateAgentFields(id: string, fields: Record<string, any>): Promise<void> {
  const db = await getDb();
  await db.update(businessAgents).set(fields).where(eq(businessAgents.id, id));
}
