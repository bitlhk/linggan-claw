/**
 * 创建场景体验配置表并初始化默认配置
 */

import "dotenv/config";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";
import { createExperienceConfig } from "../server/db";

async function createExperienceConfigsTable() {
  const db = await getDb();
  if (!db) {
    console.error("数据库连接失败，请检查 DATABASE_URL 配置");
    process.exit(1);
  }

  try {
    console.log("正在创建 experience_configs 表...");

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS \`experience_configs\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`experienceId\` varchar(100) NOT NULL,
        \`title\` varchar(200) NOT NULL,
        \`description\` text,
        \`url\` varchar(500) NOT NULL,
        \`scenarioId\` varchar(50) NOT NULL,
        \`status\` enum('active','developing') NOT NULL DEFAULT 'active',
        \`displayOrder\` int NOT NULL DEFAULT 0,
        \`createdAt\` timestamp NOT NULL DEFAULT (now()),
        \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
        \`updatedBy\` int,
        CONSTRAINT \`experience_configs_id\` PRIMARY KEY(\`id\`),
        CONSTRAINT \`experience_configs_experienceId_unique\` UNIQUE(\`experienceId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log("✅ experience_configs 表创建成功");

    // 初始化默认配置
    console.log("正在初始化默认场景体验配置...");

    const defaultConfigs = [
      {
        experienceId: "wealth-assistant",
        title: "银行客户经理财富助手",
        description: "AI驱动的财富管理助手，覆盖客户画像理解、产品匹配、话术生成等核心环节。",
        url: "http://116.204.80.102:8888/workstation",
        scenarioId: "acquisition",
        status: "active" as const,
        displayOrder: 1,
      },
      {
        experienceId: "insurance-advisor",
        title: "保险智能保顾",
        description: "智能保险顾问系统，提供保险方案生成、条款解读、合规辅助等关键环节的AI支持。",
        url: "http://115.120.10.127:9528/login.html",
        scenarioId: "acquisition",
        status: "active" as const,
        displayOrder: 2,
      },
      {
        experienceId: "voice-transfer",
        title: "手机银行智能助手",
        description: "智能识别用户意图，支持全语音输入，提升银行服务体验。",
        url: "http://116.204.80.102:8008",
        scenarioId: "acquisition",
        status: "active" as const,
        displayOrder: 3,
      },
      {
        experienceId: "group-insurance-audit",
        title: "团险智能核保",
        description: "基于AI的团险核保系统，提升核保效率和准确性。",
        url: "http://116.204.80.102:8080/home/",
        scenarioId: "operations",
        status: "active" as const,
        displayOrder: 1,
      },
      {
        experienceId: "golden-coach",
        title: "金牌教练",
        description: "智能投资教练系统，提供个性化的投资建议和策略。",
        url: "http://116.205.111.24:8214/",
        scenarioId: "investment",
        status: "active" as const,
        displayOrder: 1,
      },
    ];

    for (const config of defaultConfigs) {
      try {
        await createExperienceConfig(config);
        console.log(`   ✅ ${config.experienceId}: ${config.title}`);
      } catch (error: any) {
        if (error.message?.includes("已存在") || error.code === "ER_DUP_ENTRY") {
          console.log(`   ⚠️  ${config.experienceId}: 已存在，跳过`);
        } else {
          console.error(`   ❌ ${config.experienceId}: ${error.message}`);
        }
      }
    }

    console.log("✅ 默认场景体验配置初始化完成");

    process.exit(0);
  } catch (error) {
    console.error("❌ 创建表或初始化失败:", error);
    process.exit(1);
  }
}

createExperienceConfigsTable();

