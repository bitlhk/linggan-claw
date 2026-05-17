import express from "express";
import http from "http";
import path from "path";
import crypto from "crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import pptxgenjs from "pptxgenjs";
import {
  APP_ROOT,
  buildRuntimeSessionKey,
  requireClawOwner,
  resolveRuntimeAgentId,
  resolveRuntimeWorkspace,
  sanitizeRelPath,
} from "./helpers";
import { buildChatRequestBody, type PermissionProfile } from "./tool_schema";

type PptCreateRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "planned" | "completed" | "error";
  templateId?: string;
  templateName?: string;
  templatePath: string;
  contextPaths: string[];
  instruction: string;
  requestPath?: string;
  outlinePath?: string;
  resultPath?: string;
  resultNotePath?: string;
  outline?: string;
  resultSummary?: string;
  error?: string;
};

type PptBlueprintBullet = {
  text: string;
  citationRefs?: string[];
};

type PptBlueprintSlide = {
  pageNo?: number | string;
  type?: string;
  title: string;
  keyMessage?: string;
  bullets: PptBlueprintBullet[];
  visualIntent?: string;
  visualData?: unknown;
  notes?: string;
};

type PptBlueprint = {
  version?: string;
  title?: string;
  subtitle?: string;
  slides: PptBlueprintSlide[];
};

const MAX_RECORDS = 100;
const PPT_EXT_RE = /\.(pptx|ppt)$/i;
const WIDE_SLIDE = { w: 13.333, h: 7.5 };
const BUILTIN_TEMPLATES = [
  {
    id: "huawei-light",
    name: "Huawei 浅色模板",
    description: "浅色商务汇报风格，适合培训、方案和管理汇报。",
    absPath: path.join(APP_ROOT, "data/office-templates/huawei-light.pptx"),
  },
];

function safeTaskId(input: string) {
  return String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 80) || crypto.randomUUID();
}

function safeFileStem(input: string) {
  return String(input || "ppt-create")
    .replace(/\.[^.]+$/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40) || "ppt-create";
}

function safeRel(input: unknown) {
  const rel = sanitizeRelPath(String(input || ""));
  if (!rel || rel.includes("..")) return null;
  return rel;
}

function safeJoin(workspace: string, relPath: string) {
  const rel = safeRel(relPath);
  if (!rel) return null;
  const abs = path.normalize(path.join(workspace, rel));
  if (!abs.startsWith(workspace + path.sep) && abs !== workspace) return null;
  return abs;
}

function ensurePptRoot(workspace: string) {
  const rootRel = "office/ppt-create";
  const root = path.join(workspace, rootRel);
  mkdirSync(root, { recursive: true });
  return { root, rootRel };
}

function ensureTaskDirs(workspace: string, taskId: string) {
  const safeId = safeTaskId(taskId);
  const relRoot = `office/ppt-create/${safeId}`;
  const absRoot = path.join(workspace, relRoot);
  const inputs = path.join(absRoot, "inputs");
  const outputs = path.join(absRoot, "outputs");
  mkdirSync(inputs, { recursive: true });
  mkdirSync(outputs, { recursive: true });
  return {
    id: safeId,
    relRoot,
    absRoot,
    inputs,
    outputs,
    rel: (name: string) => `${relRoot}/${name}`,
    inputRel: (name: string) => `${relRoot}/inputs/${name}`,
    outputRel: (name: string) => `${relRoot}/outputs/${name}`,
  };
}

function readPptIndex(root: string): PptCreateRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(path.join(root, "index.json"), "utf8") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePptIndex(root: string, records: PptCreateRecord[]) {
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "index.json"), JSON.stringify(records.slice(0, MAX_RECORDS), null, 2), "utf8");
}

function upsertRecord(workspace: string, record: PptCreateRecord) {
  const { root } = ensurePptRoot(workspace);
  const records = readPptIndex(root);
  writePptIndex(root, [record, ...records.filter((item) => item?.id !== record.id)]);
  const taskDirs = ensureTaskDirs(workspace, record.id);
  writeFileSync(path.join(taskDirs.absRoot, "meta.json"), JSON.stringify(record, null, 2), "utf8");
}

function recordForResponse(record: PptCreateRecord, adoptId: string): PptCreateRecord & {
  outlineUrl?: string;
  resultUrl?: string;
  resultNoteUrl?: string;
} {
  const download = (rel?: string) => rel
    ? `/api/claw/workspace/files/download?adoptId=${encodeURIComponent(adoptId)}&path=${encodeURIComponent(rel)}`
    : undefined;
  return {
    ...record,
    outlineUrl: download(record.outlinePath),
    resultUrl: download(record.resultPath),
    resultNoteUrl: download(record.resultNotePath),
  };
}

function resolveTemplateToWorkspace(args: {
  workspace: string;
  taskId: string;
  templateId?: string;
  templatePath?: string;
}) {
  const taskDirs = ensureTaskDirs(args.workspace, args.taskId);
  const templateId = String(args.templateId || "huawei-light").trim();
  if (args.templatePath) {
    const rel = safeRel(args.templatePath);
    if (!rel || !PPT_EXT_RE.test(rel)) throw new Error("模板文件路径无效");
    const abs = safeJoin(args.workspace, rel);
    if (!abs || !existsSync(abs)) throw new Error("模板文件不存在");
    return { templateId: "custom", templateName: path.basename(rel), templatePath: rel };
  }
  const builtin = BUILTIN_TEMPLATES.find((item) => item.id === templateId) || BUILTIN_TEMPLATES[0];
  if (!existsSync(builtin.absPath)) throw new Error(`内置模板不存在: ${builtin.id}`);
  const rel = taskDirs.inputRel(`template-${builtin.id}.pptx`);
  copyFileSync(builtin.absPath, path.join(args.workspace, rel));
  return { templateId: builtin.id, templateName: builtin.name, templatePath: rel };
}

