/**
 * 将主页上的硬编码数据同步到配置数据库
 */

import "dotenv/config";
import { getDb } from "../server/db";

// 主页上的体验数据
const homeExperiences = [
  {
    experienceId: "wealth-assistant",
    title: "银行客户经理财富助手",
    description: "AI驱动的财富管理助手，覆盖客户画像理解、产品匹配、话术生成等核心环节。",
    url: "http://116.204.80.102:8888/workstation",
    scenarioId: "acquisition",
    icon: "Bot",
    tag: "银行",
    features: ["客户画像理解", "产品智能匹配", "话术生成"],
    displayOrder: 1,
  },
  {
    experienceId: "insurance-advisor",
    title: "保险智能保顾",
    description: "智能保险顾问系统，提供保险方案生成、条款解读、合规辅助等关键环节的AI支持。",
    url: "http://115.120.10.127:9528/login.html",
    scenarioId: "acquisition",
    icon: "Shield",
    tag: "保险",
    features: ["保险方案生成", "条款解读", "合规辅助"],
    displayOrder: 2,
  },
  {
    experienceId: "voice-transfer",
    title: "手机银行智能助手",
    description: "智能识别用户意图，支持全语音输入，提升银行服务体验。",
    url: "http://116.204.80.102:8008",
    scenarioId: "acquisition",
    icon: "Mic",
    tag: "银行",
    features: ["意图识别", "语音输入", "智能理解"],
    displayOrder: 3,
  },
  {
    experienceId: "group-insurance-audit",
    title: "团险智能核保",
    description: "基于AI的团险核保系统，提升核保效率和准确性。",
    url: "http://116.204.80.102:8080/home/",
    scenarioId: "operations",
    icon: "FileCheck",
    tag: "保险",
    features: ["智能核保", "风险评估", "自动化审批"],
    displayOrder: 1,
  },
  {
    experienceId: "golden-coach",
    title: "金牌教练",
    description: "AI驱动的保险销售培训系统，提供个性化培训方案、实战演练、业绩分析等功能。",
    url: "http://116.205.111.24:8214/",
    scenarioId: "operations",
    icon: "Users",
    tag: "保险",
    features: ["个性化培训", "实战演练", "业绩分析"],
    displayOrder: 2,
  },
  {
    experienceId: "smart-audit",
    title: "智能审核一体机方案",
    description: "基于多模态大模型对银行网点的单据和信息做智能审核，降低业务办理错误率。",
    url: "",
    scenarioId: "operations",
    icon: "FileCheck",
    tag: "银行",
    features: ["多模态识别", "单据审核", "错误预警"],
    status: "developing" as const,
    displayOrder: 2,
  },
  {
    experienceId: "smart-research",
    title: "智能投研",
    description: "AI驱动的智能投研平台，提供市场分析、投资策略生成、风险预警等功能。",
    url: "",
    scenarioId: "investment",
    icon: "LineChart",
    tag: "银行",
    features: ["市场分析", "策略生成", "风险预警"],
    status: "developing" as const,
    displayOrder: 2,
  },
  {
    experienceId: "research-report",
    title: "投研报告",
    description: "智能投研报告生成系统，自动化生成行业研究、公司分析、投资建议等专业报告。",
    url: "",
    scenarioId: "investment",
    icon: "FileText",
    tag: "证券",
    features: ["行业研究", "公司分析", "投资建议"],
    status: "developing" as const,
    displayOrder: 3,
  },
];

async function syncHomeDataToConfig() {
  const db = await getDb();
  if (!db) {
    console.error("数据库连接失败，请检查 DATABASE_URL 配置");
    process.exit(1);
  }

  try {
    console.log("正在同步（仅新增，不更新已有配置）...");

    const { getExperienceConfig, createExperienceConfig } = await import("../server/db");

    for (const exp of homeExperiences) {
      try {
        const existing = await getExperienceConfig(exp.experienceId);
        if (existing) {
          console.log(`   ⏭️  已存在，跳过: ${exp.experienceId} - ${exp.title}`);
          continue;
        }
        await createExperienceConfig({
          experienceId: exp.experienceId,
          title: exp.title,
          description: exp.description,
          url: exp.url || "http://example.com",
          scenarioId: exp.scenarioId,
          status: (exp as any).status || "active",
          displayOrder: exp.displayOrder,
          icon: exp.icon,
          tag: exp.tag,
          features: JSON.stringify(exp.features),
        });
        console.log(`   ✅ 新增: ${exp.experienceId} - ${exp.title}`);
      } catch (error: any) {
        console.error(`   ❌ ${exp.experienceId}: ${error.message}`);
      }
    }

    console.log("✅ 同步完成");
    process.exit(0);
  } catch (error) {
    console.error("❌ 同步失败:", error);
    process.exit(1);
  }
}

syncHomeDataToConfig();

