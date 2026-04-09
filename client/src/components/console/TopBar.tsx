import { useBrand } from "@/lib/useBrand";
import type { ReactNode } from "react";

const PAGE_LABELS: Record<string, string> = {
  chat: "聊天",
  skills: "技能",
  agent: "代理",
  schedule: "定时任务",
  collab: "智能体协作",
  settings: "设置",
  docs: "文档",
};

type TopBarProps = {
  activePage: string;
  center?: ReactNode;
  right?: ReactNode;
};

export function TopBar({ activePage, center, right }: TopBarProps) {
  const brand = useBrand();
  return (
    <div className="lingxia-topbar">
      <div className="lingxia-topbar__left">
        <span className="lingxia-topbar__brand">{brand.nameEn}</span>
        <span className="lingxia-topbar__sep">›</span>
        <span className="lingxia-topbar__page">{PAGE_LABELS[activePage] || activePage}</span>
      </div>
      <div className="lingxia-topbar__center">
        {center}
      </div>
      <div className="lingxia-topbar__right">
        {right}
      </div>
    </div>
  );
}