async function callOpenClawOffice(args: {
  claw: any;
  runtimeAgentId: string;
  sessionChannel: string;
  sessionConversationId: string;
  prompt: string;
  brandSystemPrompt: string;
  timeoutMs?: number;
}) {
  const remoteHost = process.env.CLAW_REMOTE_HOST || "127.0.0.1";
  const gatewayPort = parseInt(process.env.CLAW_GATEWAY_PORT || "18789", 10);
  const gatewayToken = process.env.CLAW_GATEWAY_TOKEN || "";
  const sessionKey = buildRuntimeSessionKey({
    runtimeAgentId: args.runtimeAgentId,
    channel: args.sessionChannel,
    conversationId: args.sessionConversationId,
  });
  const rawProfile = String(args.claw?.permissionProfile || "starter");
  const permissionProfile: PermissionProfile =
    rawProfile === "plus" || rawProfile === "internal" ? rawProfile : "starter";
  const body = Buffer.from(JSON.stringify(buildChatRequestBody({
    message: args.prompt,
    permissionProfile,
    brandSystemPrompt: args.brandSystemPrompt,
  })), "utf8");

  return await new Promise<string>((resolve, reject) => {
    const req = http.request({
      hostname: remoteHost,
      port: gatewayPort,
      path: "/v1/chat/completions",
      method: "POST",
      timeout: 0,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": body.length,
        "Authorization": `Bearer ${gatewayToken}`,
        "x-openclaw-agent-id": args.runtimeAgentId,
        "x-openclaw-session-key": sessionKey,
      },
    }, (res) => {
      let buffer = "";
      let out = "";
      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed?.choices?.[0]?.delta?.content || "";
            if (delta) out += delta;
          } catch {}
        }
      });
      res.on("end", () => {
        const text = out.trim();
        if (!text) reject(new Error("OpenClaw 返回结果为空"));
        else resolve(text);
      });
    });
    req.on("error", reject);
    req.setTimeout(args.timeoutMs || 300_000, () => req.destroy(new Error("OpenClaw PPT 处理超时")));
    req.write(body);
    req.end();
  });
}

function buildOutlinePrompt(args: {
  templateName: string;
  templatePath: string;
  contextPaths: string[];
  instruction: string;
  outlinePath: string;
}) {
  return [
    "你是企业办公 PPT 策划助手。请先生成可审核的 PPT 分页大纲，不要生成 PPTX 文件。",
    "",
    "设计原则：",
    "1. 先保证结构清晰、信息准确，再考虑视觉表达。",
    "2. 只基于用户材料和要求生成，不要编造事实。",
    "3. 按模板风格规划内容：标题短、要点少、页面有层次。",
    "4. 每页建议 3-5 个要点，避免长段落。",
    "5. 明确哪些页面需要图表、图片或数据补充。",
    "6. 如果用户要求热点话题、最新趋势、近期事件，且没有上传足够材料，你可以使用可用的网页搜索/网页抓取工具先检索资料；如果当前环境没有搜索工具，请在「需要用户补充的信息」中说明证据不足。",
    "7. 进行热点/最新类搜索时，大纲必须保留来源标题、URL、日期和不确定性，不要把搜索摘要当成已验证事实。",
    "",
    `模板：${args.templateName}`,
    `模板文件：${args.templatePath}`,
    "",
    "输入材料：",
    ...(args.contextPaths.length ? args.contextPaths.map((item) => `- ${item}`) : ["- 无上传材料，仅根据用户要求生成"]),
    "",
    "用户要求：",
    args.instruction || "生成一份 8 页左右的商务汇报 PPT，风格简洁专业。",
    "",
    "请输出 Markdown，固定包含以下章节：",
    "# PPT 大纲",
    "## 任务理解",
    "## 整体结构",
    "## 分页方案",
    "每页用：页码、页面类型、标题、核心内容、视觉建议、备注。",
    "## 需要用户补充的信息",
    "## 生成规则",
    "## PPT_BLUEPRINT_JSON",
    "最后必须追加一个 fenced code block，语言标记必须是 PPT_BLUEPRINT_JSON，供系统生成 PPTX 文件。",
    "JSON 格式：",
    "```PPT_BLUEPRINT_JSON",
    JSON.stringify({
      version: "v1",
      title: "演示文稿标题",
      subtitle: "副标题或使用场景",
      slides: [
        {
          pageNo: 1,
          type: "cover",
          title: "四字标签：清晰观点标题",
          keyMessage: "本页一句话主张",
          bullets: [{ text: "精炼论据或页面内容", citationRefs: [] }],
          visualIntent: "kpi-cards",
          visualData: {
            items: [
              { label: "指标或阶段", value: "数值/状态", note: "简短说明" },
            ],
          },
          notes: "给生成器的版式提醒",
        },
      ],
    }),
    "```",
    "PPT_BLUEPRINT_JSON 规则：",
    "- slides 必须与分页方案逐页一致：页数一致、标题一致、核心观点一致。",
    "- title 要短，优先使用「四字标签：观点」格式。",
    "- bullets 每页 2-5 条，每条要短；不要写长段落。",
    "- visualIntent 从 cover、agenda、content-cards、compare-two-column、process-flow、timeline、matrix-2x2、kpi-cards、bar-chart、table、summary 中选择最接近的一种。",
    "- 如果页面适合图表，必须提供 visualData.items；每个 item 使用 label、value、note 三个字段。",
    "- 涉及热点/最新信息时，bullet 或 note 中保留来源引用线索，不能编造日期、机构或数字。",
    "",
    `同时请把同样内容写入工作空间文件：${args.outlinePath}`,
  ].join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function compactText(value: unknown, max = 180) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeBullet(item: unknown): PptBlueprintBullet | null {
  if (typeof item === "string") {
    const text = compactText(item, 180);
    return text ? { text } : null;
  }
  const record = asRecord(item);
  if (!record) return null;
  const text = compactText(record.text || record.title || record.content || record.point, 180);
  if (!text) return null;
  const citationRefs = Array.isArray(record.citationRefs)
    ? record.citationRefs.map((ref) => compactText(ref, 32)).filter(Boolean)
    : undefined;
  return { text, citationRefs };
}

function findSlideArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return null;
  if (Array.isArray(record.slides)) return record.slides;
  for (const key of ["pptBlueprint", "deckBlueprint", "blueprint", "deck"]) {
    const nested = findSlideArray(record[key]);
    if (nested) return nested;
  }
  return null;
}

