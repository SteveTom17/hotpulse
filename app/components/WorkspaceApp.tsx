"use client";

import { useState } from "react";
import { ROLE_LABELS } from "./api";
import type { SessionPayload } from "./types";
import { TrendPanel } from "./TrendPanel";
import { StudioPanel } from "./StudioPanel";
import { ReviewPanel } from "./ReviewPanel";
import { AuditPanel } from "./AuditPanel";
import { DataSourcePanel } from "./DataSourcePanel";
import { SettingsPanel } from "./SettingsPanel";
import { BillingPanel } from "./BillingPanel";

/**
 * 工作台框架：侧边导航 + 工作区切换 + 各功能面板。
 * 面板按角色权限显示：审批/审计需 admin 或 approver，数据源与成员管理仅 admin。
 */

export type TabKey = "trends" | "studio" | "review" | "audit" | "datasource" | "billing" | "settings";

const TABS: { key: TabKey; label: string; roles: string[] }[] = [
  { key: "trends", label: "机会雷达", roles: ["admin", "editor", "approver", "viewer"] },
  { key: "studio", label: "内容工坊", roles: ["admin", "editor", "approver", "viewer"] },
  { key: "review", label: "审批中心", roles: ["admin", "approver"] },
  { key: "audit", label: "审计记录", roles: ["admin", "approver"] },
  { key: "datasource", label: "数据源", roles: ["admin"] },
  { key: "billing", label: "计费与用量", roles: ["admin", "editor", "approver", "viewer"] },
  { key: "settings", label: "设置", roles: ["admin", "editor", "approver", "viewer"] },
];

const INDUSTRY_LABELS: Record<string, string> = {
  local_food: "本地生活 / 餐饮",
  beauty: "美妆个护",
  retail: "零售电商",
  travel: "旅行消费",
  other: "其他行业",
};

export function WorkspaceApp({
  payload,
  onSessionRefresh,
}: {
  payload: SessionPayload;
  onSessionRefresh: () => void;
}) {
  const [workspaceId, setWorkspaceId] = useState(payload.workspaces[0].id);
  const [tab, setTab] = useState<TabKey>("trends");
  const [toast, setToast] = useState("");

  const { session } = payload;
  const workspace = payload.workspaces.find((item) => item.id === workspaceId) ?? payload.workspaces[0];
  const role = workspace.role ?? "viewer";
  const canEdit = role === "admin" || role === "editor" || role === "approver";
  const canApprove = role === "admin" || role === "approver";

  const visibleTabs = TABS.filter((item) => item.roles.includes(role));

  function switchWorkspace(nextId: string) {
    setWorkspaceId(nextId);
    setTab("trends");
    setToast(`已切换到工作区：${payload.workspaces.find((item) => item.id === nextId)?.name ?? ""}`);
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>

      <aside className="sidebar" aria-label="主导航">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">HP</span>
          <span>
            <strong>HotPulse</strong>
            <small>安全借势工作台</small>
          </span>
        </div>

        <nav className="side-nav">
          {visibleTabs.map((item) => (
            <button
              key={item.key}
              type="button"
              className={tab === item.key ? "active" : ""}
              aria-current={tab === item.key ? "page" : undefined}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>{session.isDemo ? "演示模式" : "已连接"}</strong>
            <p>{session.isDemo ? "当前为本地演示账号，数据请以真实授权源为准。" : `登录用户：${session.name}`}</p>
          </div>
        </div>

        <div className="workspace-card">
          <span className="avatar" aria-hidden="true">{workspace.name.slice(0, 1)}</span>
          <div>
            <strong>{workspace.name}</strong>
            <small>{INDUSTRY_LABELS[workspace.industry] ?? workspace.industry} · {ROLE_LABELS[role]}</small>
          </div>
          <label className="workspace-switch" aria-label="切换工作区">
            <span className="sr-only">切换工作区</span>
            <select value={workspaceId} onChange={(event) => switchWorkspace(event.target.value)}>
              {payload.workspaces.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">{new Date().toLocaleDateString("zh-CN")} · {workspace.name}</p>
            <h1>值得跟进的，不只是热度。</h1>
          </div>
          <div className="topbar-actions">
            {session.isDemo && <span className="sync-state"><span className="status-dot" />演示账号</span>}
            <button className="button secondary" type="button" onClick={onSessionRefresh}>刷新</button>
          </div>
        </header>

        <main id="main-content">
          {tab === "trends" && (
            <TrendPanel
              workspaceId={workspaceId}
              canEdit={canEdit}
              onNavigate={setTab}
              onToast={setToast}
            />
          )}
          {tab === "studio" && (
            <StudioPanel workspaceId={workspaceId} canEdit={canEdit} canApprove={canApprove} onToast={setToast} />
          )}
          {tab === "review" && canApprove && (
            <ReviewPanel workspaceId={workspaceId} onToast={setToast} />
          )}
          {tab === "audit" && canApprove && <AuditPanel workspaceId={workspaceId} />}
          {tab === "datasource" && role === "admin" && (
            <DataSourcePanel workspaceId={workspaceId} onToast={setToast} />
          )}
          {tab === "billing" && (
            <BillingPanel workspaceId={workspaceId} isGlobalAdmin={payload.isGlobalAdmin} onToast={setToast} />
          )}
          {tab === "settings" && (
            <SettingsPanel workspaceId={workspaceId} role={role} sessionUserId={session.userId} onToast={setToast} />
          )}
        </main>
      </div>

      <div className={`toast ${toast ? "visible" : ""}`} role="status" aria-live="polite">
        {toast}
        {toast && <button type="button" onClick={() => setToast("")} aria-label="关闭提示">关闭</button>}
      </div>
    </div>
  );
}
