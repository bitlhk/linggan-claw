import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Clipboard, Download, FileText, History, Plus, Presentation, Send, Upload, Wand2, X } from "lucide-react";

type PptCreatePageProps = {
  adoptId: string;
  onBack?: () => void;
};

type UploadedOfficeFile = {
  name: string;
  path: string;
  size: number;
};

type PptTemplate = {
  id: string;
  name: string;
  description: string;
  available: boolean;
};

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
  outlinePath?: string;
  resultPath?: string;
  resultNotePath?: string;
  outline?: string;
  resultSummary?: string;
  outlineUrl?: string;
  resultUrl?: string;
  resultNoteUrl?: string;
};

type PptStatus = "idle" | "uploading" | "planning" | "applying" | "error";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const TEMPLATE_ACCEPT = ".pptx,.ppt";
const MATERIAL_ACCEPT = ".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,image/*";
const QUICK_REQUIREMENTS = [
  "生成 8 页商务汇报 PPT，结构清楚，适合向领导汇报。",
  "生成培训课件，包含目标、知识点、案例、练习和总结。",
  "生成项目方案，包含背景、目标、路径、计划、风险和资源需求。",
  "生成客户拜访汇报，突出客户需求、方案价值、下一步动作。",
];

function makeTaskId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.split(",").pop() || "" : value);
    };
    reader.onerror = () => reject(reader.error || new Error("read file failed"));
    reader.readAsDataURL(file);
  });
}

function buildMarkdown(record: PptCreateRecord) {
  return [
    `# ${record.title || "PPT 制作"}`,
    "",
    `- 时间：${new Date(record.createdAt).toLocaleString()}`,
    `- 模板：${record.templateName || record.templatePath}`,
    ...(record.contextPaths || []).map((item) => `- 材料：${item}`),
    "",
    "## 制作要求",
    "",
    record.instruction || "暂无",
    "",
    "## PPT 大纲",
    "",
    record.outline || "暂无",
    "",
    "## 生成结果",
    "",
    record.resultSummary || "暂无",
    "",
  ].join("\n");
}