function normalizeBlueprint(value: unknown, fallbackTitle: string): PptBlueprint | null {
  const slides = findSlideArray(value);
  if (!slides?.length) return null;
  const record = asRecord(value) || {};
  const normalizedSlides = slides
    .map((item, index): PptBlueprintSlide | null => {
      const slide = asRecord(item);
      if (!slide) return null;
      const title = compactText(slide.title || slide.heading || slide.name || `第 ${index + 1} 页`, 80);
      const rawBullets = Array.isArray(slide.bullets)
        ? slide.bullets
        : Array.isArray(slide.items)
          ? slide.items
          : Array.isArray(slide.points)
            ? slide.points
            : [];
      const bullets = rawBullets.map(normalizeBullet).filter(Boolean) as PptBlueprintBullet[];
      const keyMessage = compactText(slide.keyMessage || slide.message || slide.summary || slide.core || "", 180);
      if (!bullets.length && keyMessage) bullets.push({ text: keyMessage });
      return {
        pageNo: typeof slide.pageNo === "number" || typeof slide.pageNo === "string" ? slide.pageNo : index + 1,
        type: compactText(slide.type || slide.layout || "", 40),
        title,
        keyMessage,
        bullets: bullets.slice(0, 6),
        visualIntent: compactText(slide.visualIntent || slide.visual || slide.layoutHint || "", 60),
        visualData: slide.visualData || slide.data || slide.chartData || slide.itemsData || null,
        notes: compactText(slide.notes || slide.remark || "", 240),
      };
    })
    .filter(Boolean) as PptBlueprintSlide[];
  if (!normalizedSlides.length) return null;
  return {
    version: compactText(record.version || "v1", 20),
    title: compactText(record.title || normalizedSlides[0]?.title || fallbackTitle, 80),
    subtitle: compactText(record.subtitle || record.description || "", 120),
    slides: normalizedSlides.slice(0, 20),
  };
}

function extractBlueprintFromOutline(outline: string, fallbackTitle: string): PptBlueprint | null {
  const fencePattern = /```(?:\s*(?:PPT_BLUEPRINT_JSON|ppt_blueprint_json|json))?\s*\n([\s\S]*?)```/g;
  for (const match of outline.matchAll(fencePattern)) {
    const body = match[1]?.trim();
    if (!body || !/"slides"|"pptBlueprint"|"deckBlueprint"/.test(body)) continue;
    try {
      const parsed = JSON.parse(body);
      const blueprint = normalizeBlueprint(parsed, fallbackTitle);
      if (blueprint) return blueprint;
    } catch {}
  }

  const directJson = outline.match(/\{[\s\S]*"slides"[\s\S]*\}/);
  if (directJson) {
    try {
      const blueprint = normalizeBlueprint(JSON.parse(directJson[0]), fallbackTitle);
      if (blueprint) return blueprint;
    } catch {}
  }
  return null;
}

