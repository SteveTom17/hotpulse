"use client";

import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "./api";
import type { ConsentState } from "./types";

/**
 * 协议同意门禁：使用产品前必须确认《用户协议》与《隐私政策》的当前版本。
 * 同意记录（用户 ID、文档类型、版本、时间）持久化到 D1，可追溯。
 */

export function LegalGate({
  requiredVersion,
  consents,
  onAgreed,
}: {
  requiredVersion: string;
  consents: ConsentState | null;
  onAgreed: () => void;
}) {
  const [checks, setChecks] = useState({ terms: false, privacy: false });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const allChecked = checks.terms && checks.privacy;

  async function agree() {
    if (!allChecked) return;
    setSubmitting(true);
    setError("");
    try {
      await api.post("/api/legal", { docTypes: ["terms", "privacy"] });
      onAgreed();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "提交失败，请稍后重试。");
      setSubmitting(false);
    }
  }

  return (
    <div className="gate-shell">
      <header className="gate-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">HP</span>
          <span><strong>HotPulse</strong><small>安全借势工作台</small></span>
        </div>
      </header>
      <main id="main-content" className="gate-main gate-wide">
        <p className="eyebrow">协议与隐私确认</p>
        <h1>使用前请确认两份文档（版本 {requiredVersion}）</h1>
        <p className="gate-copy">
          HotPulse 只接入授权数据源、只生成需人工审批的 AI 草案、不自动发布、可导出与删除你的数据。
          请阅读并勾选确认。
        </p>

        <div className="legal-card-list">
          <article className="legal-card">
            <div>
              <h2>《用户协议》</h2>
              <p>
                约定服务范围（热点研判、内容草案、审批与导出）、内容生成规则（AI 草案须标注、不得伪造事实）、
                人工审批与发布边界，以及禁止行为（不绕过平台限制、不伪造互动与身份）。
              </p>
            </div>
            <Link className="button secondary" href="/terms" target="_blank">阅读全文</Link>
            <label className="check-row" htmlFor="legal-terms" aria-label="同意用户协议">
              <input
                id="legal-terms"
                type="checkbox"
                checked={checks.terms}
                onChange={(event) => setChecks({ ...checks, terms: event.target.checked })}
              />
              <span><strong>我已阅读并同意《用户协议》</strong><small>{consents?.terms ? `上次同意：${consents.terms.agreedAt}（版本 ${consents.terms.version}）` : "首次同意"}</small></span>
            </label>
          </article>

          <article className="legal-card">
            <div>
              <h2>《隐私政策》</h2>
              <p>
                说明我们仅收集达成产品目的所需的数据（来源链接、生成内容、审计记录与用量），
                按租户隔离、加密保存凭据、不存储平台账号密码，并支持导出与删除。
              </p>
            </div>
            <Link className="button secondary" href="/privacy" target="_blank">阅读全文</Link>
            <label className="check-row" htmlFor="legal-privacy" aria-label="同意隐私政策">
              <input
                id="legal-privacy"
                type="checkbox"
                checked={checks.privacy}
                onChange={(event) => setChecks({ ...checks, privacy: event.target.checked })}
              />
              <span><strong>我已阅读并同意《隐私政策》</strong><small>{consents?.privacy ? `上次同意：${consents.privacy.agreedAt}（版本 ${consents.privacy.version}）` : "首次同意"}</small></span>
            </label>
          </article>
        </div>

        {error && <div className="error-banner" role="alert">{error}</div>}

        <button type="button" className="button primary" disabled={!allChecked || submitting} onClick={agree}>
          {submitting ? "正在提交…" : "同意并进入工作区"}
        </button>
        <p className="gate-note">不同意将无法使用生成、审批与导出功能；你可以随时在账户设置中导出或删除数据。</p>
      </main>
    </div>
  );
}
