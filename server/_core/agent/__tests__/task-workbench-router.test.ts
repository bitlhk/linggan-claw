import { afterEach, describe, expect, it, vi } from "vitest";
import {
  routeTaskWorkbenchPrompt,
  routeTaskWorkbenchPromptByRules,
} from "../task-workbench-router";

describe("task workbench router", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("routes greetings to chat", () => {
    const decision = routeTaskWorkbenchPromptByRules({
      prompt: "你好",
      selectedTemplateId: "ai_topic_insight_ppt",
    });

    expect(decision.intent).toBe("chat");
    expect(decision.confidence).toBe("high");
    expect(decision.reply).toContain("任务工作台");
  });

  it("routes explicit PPT requests to the focused template", () => {
    const decision = routeTaskWorkbenchPromptByRules({
      prompt: "请把 Sequoia AI Ascent 2026 的核心观点生成一份 PPT",
      selectedTemplateId: "ai_topic_insight_ppt",
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.selectedTemplateId).toBe("ai_topic_insight_ppt");
    expect(decision.userVisiblePlan).toHaveLength(3);
  });

  it("routes research topics to the selected PPT template", () => {
    const decision = routeTaskWorkbenchPromptByRules({
      prompt: "看下最新的几个 SOTA 开源模型，分析能力差异以及对金融 AI 的影响",
      selectedTemplateId: "ai_topic_insight_ppt",
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.confidence).toBe("medium");
    expect(decision.selectedTemplateId).toBe("ai_topic_insight_ppt");
  });

  it("asks for clarification when research intent has no selected delivery template", () => {
    const decision = routeTaskWorkbenchPromptByRules({
      prompt: "研究一下最新 AI 趋势",
      selectedTemplateId: null,
    });

    expect(decision.intent).toBe("clarify");
    expect(decision.clarifyingQuestion).toContain("生成 PPT");
  });

  it("rejects unsupported execution requests", () => {
    const decision = routeTaskWorkbenchPromptByRules({
      prompt: "帮我买入贵州茅台并发送给客户",
      selectedTemplateId: "ai_topic_insight_ppt",
    });

    expect(decision.intent).toBe("unsupported");
    expect(decision.reply).toContain("不会直接执行");
  });

  it("can run in rules-only mode without calling an LLM", async () => {
    vi.stubEnv("TASK_WORKBENCH_ROUTER_LLM", "false");

    const decision = await routeTaskWorkbenchPrompt({
      prompt: "帮我做一份 AI 产业趋势 PPT",
      selectedTemplateId: "ai_topic_insight_ppt",
    });

    expect(decision.intent).toBe("run_template");
    expect(decision.router?.mode).toBe("rules_only");
  });
});