function fallbackBlueprintFromMarkdown(outline: string, fallbackTitle: string): PptBlueprint {
  const pagePlan = outline.match(/##\s*分页方案([\s\S]*?)(?:\n##\s|$)/)?.[1] || outline;
  const pageSegments = pagePlan.match(/(?:^|\n)#{2,4}\s*第\s*\d+\s*页[\s\S]*?(?=(?:\n#{2,4}\s*第\s*\d+\s*页)|$)/g);
  const segments = (pageSegments?.length ? pageSegments : pagePlan
    .split(/\n(?=(?:#{1,4}\s*)?(?:第\s*\d+\s*页|页码\s*[:：]?\s*\d+))/g))
    .map((item) => item.trim())
    .filter(Boolean);
  const slides = segments
    .map((segment, index): PptBlueprintSlide | null => {
      const lines = segment.split("\n").map((line) => line.trim()).filter(Boolean);
      if (!lines.length) return null;
      const titleLine = lines.find((line) => /^[-*•]\s*标题\s*[:：]/.test(line))
        || lines.find((line) => /^标题\s*[:：]/.test(line))
        || lines[0];
      const title = compactText(titleLine
        .replace(/^#{1,4}\s*/, "")
        .replace(/^(?:第\s*\d+\s*页|页码\s*[:：]?\s*\d+|\d+[.、])\s*[:：-]?/, "")
        .replace(/^[-*•]\s*/, "")
        .replace(/^标题\s*[:：]/, ""), 80);
      const contentStart = lines.findIndex((line) => /^[-*•]\s*核心内容\s*[:：]/.test(line) || /^核心内容\s*[:：]/.test(line));
      const visualLine = lines.find((line) => /^[-*•]\s*视觉建议\s*[:：]/.test(line) || /^视觉建议\s*[:：]/.test(line));
      const contentLines = contentStart >= 0
        ? lines.slice(contentStart + 1)
          .filter((line) => !/^[-*•]\s*(视觉建议|备注)\s*[:：]/.test(line) && !/^(视觉建议|备注)\s*[:：]/.test(line))
        : lines.filter((line) => /^[-*•]\s+/.test(line));
      const bulletLines = contentLines
        .filter((line) => /^[-*•]\s+/.test(line))
        .map((line) => line.replace(/^[-*•]\s+/, "").replace(/^(?:核心内容|要点)\s*[:：]/, ""))
        .map((line) => compactText(line, 160))
        .filter(Boolean)
        .slice(0, 5);
      return {
        pageNo: index + 1,
        title: title || `第 ${index + 1} 页`,
        keyMessage: bulletLines[0] || "",
        bullets: bulletLines.slice(0, 5).map((text) => ({ text })),
        visualIntent: visualLine ? compactText(visualLine, 60) : index === 0 ? "cover" : "content-cards",
      };
    })
    .filter(Boolean) as PptBlueprintSlide[];

  if (slides.length >= 2) return { version: "fallback", title: fallbackTitle, slides: slides.slice(0, 12) };
  return {
    version: "fallback",
    title: fallbackTitle,
    slides: [
      { pageNo: 1, type: "cover", title: fallbackTitle, keyMessage: "基于用户要求生成的商务汇报", bullets: [], visualIntent: "cover" },
      { pageNo: 2, type: "agenda", title: "汇报结构", bullets: [{ text: "背景与目标" }, { text: "核心分析" }, { text: "行动建议" }], visualIntent: "agenda" },
      { pageNo: 3, title: "核心内容", keyMessage: compactText(outline, 180), bullets: [{ text: compactText(outline, 180) }], visualIntent: "content-cards" },
      { pageNo: 4, title: "下一步动作", bullets: [{ text: "补充关键数据和案例" }, { text: "确认行动计划与负责人" }, { text: "形成最终汇报版本" }], visualIntent: "summary" },
    ],
  };
}

function resolveBlueprint(outline: string, fallbackTitle: string): PptBlueprint {
  return extractBlueprintFromOutline(outline, fallbackTitle) || fallbackBlueprintFromMarkdown(outline, fallbackTitle);
}

function splitTitle(title: string) {
  const parts = title.split(/[:：]/);
  if (parts.length >= 2 && parts[0] && parts.slice(1).join("：")) {
    return { label: compactText(parts[0], 12), main: compactText(parts.slice(1).join("："), 72) };
  }
  return { label: "", main: compactText(title, 72) };
}

function slideKind(slide: PptBlueprintSlide, index: number, total: number) {
  const intent = `${slide.type || ""} ${slide.visualIntent || ""} ${slide.title || ""}`.toLowerCase();
  if (index === 0 || /cover|封面/.test(intent)) return "cover";
  if (/agenda|目录/.test(intent)) return "agenda";
  if (/summary|结论|总结|结束/.test(intent)) return "summary";
  if (/kpi|metric|number|数字|指标/.test(intent)) return "kpi";
  if (/timeline|roadmap|时间轴|里程碑|路线图/.test(intent)) return "timeline";
  if (/matrix|2x2|四象限|矩阵|swot/.test(intent)) return "matrix";
  if (/bar-chart|bar|柱状|条形/.test(intent)) return "bar";
  if (/compare|two-column|对比|as-is|to-be/.test(intent)) return "compare";
  if (/process|flow|timeline|步骤|流程|路径|计划/.test(intent)) return "process";
  if (/table|matrix|表格|矩阵/.test(intent)) return "table";
  return "content";
}

function addFooter(slide: any, pageNo: number, total: number, theme: { muted: string; accent: string }) {
  slide.addShape("line", { x: 0.6, y: 7.03, w: 12.1, h: 0, line: { color: "E5E7EB", width: 0.8 } });
  slide.addText(`${pageNo}/${total}`, { x: 11.65, y: 7.08, w: 0.95, h: 0.2, fontFace: "Microsoft YaHei", fontSize: 8, color: theme.muted, align: "right" });
  slide.addShape("rect", { x: 0.6, y: 7.1, w: 0.25, h: 0.05, fill: { color: theme.accent }, line: { color: theme.accent } });
}

function addSlideTitle(slide: any, item: PptBlueprintSlide, theme: { text: string; muted: string; accent: string }) {
  const title = splitTitle(item.title);
  if (title.label) {
    slide.addText(title.label, { x: 0.75, y: 0.42, w: 1.2, h: 0.28, fontFace: "Microsoft YaHei", fontSize: 9, bold: true, color: "FFFFFF", margin: 0.04, align: "center", fill: { color: theme.accent }, breakLine: false });
    slide.addText(title.main, { x: 2.1, y: 0.36, w: 10.2, h: 0.45, fontFace: "Microsoft YaHei", fontSize: 21, bold: true, color: theme.text, fit: "shrink" });
  } else {
    slide.addText(title.main, { x: 0.75, y: 0.34, w: 11.6, h: 0.52, fontFace: "Microsoft YaHei", fontSize: 22, bold: true, color: theme.text, fit: "shrink" });
  }
  if (item.keyMessage) {
    slide.addText(item.keyMessage, { x: 0.77, y: 0.96, w: 11.75, h: 0.32, fontFace: "Microsoft YaHei", fontSize: 10, color: theme.muted, fit: "shrink" });
  }
}

function displayBullets(slide: PptBlueprintSlide, fallback = "待补充") {
  const rows = slide.bullets?.length ? slide.bullets : [{ text: slide.keyMessage || fallback }];
  const seen = new Set<string>();
  const normalizedKey = compactText(slide.keyMessage, 180);
  return rows.filter((item, index) => {
    const text = compactText(item.text, 180);
    if (!text) return false;
    if (index === 0 && normalizedKey && text === normalizedKey && rows.length > 1) return false;
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

function bulletText(slide: PptBlueprintSlide, fallback = "待补充") {
  const rows = displayBullets(slide, fallback);
  return rows.slice(0, 5).map((item) => `• ${compactText(item.text, 95)}`).join("\n");
}

function visualItems(slide: PptBlueprintSlide, fallback = "待补充") {
  const data = asRecord(slide.visualData);
  const candidates = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.metrics)
      ? data.metrics
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(slide.visualData)
          ? slide.visualData
          : [];
  const rows = candidates
    .map((item, index) => {
      if (typeof item === "string") {
        return { label: `项 ${index + 1}`, value: compactText(item, 48), note: "" };
      }
      const row = asRecord(item);
      if (!row) return null;
      const label = compactText(row.label || row.name || row.title || row.stage || row.category || `项 ${index + 1}`, 42);
      const value = compactText(row.value || row.metric || row.amount || row.status || row.date || "", 42);
      const note = compactText(row.note || row.desc || row.description || row.text || row.detail || "", 92);
      return label || value || note ? { label, value, note } : null;
    })
    .filter(Boolean) as Array<{ label: string; value: string; note: string }>;
  if (rows.length) return rows.slice(0, 8);
  return displayBullets(slide, fallback).map((item, index) => ({
    label: `要点 ${index + 1}`,
    value: "",
    note: compactText(item.text, 92),
  })).slice(0, 8);
}

function numericValue(value: string, fallback: number) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return fallback;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function generatePptxFromBlueprint(args: {
  blueprint: PptBlueprint;
  outputAbs: string;
  templateName: string;
  templatePath: string;
  instruction: string;
}) {
  const PptxGen = ((pptxgenjs as any).default || pptxgenjs) as any;
  const pptx = new PptxGen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Linggan Employee Agent";
  pptx.company = "Linggan";
  pptx.subject = args.instruction || args.blueprint.title || "PPT 制作";
  pptx.title = args.blueprint.title || "PPT 制作";
  pptx.theme = {
    headFontFace: "Microsoft YaHei",
    bodyFontFace: "Microsoft YaHei",
  };

  const theme = {
    bg: "F8FAFC",
    panel: "FFFFFF",
    text: "111827",
    muted: "64748B",
    accent: /huawei/i.test(args.templatePath) || /huawei|华为/i.test(args.templateName) ? "C7000B" : "2563EB",
    accent2: "0F766E",
    pale: "F1F5F9",
    border: "E5E7EB",
  };
  const slides = args.blueprint.slides.slice(0, 20);
  const total = slides.length;

  slides.forEach((item, index) => {
    const kind = slideKind(item, index, total);
    const slide: any = pptx.addSlide();
    slide.background = { color: kind === "cover" ? theme.panel : theme.bg };

    if (kind === "cover") {
      slide.addShape("rect", { x: 0, y: 0, w: 0.16, h: WIDE_SLIDE.h, fill: { color: theme.accent }, line: { color: theme.accent } });
      slide.addShape("rect", { x: 0.6, y: 0.72, w: 1.0, h: 0.08, fill: { color: theme.accent }, line: { color: theme.accent } });
      const title = splitTitle(item.title || args.blueprint.title || "PPT 制作");
      slide.addText(title.label || "汇报材料", { x: 0.72, y: 1.25, w: 2.2, h: 0.36, fontFace: "Microsoft YaHei", fontSize: 13, bold: true, color: theme.accent });
      slide.addText(title.main || args.blueprint.title || "PPT 制作", { x: 0.72, y: 1.7, w: 10.8, h: 0.95, fontFace: "Microsoft YaHei", fontSize: 34, bold: true, color: theme.text, fit: "shrink" });
      slide.addText(args.blueprint.subtitle || item.keyMessage || "由灵感员工智能体生成", { x: 0.75, y: 2.82, w: 9.8, h: 0.36, fontFace: "Microsoft YaHei", fontSize: 13, color: theme.muted, fit: "shrink" });
      if (item.bullets.length) {
        slide.addText(bulletText(item), { x: 0.78, y: 4.2, w: 8.5, h: 1.4, fontFace: "Microsoft YaHei", fontSize: 14, color: theme.text, breakLine: false, fit: "shrink" });
      }
      slide.addShape("rect", { x: 9.4, y: 4.2, w: 2.8, h: 1.5, rectRadius: 0.08, fill: { color: theme.pale }, line: { color: theme.border } });
      slide.addText("AI 生成初稿\n请人工复核数据与表述", { x: 9.65, y: 4.55, w: 2.3, h: 0.7, fontFace: "Microsoft YaHei", fontSize: 11, color: theme.muted, align: "center", valign: "mid" });
      addFooter(slide, index + 1, total, theme);
      return;
    }

    addSlideTitle(slide, item, theme);
    const y0 = item.keyMessage ? 1.48 : 1.28;

    if (kind === "agenda") {
      const rows = item.bullets.length ? displayBullets(item) : slides.slice(1).map((s) => ({ text: s.title }));
      rows.slice(0, 8).forEach((row, i) => {
        const y = y0 + i * 0.58;
        slide.addShape("ellipse", { x: 1.0, y, w: 0.32, h: 0.32, fill: { color: theme.accent }, line: { color: theme.accent } });
        slide.addText(String(i + 1).padStart(2, "0"), { x: 1.43, y: y - 0.02, w: 0.55, h: 0.26, fontFace: "Aptos", fontSize: 9, bold: true, color: theme.accent });
        slide.addText(compactText(row.text, 72), { x: 2.05, y: y - 0.04, w: 9.5, h: 0.34, fontFace: "Microsoft YaHei", fontSize: 15, color: theme.text, fit: "shrink" });
      });
    } else if (kind === "kpi") {
      const rows = visualItems(item, item.title).slice(0, 6);
      rows.forEach((row, i) => {
        const col = i % 3;
        const r = Math.floor(i / 3);
        const x = 0.82 + col * 4.0;
        const y = y0 + r * 1.72;
        slide.addShape("rect", { x, y, w: 3.55, h: 1.28, rectRadius: 0.08, fill: { color: theme.panel }, line: { color: theme.border } });
        slide.addShape("rect", { x, y, w: 0.08, h: 1.28, fill: { color: i % 2 ? theme.accent2 : theme.accent }, line: { color: i % 2 ? theme.accent2 : theme.accent } });
        slide.addText(row.value || String(i + 1).padStart(2, "0"), { x: x + 0.28, y: y + 0.18, w: 1.6, h: 0.32, fontFace: "Aptos", fontSize: 19, bold: true, color: i % 2 ? theme.accent2 : theme.accent, fit: "shrink" });
        slide.addText(row.label, { x: x + 0.3, y: y + 0.58, w: 2.85, h: 0.24, fontFace: "Microsoft YaHei", fontSize: 10.5, bold: true, color: theme.text, fit: "shrink" });
        slide.addText(row.note, { x: x + 0.3, y: y + 0.88, w: 2.88, h: 0.24, fontFace: "Microsoft YaHei", fontSize: 8.5, color: theme.muted, fit: "shrink" });
      });
    } else if (kind === "timeline") {
      const rows = visualItems(item, item.title).slice(0, 6);
      const baseY = y0 + 1.8;
      slide.addShape("line", { x: 1.0, y: baseY, w: 11.1, h: 0, line: { color: theme.border, width: 2 } });
      rows.forEach((row, i) => {
        const step = rows.length > 1 ? 10.6 / (rows.length - 1) : 0;
        const x = 0.95 + i * step;
        const up = i % 2 === 0;
        slide.addShape("ellipse", { x, y: baseY - 0.15, w: 0.3, h: 0.3, fill: { color: i % 2 ? theme.accent2 : theme.accent }, line: { color: "FFFFFF", width: 1 } });
        slide.addShape("line", { x: x + 0.15, y: up ? baseY - 1.05 : baseY + 0.18, w: 0, h: 0.86, line: { color: theme.border, width: 1 } });
        slide.addShape("rect", { x: Math.max(0.62, x - 0.62), y: up ? baseY - 1.65 : baseY + 0.78, w: 1.55, h: 0.78, rectRadius: 0.05, fill: { color: theme.panel }, line: { color: theme.border } });
        slide.addText(row.value || row.label, { x: Math.max(0.72, x - 0.52), y: up ? baseY - 1.5 : baseY + 0.92, w: 1.32, h: 0.2, fontFace: "Microsoft YaHei", fontSize: 8.5, bold: true, color: i % 2 ? theme.accent2 : theme.accent, align: "center", fit: "shrink" });
        slide.addText(row.note || row.label, { x: Math.max(0.72, x - 0.52), y: up ? baseY - 1.24 : baseY + 1.18, w: 1.32, h: 0.28, fontFace: "Microsoft YaHei", fontSize: 7.5, color: theme.text, align: "center", fit: "shrink" });
      });
    } else if (kind === "matrix") {
      const rows = visualItems(item, item.title).slice(0, 4);
      const labels = ["重点突破", "持续优化", "观察验证", "暂缓投入"];
      rows.concat(labels.slice(rows.length).map((label) => ({ label, value: "", note: "" }))).slice(0, 4).forEach((row, i) => {
        const col = i % 2;
        const r = Math.floor(i / 2);
        const x = 1.02 + col * 5.55;
        const y = y0 + r * 2.0;
        const color = i === 0 ? theme.accent : i === 1 ? theme.accent2 : theme.muted;
        slide.addShape("rect", { x, y, w: 5.15, h: 1.55, rectRadius: 0.06, fill: { color: theme.panel }, line: { color: theme.border } });
        slide.addText(row.label, { x: x + 0.28, y: y + 0.24, w: 4.4, h: 0.28, fontFace: "Microsoft YaHei", fontSize: 13, bold: true, color, fit: "shrink" });
        slide.addText(row.value || row.note, { x: x + 0.28, y: y + 0.66, w: 4.45, h: 0.42, fontFace: "Microsoft YaHei", fontSize: 10, color: theme.text, fit: "shrink" });
      });
      slide.addText("高影响", { x: 0.8, y: y0 - 0.25, w: 1.0, h: 0.18, fontSize: 8, color: theme.muted });
      slide.addText("低确定性", { x: 0.18, y: y0 + 3.4, w: 0.8, h: 0.18, rotate: 270, fontSize: 8, color: theme.muted });
    } else if (kind === "bar") {
      const rows = visualItems(item, item.title).slice(0, 6);
      const values = rows.map((row, i) => Math.max(0, numericValue(row.value, rows.length - i)));
      const max = Math.max(...values, 1);
      rows.forEach((row, i) => {
        const y = y0 + 0.35 + i * 0.62;
        const width = 7.4 * (values[i] / max);
        slide.addText(row.label, { x: 0.9, y: y - 0.02, w: 2.5, h: 0.22, fontFace: "Microsoft YaHei", fontSize: 9.5, color: theme.text, fit: "shrink" });
        slide.addShape("rect", { x: 3.65, y, w: 7.55, h: 0.22, rectRadius: 0.03, fill: { color: "E2E8F0" }, line: { color: "E2E8F0" } });
        slide.addShape("rect", { x: 3.65, y, w: Math.max(0.12, width), h: 0.22, rectRadius: 0.03, fill: { color: i % 2 ? theme.accent2 : theme.accent }, line: { color: i % 2 ? theme.accent2 : theme.accent } });
        slide.addText(row.value || String(values[i]), { x: 11.35, y: y - 0.03, w: 0.85, h: 0.2, fontFace: "Aptos", fontSize: 8.5, bold: true, color: theme.muted, align: "right" });
      });
    } else if (kind === "compare") {
      const rows = displayBullets(item, item.title);
      const left = rows.filter((_, i) => i % 2 === 0);
      const right = rows.filter((_, i) => i % 2 === 1);
      [
        { x: 0.85, title: "现状 / 依据", data: left.length ? left : rows.slice(0, 3), color: theme.accent },
        { x: 6.95, title: "目标 / 建议", data: right.length ? right : rows.slice(3), color: theme.accent2 },
      ].forEach((col) => {
        slide.addShape("rect", { x: col.x, y: y0, w: 5.55, h: 4.75, rectRadius: 0.06, fill: { color: theme.panel }, line: { color: theme.border } });
        slide.addText(col.title, { x: col.x + 0.28, y: y0 + 0.25, w: 4.8, h: 0.35, fontFace: "Microsoft YaHei", fontSize: 14, bold: true, color: col.color });
        slide.addText(col.data.slice(0, 4).map((r) => `• ${compactText(r.text, 75)}`).join("\n"), { x: col.x + 0.35, y: y0 + 0.88, w: 4.85, h: 3.2, fontFace: "Microsoft YaHei", fontSize: 12, color: theme.text, breakLine: false, fit: "shrink" });
      });
    } else if (kind === "process") {
      const rows = displayBullets(item, item.title).slice(0, 5);
      rows.forEach((row, i) => {
        const w = 10.8 / rows.length;
        const x = 0.95 + i * w;
        slide.addShape("rect", { x, y: y0 + 1.2, w: w - 0.18, h: 1.3, rectRadius: 0.08, fill: { color: theme.panel }, line: { color: i % 2 ? theme.accent2 : theme.accent, width: 1.1 } });
        slide.addText(String(i + 1), { x: x + 0.2, y: y0 + 1.38, w: 0.35, h: 0.3, fontFace: "Aptos", fontSize: 13, bold: true, color: i % 2 ? theme.accent2 : theme.accent });
        slide.addText(compactText(row.text, 52), { x: x + 0.2, y: y0 + 1.82, w: w - 0.55, h: 0.42, fontFace: "Microsoft YaHei", fontSize: 11, color: theme.text, fit: "shrink" });
        if (i < rows.length - 1) slide.addText("→", { x: x + w - 0.12, y: y0 + 1.68, w: 0.25, h: 0.2, fontSize: 14, color: theme.muted });
      });
    } else if (kind === "table") {
      const rows = displayBullets(item, item.title).slice(0, 5);
      const tableRows = [["维度", "要点"], ...rows.map((row, i) => [`${i + 1}`, compactText(row.text, 88)])];
      slide.addTable(tableRows, {
        x: 0.85,
        y: y0,
        w: 11.7,
        h: 4.55,
        border: { type: "solid", color: theme.border, pt: 1 },
        fontFace: "Microsoft YaHei",
        fontSize: 11,
        color: theme.text,
        fill: { color: theme.panel },
        margin: 0.08,
        autoFit: true,
        valign: "mid",
      });
    } else {
      const rows = displayBullets(item, item.title).slice(0, 6);
      rows.forEach((row, i) => {
        const col = i % 2;
        const r = Math.floor(i / 2);
        const x = 0.85 + col * 5.95;
        const y = y0 + r * 1.28;
        slide.addShape("rect", { x, y, w: 5.55, h: 0.96, rectRadius: 0.06, fill: { color: theme.panel }, line: { color: theme.border } });
        slide.addShape("rect", { x, y, w: 0.08, h: 0.96, fill: { color: i % 2 ? theme.accent2 : theme.accent }, line: { color: i % 2 ? theme.accent2 : theme.accent } });
        slide.addText(compactText(row.text, 92), { x: x + 0.28, y: y + 0.17, w: 4.95, h: 0.5, fontFace: "Microsoft YaHei", fontSize: 12, color: theme.text, fit: "shrink" });
      });
    }

    addFooter(slide, index + 1, total, theme);
  });

  await pptx.writeFile({ fileName: args.outputAbs, compression: true });
}

function buildResultSummary(args: {
  blueprint: PptBlueprint;
  templateName: string;
  templatePath: string;
  resultPath: string;
  resultNotePath: string;
}) {
  const titles = args.blueprint.slides.map((slide, index) => `${index + 1}. ${slide.title}`).join("\n");
  return [
    "# PPT 生成说明",
    "",
    `- 生成页数：${args.blueprint.slides.length}`,
    `- 使用模板：${args.templateName}`,
    `- 模板文件：${args.templatePath}`,
    `- 输出文件：${args.resultPath}`,
    `- 说明文件：${args.resultNotePath}`,
    "",
    "## 生成方式",
    "",
    "OpenClaw 负责生成可审核的 PPT 大纲和 PPT_BLUEPRINT_JSON；employee-agent 使用固定商务版式生成 PPTX。",
    "",
    "## 页面清单",
    "",
    titles,
    "",
    "## 当前限制",
    "",
    "- 第一版优先保证结构、标题、要点和可下载文件稳定。",
    "- 复杂图表、品牌母版精确复刻和动画效果暂未自动生成，需要人工进一步美化。",
  ].join("\n");
}

export function registerOfficePptRoutes(app: express.Express) {
  app.get("/api/claw/office/ppt-create/templates", async (_req, res) => {
    res.json({
      templates: BUILTIN_TEMPLATES.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        available: existsSync(item.absPath),
      })),
    });
  });

  app.get("/api/claw/office/ppt-create/list", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const workspace = resolveRuntimeWorkspace(claw, adoptId);
      const { root } = ensurePptRoot(workspace);
      res.json({ records: readPptIndex(root).map((record) => recordForResponse(record, adoptId)) });
    } catch (err: any) {
      console.error("[office-ppt] list error:", err);
      res.status(500).json({ error: err.message || "list failed" });
    }
  });

  app.post("/api/claw/office/ppt-create/outline", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || req.headers["x-adopt-id"] || "").trim();
      const body = (req.body || {}) as any;
      const taskId = safeTaskId(String(body.taskId || crypto.randomUUID()));
      const contextPaths = Array.isArray(body.contextPaths)
        ? body.contextPaths.map(safeRel).filter(Boolean) as string[]
        : [];
      const instruction = String(body.instruction || "").trim().slice(0, 5000);
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      const workspace = resolveRuntimeWorkspace(claw, adoptId);
      for (const rel of contextPaths) {
        const abs = safeJoin(workspace, rel);
        if (!abs || !existsSync(abs)) return res.status(404).json({ error: `材料不存在: ${rel}` });
      }
      const template = resolveTemplateToWorkspace({
        workspace,
        taskId,
        templateId: String(body.templateId || "huawei-light"),
        templatePath: String(body.templatePath || ""),
      });
      const runtimeAgentId = resolveRuntimeAgentId(adoptId, String((claw as any).agentId || ""));
      const taskDirs = ensureTaskDirs(workspace, taskId);
      const createdAt = new Date().toISOString();
      const requestPath = taskDirs.rel("request.md");
      const outlinePath = taskDirs.outputRel("outline.md");
      const title = `${safeFileStem(instruction.split(/[，。,.!?！？\n]/)[0] || template.templateName || "PPT")} 制作`;
      writeFileSync(path.join(workspace, requestPath), [
        `# ${title}`,
        "",
        `- 时间：${createdAt}`,
        `- 模板：${template.templateName}`,
        `- 模板文件：${template.templatePath}`,
        ...contextPaths.map((item) => `- 材料：${item}`),
        "",
        "## 制作要求",
        "",
        instruction || "生成一份商务汇报 PPT。",
        "",
      ].join("\n"), "utf8");

      const outline = await callOpenClawOffice({
        claw,
        runtimeAgentId,
        sessionChannel: "office-ppt-outline",
        sessionConversationId: taskId,
        prompt: buildOutlinePrompt({ ...template, contextPaths, instruction, outlinePath }),
        brandSystemPrompt: "你是企业 PPT 策划助手，负责把资料和用户要求变成清晰、可审核的分页大纲。",
      });
      writeFileSync(path.join(workspace, outlinePath), `${outline}\n`, "utf8");
      const record: PptCreateRecord = {
        id: taskId,
        title,
        createdAt,
        updatedAt: new Date().toISOString(),
        status: "planned",
        ...template,
        contextPaths,
        instruction,
        requestPath,
        outlinePath,
        outline,
      };
      upsertRecord(workspace, record);
      res.json({ record: recordForResponse(record, adoptId) });
    } catch (err: any) {
      console.error("[office-ppt] outline error:", err);
      res.status(500).json({ error: err.message || "PPT 大纲生成失败" });
    }
  });

  app.post("/api/claw/office/ppt-create/apply", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || req.headers["x-adopt-id"] || "").trim();
      const taskId = safeTaskId(String((req.body as any)?.taskId || ""));
      if (!adoptId) return res.status(400).json({ error: "adoptId required" });
      if (!taskId) return res.status(400).json({ error: "taskId required" });
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const workspace = resolveRuntimeWorkspace(claw, adoptId);
      const { root } = ensurePptRoot(workspace);
      const records = readPptIndex(root);
      const record = records.find((item) => item?.id === taskId);
      if (!record) return res.status(404).json({ error: "PPT 任务不存在" });
      if (!record.outline) return res.status(400).json({ error: "请先生成 PPT 大纲" });

      const taskDirs = ensureTaskDirs(workspace, taskId);
      const resultPath = taskDirs.outputRel("slides.pptx");
      const resultNotePath = taskDirs.outputRel("ppt-result.md");
      const blueprint = resolveBlueprint(record.outline, record.title || "PPT 制作");
      await generatePptxFromBlueprint({
        blueprint,
        outputAbs: path.join(workspace, resultPath),
        templateName: record.templateName || "PPT 模板",
        templatePath: record.templatePath,
        instruction: record.instruction || "",
      });
      const resultSummary = buildResultSummary({
        blueprint,
        templateName: record.templateName || "PPT 模板",
        templatePath: record.templatePath,
        resultPath,
        resultNotePath,
      });
      writeFileSync(path.join(workspace, resultNotePath), `${resultSummary}\n`, "utf8");
      const resultAbs = path.join(workspace, resultPath);
      const nextRecord: PptCreateRecord = {
        ...record,
        updatedAt: new Date().toISOString(),
        status: "completed",
        resultPath: existsSync(resultAbs) ? resultPath : undefined,
        resultNotePath,
        resultSummary,
      };
      if (!nextRecord.resultPath) throw new Error("PPTX 文件生成失败");
      upsertRecord(workspace, nextRecord);
      res.json({ record: recordForResponse(nextRecord, adoptId) });
    } catch (err: any) {
      console.error("[office-ppt] apply error:", err);
      res.status(500).json({ error: err.message || "PPT 生成失败" });
    }
  });
}
