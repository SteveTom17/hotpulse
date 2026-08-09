"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { SessionPayload } from "./types";
import { LegalGate } from "./LegalGate";
import { WorkspaceSetup } from "./WorkspaceSetup";
import { WorkspaceApp } from "./WorkspaceApp";

/**
 * 应用入口：加载会话 → 门禁（未认证 / 协议同意 / 工作区引导）→ 工作台。
 * 服务端渲染期间显示品牌框架；数据库不可用时降级为“数据暂不可用”说明页。
 */

type Phase =
  | { kind: "loading" }
  | { kind: "unauthorized"; supportEmail: string | null }
  | { kind: "degraded"; reason: string }
  | { kind: "ready"; payload: SessionPayload };

const LOADING_NOTE =
  "正在连接工作区…。页面数据可能包含模拟数据，所有结果都必须人工确认后才能导出。";

export function AppClient() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<SessionPayload>("/api/session")
      .then((payload) => {
        if (cancelled) return;
        if (payload.dbError) {
          setPhase({ kind: "degraded", reason: payload.dbError });
          return;
        }
        setPhase({ kind: "ready", payload });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          setPhase({ kind: "unauthorized", supportEmail: null });
          return;
        }
        setPhase({ kind: "degraded", reason: error instanceof Error ? error.message : "无法连接服务。" });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (phase.kind === "loading") {
    return (
      <div className="gate-shell" role="status">
        <a className="skip-link" href="#main-content">跳到主要内容</a>
        <header className="gate-header">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">HP</span>
            <span><strong>HotPulse</strong><small>安全借势工作台</small></span>
          </div>
        </header>
        <main id="main-content" className="gate-main">
          <p className="eyebrow">热点内容作战台</p>
          <h1>值得跟进的，不只是热度。</h1>
          <p className="gate-copy">有来源、有风控、需审批的热点内容工作台。</p>
          <div className="gate-note">{LOADING_NOTE}</div>
        </main>
      </div>
    );
  }

  if (phase.kind === "unauthorized") {
    return (
      <div className="gate-shell">
        <header className="gate-header">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">HP</span>
            <span><strong>HotPulse</strong><small>安全借势工作台</small></span>
          </div>
        </header>
        <main id="main-content" className="gate-main">
          <p className="eyebrow">需要组织身份</p>
          <h1>请先登录工作区</h1>
          <p className="gate-copy">
            本平台由组织身份系统（Cloudflare Access）保护。请通过组织提供的入口登录后访问；
            系统不会存储你的平台账号密码或 Cookie。
          </p>
          <p className="gate-note">
            登录后可创建或加入工作区，发现热点、生成 AI 草案并完成人工审批与合规导出。
            所有内容都必须人工确认后才能导出。
          </p>
          <button type="button" className="button primary" onClick={() => setReloadKey((k) => k + 1)}>
            我已登录，重新检查
          </button>
        </main>
      </div>
    );
  }

  if (phase.kind === "degraded") {
    return (
      <div className="gate-shell">
        <header className="gate-header">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">HP</span>
            <span><strong>HotPulse</strong><small>安全借势工作台</small></span>
          </div>
        </header>
        <main id="main-content" className="gate-main">
          <p className="eyebrow">数据暂不可用</p>
          <h1>值得跟进的，不只是热度。</h1>
          <div className="error-banner" role="alert">
            服务数据暂不可用：{phase.reason}。请稍后刷新；第三方数据源故障时，平台不会把旧数据展示为新鲜结果。
          </div>
          <p className="gate-copy">
            当前界面不会展示任何未经验证的热点结论。演示模式下展示的内容均为模拟数据，
            所有结果都必须人工确认后才能导出。
          </p>
          <button type="button" className="button primary" onClick={() => setReloadKey((k) => k + 1)}>
            重新连接
          </button>
        </main>
      </div>
    );
  }

  const { payload } = phase;
  const missing = payload.legal.missing;

  if (missing.length > 0) {
    return (
      <LegalGate
        requiredVersion={payload.legal.requiredVersion}
        consents={payload.legal.consents}
        onAgreed={() => setPhase({ kind: "ready", payload: { ...payload, legal: { ...payload.legal, missing: [] } } })}
      />
    );
  }

  if (payload.workspaces.length === 0) {
    return (
      <WorkspaceSetup
        session={payload.session}
        onCreated={(workspace) =>
          setPhase({
            kind: "ready",
            payload: { ...payload, workspaces: [...payload.workspaces, workspace] },
          })
        }
      />
    );
  }

  return (
    <WorkspaceApp
      key={payload.workspaces[0].id}
      payload={payload}
      onSessionRefresh={() => setReloadKey((k) => k + 1)}
    />
  );
}