export function PptCreatePage({ adoptId, onBack }: PptCreatePageProps) {
  const [taskId, setTaskId] = useState(makeTaskId);
  const [status, setStatus] = useState<PptStatus>("idle");
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<PptTemplate[]>([]);
  const [templateId, setTemplateId] = useState("huawei-light");
  const [customTemplate, setCustomTemplate] = useState<UploadedOfficeFile | null>(null);
  const [materials, setMaterials] = useState<UploadedOfficeFile[]>([]);
  const [instruction, setInstruction] = useState("");
  const [current, setCurrent] = useState<PptCreateRecord | null>(null);
  const [records, setRecords] = useState<PptCreateRecord[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");

  const templateInputRef = useRef<HTMLInputElement | null>(null);
  const materialInputRef = useRef<HTMLInputElement | null>(null);
  const instructionInputRef = useRef<HTMLTextAreaElement | null>(null);

  const busy = status === "uploading" || status === "planning" || status === "applying";

  const filteredRecords = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return records;
    return records.filter((item) => [
      item.title,
      item.templateName,
      item.instruction,
      item.outline,
      item.resultSummary,
    ].some((value) => String(value || "").toLowerCase().includes(q)));
  }, [historyQuery, records]);

  const loadTemplates = useCallback(async () => {
    try {
      const resp = await fetch("/api/claw/office/ppt-create/templates", { credentials: "include" });
      if (!resp.ok) return;
      const data = await resp.json();
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch {}
  }, []);

  const loadRecords = useCallback(async () => {
    if (!adoptId) return;
    try {
      const resp = await fetch(`/api/claw/office/ppt-create/list?adoptId=${encodeURIComponent(adoptId)}`, { credentials: "include" });
      if (!resp.ok) return;
      const data = await resp.json();
      setRecords(Array.isArray(data.records) ? data.records : []);
    } catch {}
  }, [adoptId]);

  useEffect(() => {
    void loadTemplates();
    void loadRecords();
  }, [loadRecords, loadTemplates]);

  const uploadToWorkspace = useCallback(async (file: File): Promise<UploadedOfficeFile> => {
    if (file.size <= 0) throw new Error("文件为空");
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("文件超过 10MB，请先压缩或拆分");
    const contentBase64 = await fileToBase64(file);
    const resp = await fetch("/api/claw/files/upload", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adoptId,
        path: `office/ppt-create/${taskId}/inputs`,
        filename: file.name,
        contentBase64,
      }),
    });
    if (!resp.ok) {
      const payload = await resp.json().catch(() => ({}));
      throw new Error(payload.error || `上传失败 (${resp.status})`);
    }
    const payload = await resp.json();
    return { name: file.name, path: payload.path, size: Number(payload.size || file.size) };
  }, [adoptId, taskId]);

  const handleCustomTemplate = useCallback(async (file: File) => {
    if (busy) return;
    setStatus("uploading");
    setError("");
    try {
      const uploaded = await uploadToWorkspace(file);
      setCustomTemplate(uploaded);
      setTemplateId("custom");
      setCurrent(null);
      setStatus("idle");
    } catch (err: any) {
      setError(err?.message || String(err));
      setStatus("error");
    }
  }, [busy, uploadToWorkspace]);

  const handleMaterials = useCallback(async (files: File[]) => {
    if (busy || files.length === 0) return;
    setStatus("uploading");
    setError("");
    try {
      const uploaded: UploadedOfficeFile[] = [];
      for (const file of files) uploaded.push(await uploadToWorkspace(file));
      setMaterials((prev) => [...prev, ...uploaded].slice(0, 16));
      setCurrent(null);
      setStatus("idle");
    } catch (err: any) {
      setError(err?.message || String(err));
      setStatus("error");
    }
  }, [busy, uploadToWorkspace]);

  const startNewTask = useCallback(() => {
    if (busy) return;
    setTaskId(makeTaskId());
    setStatus("idle");
    setError("");
    setCustomTemplate(null);
    setTemplateId("huawei-light");
    setMaterials([]);
    setInstruction("");
    setCurrent(null);
  }, [busy]);

  const selectRecord = useCallback((record: PptCreateRecord) => {
    setCurrent(record);
    setTaskId(record.id);
    setTemplateId(record.templateId || "huawei-light");
    setCustomTemplate(record.templateId === "custom" ? { name: record.templateName || "模板.pptx", path: record.templatePath, size: 0 } : null);
    setMaterials((record.contextPaths || []).map((item) => ({ name: item.split("/").pop() || item, path: item, size: 0 })));
    setInstruction(record.instruction || "");
    setStatus("idle");
    setError("");
    setHistoryOpen(false);
  }, []);

  const createOutline = useCallback(async () => {
    if (busy) return;
    setStatus("planning");
    setError("");
    try {
      const resp = await fetch(`/api/claw/office/ppt-create/outline?adoptId=${encodeURIComponent(adoptId)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          templateId,
          templatePath: templateId === "custom" ? customTemplate?.path : "",
          contextPaths: materials.map((item) => item.path),
          instruction,
        }),
      });
      if (!resp.ok) {
        const payload = await resp.json().catch(() => ({}));
        throw new Error(payload.error || `生成 PPT 大纲失败 (${resp.status})`);
      }
      const payload = await resp.json();
      const record = payload.record as PptCreateRecord;
      setCurrent(record);
      setRecords((prev) => [record, ...prev.filter((item) => item.id !== record.id)].slice(0, 100));
      setStatus("idle");
      void loadRecords();
    } catch (err: any) {
      setError(err?.message || String(err));
      setStatus("error");
    }
  }, [adoptId, busy, customTemplate?.path, instruction, loadRecords, materials, taskId, templateId]);

  const applyOutline = useCallback(async () => {
    if (!current || busy) return;
    setStatus("applying");
    setError("");
    try {
      const resp = await fetch(`/api/claw/office/ppt-create/apply?adoptId=${encodeURIComponent(adoptId)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: current.id }),
      });
      if (!resp.ok) {
        const payload = await resp.json().catch(() => ({}));
        throw new Error(payload.error || `生成 PPT 失败 (${resp.status})`);
      }
      const payload = await resp.json();
      const record = payload.record as PptCreateRecord;
      setCurrent(record);
      setRecords((prev) => [record, ...prev.filter((item) => item.id !== record.id)].slice(0, 100));
      setStatus("idle");
      void loadRecords();
    } catch (err: any) {
      setError(err?.message || String(err));
      setStatus("error");
    }
  }, [adoptId, busy, current, loadRecords]);

  const copyCurrent = useCallback(async () => {
    if (!current) return;
    await navigator.clipboard.writeText(buildMarkdown(current));
  }, [current]);

  const useQuickRequirement = useCallback((text: string) => {
    if (busy) return;
    setInstruction(text);
    window.setTimeout(() => instructionInputRef.current?.focus(), 0);
  }, [busy]);

  return (
    <main className="h-full min-h-0 overflow-y-auto stealth-scrollbar" style={{ background: "var(--oc-bg)", color: "var(--oc-text-primary)" }}>
      <div className="max-w-6xl mx-auto px-5 py-5 space-y-4">
        <section className="settings-card" style={{ padding: 18 }}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {onBack ? (
                  <button type="button" onClick={onBack} title="返回办公空间" className="inline-flex items-center justify-center rounded-md p-1.5" style={{ color: "var(--oc-text-secondary)", border: "1px solid var(--oc-border)", background: "var(--oc-panel)" }}>
                    <ArrowLeft size={15} />
                  </button>
                ) : null}
                <Presentation size={18} style={{ color: "var(--oc-accent)" }} />
                <h2 className="text-base font-semibold">PPT 制作</h2>
              </div>
              <p className="mt-2 text-sm leading-6" style={{ color: "var(--oc-text-secondary)" }}>
                选择内置模板或上传参考 PPT，先生成分页大纲，确认后再生成 PPTX 文件。
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button type="button" onClick={startNewTask} disabled={busy} className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm" style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)", color: busy ? "var(--oc-text-tertiary)" : "var(--oc-text-secondary)", cursor: busy ? "not-allowed" : "pointer" }}>
                <Plus size={15} />
                新任务
              </button>
              <button type="button" onClick={() => setHistoryOpen(true)} className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm" style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)", color: "var(--oc-text-secondary)" }}>
                <History size={15} />
                历史
              </button>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-4">
          <div className="settings-card" style={{ padding: 18 }}>
            <div className="flex items-center gap-2 mb-4">
              <Upload size={16} style={{ color: "var(--oc-text-secondary)" }} />
              <h3 className="text-sm font-semibold">模板和材料</h3>
            </div>
            <input ref={templateInputRef} type="file" accept={TEMPLATE_ACCEPT} className="hidden" onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void handleCustomTemplate(file);
            }} />
            <input ref={materialInputRef} type="file" accept={MATERIAL_ACCEPT} multiple className="hidden" onChange={(event) => {
              const files = Array.from(event.currentTarget.files || []);
              event.currentTarget.value = "";
              void handleMaterials(files);
            }} />

            <div className="space-y-3">
              <div className="rounded-md p-3" style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)" }}>
                <div className="text-sm font-medium">PPT 模板</div>
                <select value={templateId} onChange={(event) => { setTemplateId(event.target.value); if (event.target.value !== "custom") setCustomTemplate(null); }} disabled={busy} className="mt-3 w-full rounded-md px-3 py-2 text-sm" style={{ background: "var(--oc-bg-surface)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }}>
                  {templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  <option value="custom">使用我上传的模板</option>
                </select>
                <div className="mt-2 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
                  {templateId === "custom" ? (customTemplate ? `${customTemplate.name} · ${customTemplate.size ? formatFileSize(customTemplate.size) : customTemplate.path}` : "上传 .pptx/.ppt 作为参考模板") : (templates.find((item) => item.id === templateId)?.description || "内置模板")}
                </div>
                <button type="button" disabled={busy} onClick={() => templateInputRef.current?.click()} className="mt-3 rounded-md px-3 py-2 text-sm" style={{ background: "var(--oc-bg-surface)", border: "1px solid var(--oc-border)", color: busy ? "var(--oc-text-tertiary)" : "var(--oc-text-secondary)" }}>
                  上传模板
                </button>
              </div>

              <div className="rounded-md p-3" style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)" }}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">内容材料</div>
                    <div className="mt-1 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>文档、表格、图片、网页整理材料或参考 PPT</div>
                  </div>
                  <button type="button" disabled={busy} onClick={() => materialInputRef.current?.click()} className="shrink-0 rounded-md px-3 py-2 text-sm" style={{ background: "var(--oc-bg-surface)", border: "1px solid var(--oc-border)", color: busy ? "var(--oc-text-tertiary)" : "var(--oc-text-secondary)" }}>
                    添加
                  </button>
                </div>
                {materials.length ? (
                  <div className="mt-3 space-y-2">
                    {materials.map((file) => (
                      <div key={file.path} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs" style={{ background: "var(--oc-bg-surface)", color: "var(--oc-text-secondary)" }}>
                        <span className="truncate">{file.name}</span>
                        <button type="button" disabled={busy} onClick={() => setMaterials((prev) => prev.filter((item) => item.path !== file.path))} className="shrink-0" style={{ color: "var(--oc-text-tertiary)" }}>移除</button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="settings-card" style={{ padding: 18 }}>
            <div className="flex items-center gap-2 mb-4">
              <Wand2 size={16} style={{ color: "var(--oc-text-secondary)" }} />
              <h3 className="text-sm font-semibold">制作要求</h3>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {QUICK_REQUIREMENTS.map((item) => (
                <button key={item} type="button" disabled={busy} onClick={() => useQuickRequirement(item)} className="rounded-md px-3 py-1.5 text-xs" style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)", color: busy ? "var(--oc-text-tertiary)" : "var(--oc-text-secondary)" }}>
                  {item.slice(0, 18)}
                </button>
              ))}
            </div>
            <textarea ref={instructionInputRef} value={instruction} onChange={(event) => setInstruction(event.target.value)} disabled={busy} rows={8} placeholder="例如：基于上传材料生成 8 页客户汇报 PPT，风格商务简洁，突出背景、问题、方案价值、落地计划和风险。" className="w-full rounded-md px-3 py-2 text-sm resize-none" style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" disabled={(templateId === "custom" && !customTemplate) || busy} onClick={() => void createOutline()} className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium" style={{ background: "var(--oc-accent)", border: "1px solid var(--oc-accent)", color: "white", opacity: (templateId === "custom" && !customTemplate) || busy ? 0.55 : 1, cursor: (templateId === "custom" && !customTemplate) || busy ? "not-allowed" : "pointer" }}>
                <Send size={15} />
                生成分页大纲
              </button>
              <span className="text-xs" style={{ color: status === "error" ? "var(--banking-danger)" : "var(--oc-text-tertiary)" }}>
                {status === "uploading" ? "上传文件中" : status === "planning" ? "正在生成大纲" : status === "applying" ? "正在生成 PPT" : error || "空闲"}
              </span>
            </div>
          </div>
        </section>

        <section className="settings-card" style={{ padding: 18 }}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileText size={16} style={{ color: "var(--oc-text-secondary)" }} />
                <h3 className="text-sm font-semibold">分页大纲预览</h3>
              </div>
              {current ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
                  <span className="truncate">{current.title}</span>
                  <span>{current.templateName || "模板"}</span>
                  <span>{current.status === "completed" ? "已生成" : "待确认"}</span>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => void copyCurrent()} disabled={!current} title="复制大纲" className="lingxia-toolbar-icon"><Clipboard size={15} /></button>
              {current?.outlineUrl ? <a title="下载大纲" href={current.outlineUrl} className="lingxia-toolbar-icon inline-flex items-center justify-center"><Download size={15} /></a> : null}
            </div>
          </div>
          <div className="rounded-md min-h-[320px] p-4 text-sm leading-7 whitespace-pre-wrap overflow-y-auto stealth-scrollbar" style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)", color: current?.outline ? "var(--oc-text-primary)" : "var(--oc-text-tertiary)" }}>
            {status === "planning" ? "正在根据模板和材料生成分页大纲..." : current?.outline || "先生成分页大纲。确认结构、页数和每页内容后，再生成 PPTX 文件。"}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={!current?.outline || busy} onClick={() => void applyOutline()} className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium" style={{ background: "color-mix(in oklab, var(--oc-accent) 16%, transparent)", border: "1px solid color-mix(in oklab, var(--oc-accent) 28%, var(--oc-border))", color: "var(--oc-accent)", opacity: !current?.outline || busy ? 0.55 : 1, cursor: !current?.outline || busy ? "not-allowed" : "pointer" }}>
              <Presentation size={15} />
              确认生成 PPTX
            </button>
            {current?.resultUrl ? <a className="text-sm" style={{ color: "var(--oc-accent)" }} href={current.resultUrl}>下载 PPTX</a> : null}
            {current?.resultNoteUrl ? <a className="text-sm" style={{ color: "var(--oc-accent)" }} href={current.resultNoteUrl}>下载制作说明</a> : null}
          </div>
        </section>
      </div>

      {historyOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/35" onClick={() => setHistoryOpen(false)}>
          <aside className="h-full w-full max-w-[420px] overflow-y-auto p-4 shadow-xl stealth-scrollbar" style={{ background: "var(--oc-bg-surface)", borderLeft: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">PPT 制作历史</h3>
                <p className="mt-1 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>选择一个任务继续处理或下载结果</p>
              </div>
              <button type="button" onClick={() => setHistoryOpen(false)} className="lingxia-toolbar-icon" title="关闭"><X size={16} /></button>
            </div>
            <input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="搜索任务" className="mt-4 w-full rounded-md px-3 py-2 text-sm" style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }} />
            <div className="mt-4 space-y-2">
              {filteredRecords.map((item) => (
                <button key={item.id} type="button" onClick={() => selectRecord(item)} className="w-full rounded-md p-3 text-left" style={{ background: current?.id === item.id ? "color-mix(in oklab, var(--oc-accent) 10%, var(--oc-panel))" : "var(--oc-panel)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }}>
                  <div className="truncate text-sm font-medium">{item.title}</div>
                  <div className="mt-1 truncate text-xs" style={{ color: "var(--oc-text-tertiary)" }}>{new Date(item.updatedAt || item.createdAt).toLocaleString()} · {item.status === "completed" ? "已生成" : "待确认"}</div>
                </button>
              ))}
              {!filteredRecords.length ? <div className="rounded-md p-4 text-sm" style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)", color: "var(--oc-text-tertiary)" }}>暂无 PPT 制作任务</div> : null}
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
