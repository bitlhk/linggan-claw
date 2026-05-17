import { useState } from "react";
import { ArrowLeft, FileSpreadsheet, Mic2, Presentation } from "lucide-react";
import { ExcelFillPage } from "@/components/pages/ExcelFillPage";
import { MeetingNotesPage } from "@/components/pages/MeetingNotesPage";
import { PptCreatePage } from "@/components/pages/PptCreatePage";

type OfficeSpacePageProps = {
  adoptId: string;
};

type CapabilityId = "meeting-notes" | "excel-fill" | "ppt-create";

const capabilities: Array<{
  id: CapabilityId;
  title: string;
  description: string;
  status: "ready" | "planned";
  Icon: typeof Mic2;
}> = [
  {
    id: "meeting-notes",
    title: "会议纪要",
    description: "录音或上传音频，生成会议摘要、待办事项和派生版本。",
    status: "ready",
    Icon: Mic2,
  },
  {
    id: "excel-fill",
    title: "Excel 填表",
    description: "上传表格和背景资料，先生成填表计划预览，再确认写回。",
    status: "ready",
    Icon: FileSpreadsheet,
  },
  {
    id: "ppt-create",
    title: "PPT 制作",
    description: "基于材料生成页结构和大纲，确认后再生成演示文稿。",
    status: "ready",
    Icon: Presentation,
  },
];

function CapabilityCard({
  capability,
  onClick,
}: {
  capability: (typeof capabilities)[number];
  onClick: () => void;
}) {
  const Icon = capability.Icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg p-3 text-left transition-colors"
      style={{
        background: "var(--oc-bg-surface)",
        border: "1px solid var(--oc-border)",
        color: "var(--oc-text-primary)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className="inline-flex h-9 w-9 items-center justify-center rounded-md"
          style={{
            background: "color-mix(in oklab, var(--oc-accent) 12%, transparent)",
            color: "var(--oc-accent)",
          }}
        >
          <Icon size={18} />
        </span>
        <span
          className="rounded px-2 py-0.5 text-[10px]"
          style={{
            background: capability.status === "ready" ? "color-mix(in oklab, var(--oc-accent) 12%, transparent)" : "var(--oc-panel)",
            color: capability.status === "ready" ? "var(--oc-accent)" : "var(--oc-text-tertiary)",
            border: "1px solid var(--oc-border)",
          }}
        >
          {capability.status === "ready" ? "可用" : "规划中"}
        </span>
      </div>
      <h3 className="mt-3 text-sm font-semibold">{capability.title}</h3>
      <p className="mt-1.5 text-xs leading-5" style={{ color: "var(--oc-text-secondary)" }}>
        {capability.description}
      </p>
    </button>
  );
}

function PlannedCapabilityPage({
  title,
  kind,
  onBack,
}: {
  title: string;
  kind: "excel" | "ppt";
  onBack: () => void;
}) {
  const isExcel = kind === "excel";
  return (
    <main className="h-full min-h-0 overflow-y-auto stealth-scrollbar" style={{ background: "var(--oc-bg)", color: "var(--oc-text-primary)" }}>
      <div className="mx-auto max-w-5xl px-5 py-5 space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
          style={{ color: "var(--oc-text-secondary)", border: "1px solid var(--oc-border)", background: "var(--oc-panel)" }}
        >
          <ArrowLeft size={15} />
          返回办公空间
        </button>

        <section className="settings-card" style={{ padding: 18 }}>
          <div className="flex items-center gap-3">
            {isExcel ? <FileSpreadsheet size={20} style={{ color: "var(--oc-accent)" }} /> : <Presentation size={20} style={{ color: "var(--oc-accent)" }} />}
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--oc-text-secondary)" }}>
                第一版先确定统一骨架：输入资料、填写要求、生成预览、保存到文件。具体生成能力后续按 contract 接入 OpenClaw。
              </p>
            </div>
          </div>
        </section>

        <section className="settings-card" style={{ padding: 18 }}>
          <h3 className="text-sm font-semibold">输入</h3>
          <div className="mt-4 grid gap-3">
            <div className="rounded-md p-3" style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)" }}>
              <div className="text-sm font-medium">{isExcel ? "Excel 文件" : "参考资料"}</div>
              <div className="mt-2 text-xs" style={{ color: "var(--oc-text-tertiary)" }}>
                {isExcel ? "支持 .xlsx/.xls。后续会解析工作簿并生成填表计划。" : "支持文档、图片、网页资料和参考 PPT。后续先生成大纲预览。"}
              </div>
              <button type="button" disabled className="mt-3 rounded-md px-3 py-2 text-sm" style={{ background: "var(--oc-bg-surface)", border: "1px solid var(--oc-border)", color: "var(--oc-text-tertiary)" }}>
                上传文件（待接入）
              </button>
            </div>
            <textarea
              rows={4}
              disabled
              placeholder={isExcel ? "例如：根据客户资料补全空白字段，不覆盖已有内容。" : "例如：生成 8 页客户汇报 PPT，风格商务简洁。"}
              className="rounded-md px-3 py-2 text-sm resize-none"
              style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)", color: "var(--oc-text-primary)" }}
            />
          </div>
        </section>

        <section className="settings-card" style={{ padding: 18 }}>
          <h3 className="text-sm font-semibold">预览</h3>
          <div className="mt-4 rounded-md p-4 text-sm leading-7" style={{ background: "var(--oc-panel)", border: "1px solid var(--oc-border)", color: "var(--oc-text-secondary)" }}>
            {isExcel ? (
              <>
                <div className="font-medium" style={{ color: "var(--oc-text-primary)" }}>填表计划预览</div>
                <div className="mt-2">Sheet1!B4：空 -&gt; 建议填写内容</div>
                <div>理由：来自用户背景资料</div>
                <div>置信度：0.85</div>
              </>
            ) : (
              <>
                <div className="font-medium" style={{ color: "var(--oc-text-primary)" }}>PPT 大纲预览</div>
                <div className="mt-2">第 1 页：标题页</div>
                <div>第 2 页：背景与问题</div>
                <div>第 3 页：解决方案</div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export function OfficeSpacePage({ adoptId }: OfficeSpacePageProps) {
  const [selected, setSelected] = useState<CapabilityId | null>(null);

  if (selected === "meeting-notes") {
    return <MeetingNotesPage adoptId={adoptId} onBack={() => setSelected(null)} />;
  }

  if (selected === "excel-fill") {
    return <ExcelFillPage adoptId={adoptId} onBack={() => setSelected(null)} />;
  }

  if (selected === "ppt-create") {
    return <PptCreatePage adoptId={adoptId} onBack={() => setSelected(null)} />;
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto stealth-scrollbar" style={{ background: "var(--oc-bg)", color: "var(--oc-text-primary)" }}>
      <div className="mx-auto max-w-6xl px-5 py-5 space-y-4">
        <section>
          <h3 className="mb-3 text-xs font-semibold" style={{ color: "var(--oc-text-secondary)" }}>通用办公</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {capabilities.map((capability) => (
              <CapabilityCard key={capability.id} capability={capability} onClick={() => setSelected(capability.id)} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
