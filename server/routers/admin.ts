import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import {
  getSmtpConfig,
  upsertSmtpConfig,
  getAllFeatureFlags,
  getFeatureFlag,
  upsertFeatureFlag,
  getAllExperienceConfigs,
  getExperienceConfig,
  getExperienceConfigsByScenario,
  createExperienceConfig,
  updateExperienceConfig,
  deleteExperienceConfig,
  getAllScenarios,
  getAllScenariosAdmin,
  getScenarioById,
  createScenario,
  updateScenario,
  deleteScenario,
} from "../db";
import {
  readDemoPublishStatusMap,
  ensureIframeBypassExperienceId,
  publishDemoRoutingNow,
} from "./helpers";

export const smtpRouter = router({
    // 获取SMTP配置
    get: adminProcedure.query(async () => {
      const config = await getSmtpConfig();
      if (!config) {
        return null;
      }
      // 不返回密码
      return {
        id: config.id,
        host: config.host,
        port: config.port,
        user: config.user,
        from: config.from,
        enabled: config.enabled,
        updatedAt: config.updatedAt,
        updatedBy: config.updatedBy,
      };
    }),

    // 更新SMTP配置
    update: adminProcedure
      .input(
        z.object({
          host: z.string().min(1, "SMTP服务器地址不能为空").optional(),
          port: z.string().min(1, "端口不能为空").optional(),
          user: z.string().email("请输入有效的邮箱地址").optional(),
          password: z.string().optional(), // 密码可选，不传则不更新
          from: z.string().email("请输入有效的发件人邮箱").optional(),
          enabled: z.enum(["yes", "no"]).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const existing = await getSmtpConfig();
        const userId = ctx.user?.id;

        // 如果密码为空字符串，则不更新密码；如果未提供，则保持原密码
        const updateData: any = {
          host: input.host ?? existing?.host ?? null,
          port: input.port ?? existing?.port ?? null,
          user: input.user ?? existing?.user ?? null,
          from: input.from ?? existing?.from ?? null,
          enabled: input.enabled ?? existing?.enabled ?? "no",
        };

        // 只有明确提供了密码时才更新
        if (input.password !== undefined && input.password !== "") {
          updateData.password = input.password;
        } else if (existing) {
          // 保持原密码
          updateData.password = existing.password;
        }

        await upsertSmtpConfig(updateData, userId);
        return { success: true };
      }),

    // 测试SMTP配置
    test: adminProcedure
      .input(
        z.object({
          testEmail: z.string().email("请输入有效的测试邮箱地址"),
        })
      )
      .mutation(async ({ input }) => {
        const config = await getSmtpConfig();
        if (!config || config.enabled !== "yes") {
          throw new Error("SMTP配置未启用或不存在");
        }

        // 发送测试邮件
        const { sendEmail } = await import("../_core/email");
        const subject = "【灵感】SMTP测试邮件";
        const text = "这是一封来自灵感平台的测试邮件。如果您收到此邮件，说明SMTP配置正确。";
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #CF0A2C;">灵感 - SMTP测试邮件</h2>
            <p>您好，</p>
            <p>这是一封来自灵感平台的测试邮件。</p>
            <p>如果您收到此邮件，说明SMTP配置正确，邮件发送功能正常工作。</p>
            <p style="color: #666; font-size: 12px; margin-top: 30px;">
              此邮件由系统自动发送，请勿回复。
            </p>
          </div>
        `;

        await sendEmail(input.testEmail, subject, text, html);

        return { success: true, message: "测试邮件已发送" };
      }),
});

export const featureFlagsRouter = router({
    // 获取所有功能开关
    list: adminProcedure.query(async () => {
      const flags = await getAllFeatureFlags();
      return flags;
    }),

    // 获取单个功能开关
    get: adminProcedure
      .input(z.object({ key: z.string() }))
      .query(async ({ input }) => {
        const flag = await getFeatureFlag(input.key);
        return flag;
      }),

    // 更新功能开关
    update: adminProcedure
      .input(
        z.object({
          key: z.string(),
          name: z.string().optional(),
          description: z.string().optional(),
          enabled: z.enum(["yes", "no"]).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const existing = await getFeatureFlag(input.key);
        const userId = ctx.user?.id;

        const updateData: any = {
          key: input.key,
          name: input.name ?? existing?.name ?? input.key,
          description: input.description ?? existing?.description ?? null,
          enabled: input.enabled ?? existing?.enabled ?? "yes",
        };

        await upsertFeatureFlag(updateData, userId);
        return { success: true };
      }),
});

export const scenariosRouter = router({
    // 获取所有场景（公开接口，返回 active 状态）
    getAll: publicProcedure.query(async () => {
      return await getAllScenarios();
    }),

    // 获取所有场景（管理员接口，返回全部）
    list: adminProcedure.query(async () => {
      return await getAllScenariosAdmin();
    }),

    // 获取单个场景
    get: adminProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        const scenario = await getScenarioById(input.id);
        return scenario;
      }),

    // 创建场景
    create: adminProcedure
      .input(
        z.object({
          id: z.string().min(1, "场景ID不能为空"),
          title: z.string().min(1, "标题不能为空"),
          subtitle: z.string().optional(),
          description: z.string().optional(),
          icon: z.string().optional(),
          displayOrder: z.number().int().default(0),
          status: z.enum(["active", "hidden"]).default("active"),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user?.id;

        // 检查是否已存在
        const existing = await getScenarioById(input.id);
        if (existing) {
          throw new Error("该场景ID已存在");
        }

        await createScenario({
          id: input.id,
          title: input.title,
          subtitle: input.subtitle || null,
          description: input.description || null,
          icon: input.icon || null,
          displayOrder: input.displayOrder,
          status: input.status,
        });

        return { success: true };
      }),

    // 更新场景
    update: adminProcedure
      .input(
        z.object({
          id: z.string(),
          title: z.string().min(1).optional(),
          subtitle: z.string().optional(),
          description: z.string().optional(),
          icon: z.string().optional(),
          displayOrder: z.number().int().optional(),
          status: z.enum(["active", "hidden"]).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const { id, ...updateData } = input;
        await updateScenario(id, updateData);
        return { success: true };
      }),

    // 删除场景
    delete: adminProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        await deleteScenario(input.id);
        return { success: true };
      }),
});

export const experienceConfigsRouter = router({
    // 获取所有配置
    list: adminProcedure.query(async () => {
      const configs = await getAllExperienceConfigs();
      const statusMap = await readDemoPublishStatusMap();
      // 解析 features JSON 字符串为数组
      return configs.map(config => ({
        ...config,
        features: config.features ? (() => {
          try {
            return JSON.parse(config.features);
          } catch {
            return [];
          }
        })() : [],
        publishStatus: statusMap[config.experienceId] || null,
      }));
    }),

    // 获取所有配置（公开接口，用于前端显示，包括开发中的）
    getAll: publicProcedure.query(async ({ ctx }) => {
      const accessLevel = (ctx.user as any)?.accessLevel === "all" ? "all" : "public_only";
      const configs = await getAllExperienceConfigs(accessLevel);
      // 返回可见配置，前端根据状态决定是否显示和是否可点击
      // 解析 features JSON 字符串为数组
      return configs.map(config => ({
        ...config,
        features: config.features ? (() => {
          try {
            return JSON.parse(config.features);
          } catch {
            return [];
          }
        })() : [],
      }));
    }),

    // 根据体验ID获取配置（公开接口）
    getById: publicProcedure
      .input(z.object({ experienceId: z.string() }))
      .query(async ({ input }) => {
        const config = await getExperienceConfig(input.experienceId);
        return config;
      }),

    // 根据场景ID获取配置
    getByScenario: adminProcedure
      .input(z.object({ scenarioId: z.string() }))
      .query(async ({ input }) => {
        const configs = await getExperienceConfigsByScenario(input.scenarioId);
        return configs;
      }),

    // 获取单个配置
    get: adminProcedure
      .input(z.object({ experienceId: z.string() }))
      .query(async ({ input }) => {
        const config = await getExperienceConfig(input.experienceId);
        return config;
      }),

    // 创建配置
    create: adminProcedure
      .input(
        z.object({
          experienceId: z
            .string()
            .min(2, "体验ID至少2位")
            .max(50, "体验ID最多50位")
            .regex(/^(?!-)(?!.*--)[a-z0-9-]+(?<!-)$/, "体验ID仅支持小写字母/数字/中划线，不能以中划线开头或结尾，且不能连续中划线"),
          title: z.string().min(1, "标题不能为空"),
          description: z.string().optional(),
          url: z.string().url("请输入有效的URL地址"),
          scenarioId: z.string().min(1, "场景ID不能为空"),
          status: z.enum(["active", "developing"]).default("active"),
          visibility: z.enum(["public", "internal"]).default("public"),
          displayOrder: z.number().int().default(0),
          icon: z.string().optional(),
          tag: z.string().optional(),
          features: z.array(z.string()).optional(), // 功能特性数组
        })
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user?.id;

        // 检查是否已存在
        const existing = await getExperienceConfig(input.experienceId);
        if (existing) {
          throw new Error("该体验ID已存在");
        }

        await createExperienceConfig(
          {
            experienceId: input.experienceId,
            title: input.title,
            description: input.description || null,
            url: input.url,
            scenarioId: input.scenarioId,
            status: input.status,
            visibility: input.visibility,
            displayOrder: input.displayOrder,
            icon: input.icon || null,
            tag: input.tag || null,
            features: input.features ? JSON.stringify(input.features) : null,
          },
          userId
        );

        const bypass = await ensureIframeBypassExperienceId(input.experienceId, userId);
        const publish = await publishDemoRoutingNow(userId);
        return { success: true, bypass, publish };
      }),

    // 更新配置
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          title: z.string().min(1, "标题不能为空").optional(),
          description: z.string().optional(),
          url: z.string().url("请输入有效的URL地址").optional(),
          scenarioId: z.string().min(1, "场景ID不能为空").optional(),
          status: z.enum(["active", "developing"]).optional(),
          visibility: z.enum(["public", "internal"]).optional(),
          displayOrder: z.number().int().optional(),
          icon: z.string().optional(),
          tag: z.string().optional(),
          features: z.array(z.string()).optional(), // 功能特性数组
        })
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user?.id;
        const { id, features, ...updateData } = input;

        // 处理 features 数组，转换为 JSON 字符串
        const finalUpdateData: any = { ...updateData };
        if (features !== undefined) {
          finalUpdateData.features = features.length > 0 ? JSON.stringify(features) : null;
        }

        await updateExperienceConfig(id, finalUpdateData, userId);

        const allConfigs = await getAllExperienceConfigs("all");
        const updated = (allConfigs as any[]).find((c: any) => c.id === id);
        const bypass = updated?.experienceId
          ? await ensureIframeBypassExperienceId(updated.experienceId, userId)
          : { changed: false };

        const publish = await publishDemoRoutingNow(userId);
        return { success: true, bypass, publish };
      }),

    // 删除配置
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await deleteExperienceConfig(input.id);
        return { success: true };
      }),

    // 手动发布 demo 路由（可用于重试）
    publishRoutes: adminProcedure
      .mutation(async ({ ctx }) => {
        const userId = ctx.user?.id;
        return await publishDemoRoutingNow(userId);
      }),
});
