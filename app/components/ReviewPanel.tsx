"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, RISK_LABELS, STATUS_LABELS } from "./api";
import type { ContentPackageSummary } from "./types";
import { PackageDetail } from "./PackageDetail";

/**
 * 审批中心（FR-04/07）：待审批内容包清单 + 三项门禁确认 + 风险上调 + 导出。
 * 仅 admin / approver 可进入本面板；blocked 热点不可审批通过。
 */

export function ReviewPanel({
  workspaceId,
  onToast,
}: {
  workspaceId: string;
  onToast: (message: string) => void;
}) {
  const [packages, setPackages] = useState<ContentPackageSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.get<{ packages: ContentPackageSummary[] }>(
        `/api/workspaces/${workspaceId}/content-packages?limit=100`,
      );
      setPackages(payload.packages);
      const pending = payload.packages.filter((item) => item.status === "draft");
      setSelectedId((current) => current ?? pending[0]?.id ?? payload.packages[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "审批列表加载失败。");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refreshList() {
    try {
      const payload = await api.get<{ packages: ContentPackageSummary[] }>(
        `/api/workspaces/${workspaceId}/content-packages?limit=100`,
      );
      setPackages(payload.packages);
    } catch {
      // 列表刷新失败不阻断当前审批
    }
  }

  const pending = packages.filter((item) => item.status === "draft");
  const done = packages.filter((item) => item.status !== "draft");

  return (
    <section className="studio" aria-labelledby="review-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">发布前门禁</p>
          <h2 id="review-title">审批中心</h2>
        </div>
        <span className={`workflow-state ${pending.length > 0 ? "review" : "idle"}`}>
          {pending.length > 0 ? `${pending.length} 份待审批` : "暂无待审批内容"}
        </span>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {loading ? (
        <div className="empty-state"><strong>正在加载…</strong></div>
      ) : packages.length === 0 ? (
        <div className="studio-empty">
          <span className="empty-mark" aria-hidden="true">02</span>
          <div>
            <strong>没有内容包需要审批</strong>
            <p>先去“机会雷达”生成内容包；审批通过并导出后，记录将写入审计日志。</p>
          </div>
        </div>
      ) : (
        <div className="studio-layout">
          <aside className="package-list" aria-label="审批队列">
            <div className="subheading">
              <h3>待审批（{pending.length}）</h3>
            </div>
            <ul>
              {pending.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`package-item ${selectedId === item.id ? "selected" : ""}`}
                    aria-pressed={selectedId === item.id}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className={`risk-tag ${item.trendRisk}`}>{RISK_LABELS[item.trendRisk]}</span>
                    <strong>{item.trendTitle}</strong>
                    <small>{formatTime(item.updatedAt)} · {item.modelName}</small>
                  </button>
                </li>
              ))}
            </ul>
            {done.length > 0 && (
              <>
                <div className="subheading spaced">
                  <h3>已处理（{done.length}）</h3>
                </div>
                <ul>
                  {done.slice(0, 20).map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`package-item ${selectedId === item.id ? "selected" : ""}`}
                        aria-pressed={selectedId === item.id}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <span className={`risk-tag ${item.trendRisk}`}>{RISK_LABELS[item.trendRisk]}</span>
                        <strong>{item.trendTitle}</strong>
                        <small>{STATUS_LABELS[item.status]} · {formatTime(item.updatedAt)}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>

          <div className="studio-body">
            {selectedId ? (
              <PackageDetail
                key={selectedId}
                workspaceId={workspaceId}
                packageId={selectedId}
                canEdit
                canApprove
                onChanged={() => void refreshList()}
                onToast={onToast}
              />
            ) : (
              <div className="empty-state"><strong>选择一个内容包开始审批</strong></div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
