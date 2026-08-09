"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { BillingPayload } from "./types";

/**
 * 计费与用量（试点）：订阅状态、内容额度进度、用量记录与发票。
 * 免费试用 30 天 / 30 额度；专业版由管理员人工开通（人工确认支付，预留真实网关）。
 */

const KIND_LABELS: Record<string, string> = {
  content_generation: "生成内容",
  regenerate: "重新生成",
  asset_generation: "素材生成",
  export: "合规导出",
  connector_run: "连接器同步",
};

export function BillingPanel({
  workspaceId,
  isGlobalAdmin,
  onToast,
}: {
  workspaceId: string;
  isGlobalAdmin: boolean;
  onToast: (message: string) => void;
}) {
  const [payload, setPayload] = useState<BillingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activating, setActivating] = useState(false);
  const [months, setMonths] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.get<BillingPayload>(`/api/workspaces/${workspaceId}/billing`);
      setPayload(result);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "计费信息加载失败。");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function activatePro() {
    setActivating(true);
    setError("");
    try {
      const result = await api.post<{ notice: string }>("/api/admin/billing", {
        workspaceId,
        months,
      });
      onToast(result.notice);
      void load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "开通失败。");
    } finally {
      setActivating(false);
    }
  }

  if (loading) {
    return <div className="empty-state"><strong>正在加载计费信息…</strong></div>;
  }
  if (!payload) {
    return <div className="empty-state"><strong>{error || "计费信息不可用。"}</strong></div>;
  }

  const { subscription, usage, invoices, priceInfo } = payload;
  const usedPercent = subscription.creditsTotal > 0
    ? Math.min(100, Math.round((subscription.creditsUsed / subscription.creditsTotal) * 100))
    : 0;

  return (
    <section className="studio" aria-labelledby="billing-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">试点计费</p>
          <h2 id="billing-title">计费与用量</h2>
        </div>
        <span className="sync-state"><span className="status-dot" />账单按工作区隔离</span>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="billing-grid">
        <article className="plan-card">
          <div className="subheading">
            <h3>{subscription.planLabel}</h3>
            <span className={`plan-status ${subscription.status}`}>{subscription.statusLabel}</span>
          </div>
          <strong className="plan-price">{subscription.priceLabel}</strong>
          <dl className="plan-facts">
            <div><dt>本周期额度</dt><dd>{subscription.creditsTotal} 次内容动作</dd></div>
            <div><dt>已使用</dt><dd>{subscription.creditsUsed} 次（剩余 {subscription.creditsRemaining}）</dd></div>
            {subscription.trialEndsAt && <div><dt>试用截止</dt><dd>{formatDate(subscription.trialEndsAt)}</dd></div>}
            {subscription.periodEndAt && <div><dt>周期截止</dt><dd>{formatDate(subscription.periodEndAt)}</dd></div>}
          </dl>
          <div className="progress-track" aria-hidden="true">
            <span className="progress-fill" style={{ width: `${usedPercent}%` }} />
          </div>
          <p className="method-note">生成、重新生成与导出各消耗 1 额度；额度用完后需开通专业版（人工确认）。</p>

          {isGlobalAdmin && (
            <div className="admin-activate">
              <p className="eyebrow">管理员工具</p>
              <div className="member-invite">
                <label className="field">
                  <span>开通月数</span>
                  <select value={months} onChange={(event) => setMonths(Number(event.target.value))}>
                    {[1, 2, 3, 6, 12].map((item) => (
                      <option key={item} value={item}>{item} 个月</option>
                    ))}
                  </select>
                </label>
                <button className="button primary" type="button" disabled={activating} onClick={() => void activatePro()}>
                  {activating ? "开通中…" : "人工开通专业版"}
                </button>
              </div>
              <p className="gate-note">此操作生成已支付发票并激活订阅（¥{priceInfo.proPriceCents / 100}/月 × {months}）。</p>
            </div>
          )}
        </article>

        <div className="billing-columns">
          <div className="form-card">
            <h3>最近用量</h3>
            {usage.length === 0 ? (
              <p className="gate-note">暂无用量记录。生成内容包后这里会显示每次消耗。</p>
            ) : (
              <ul className="usage-list">
                {usage.map((record) => (
                  <li key={record.id}>
                    <span><strong>{KIND_LABELS[record.kind] ?? record.kind}</strong><small>{formatTime(record.createdAt)}</small></span>
                    <em>−{record.quantity}</em>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="form-card">
            <h3>发票</h3>
            {invoices.length === 0 ? (
              <p className="gate-note">暂无发票。专业版开通后自动生成已支付发票（人工确认）。</p>
            ) : (
              <ul className="usage-list">
                {invoices.map((invoice) => (
                  <li key={invoice.id}>
                    <span>
                      <strong>{invoice.periodLabel}</strong>
                      <small>{formatTime(invoice.createdAt)} · {invoice.status === "paid" ? "已支付（人工确认）" : invoice.status}</small>
                    </span>
                    <em>¥{(invoice.amountCents / 100).toFixed(2)}</em>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" });
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
