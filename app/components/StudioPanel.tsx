"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, RISK_LABELS, STATUS_LABELS } from "./api";
import type { ContentPackageSummary } from "./types";
import { PackageDetail } from "./PackageDetail";

/**
 * 内容工坊（FR-05）：内容包列表 + 编辑/审批/导出。
 * 生成入口在“机会雷达”（选择热点后生成），本面板承接生成结果的管理。
 */

export function StudioPanel({
  workspaceId,
  canEdit,
  canApprove,
  onToast,
}: {
  workspaceId: string;
  canEdit: boolean;
  canApprove: boolean;
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
      setSelectedId((current) => current ?? payload.packages[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "内容包加载失败。");
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
      // 列表刷新失败不阻断当前编辑
    }
  }

  return (
    <section className="studio" aria-labelledby="studio-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">从洞察到交付</p>
          <h2 id="studio-title">内容工坊</h2>
        </div>
        <span className={`workflow-state ${packages.length > 0 ? "review" : "idle"}`}>
          {packages.length > 0 ? `${packages.filter((item) => item.status === "draft").length} 份待审批` : "等待生成内容包"}
        </span>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {loading ? (
        <div className="empty-state"><strong>正在加载内容包…</strong></div>
      ) : packages.length === 0 ? (
        <div className="studio-empty">
          <span className="empty-mark" aria-hidden="true">01</span>
          <div>
            <strong>还没有内容包：去“机会雷达”选择一个热点生成</strong>
            <p>系统会给出标题钩子、短视频脚本、图文文案和视觉创意；所有结果都必须人工确认后才能导出。</p>
          </div>
        </div>
      ) : (
        <div className="studio-layout">
          <aside className="package-list" aria-label="内容包列表">
            <div className="subheading">
              <h3>内容包（{packages.length}）</h3>
            </div>
            <ul>
              {packages.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`package-item ${selectedId === item.id ? "selected" : ""}`}
                    aria-pressed={selectedId === item.id}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className={`risk-tag ${item.trendRisk}`}>{RISK_LABELS[item.trendRisk]}</span>
                    <strong>{item.trendTitle}</strong>
                    <small>
                      {STATUS_LABELS[item.status]} · {formatTime(item.updatedAt)}
                      {item.modelName && ` · ${item.modelName}`}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="studio-body">
            {selectedId ? (
              <PackageDetail
                key={selectedId}
                workspaceId={workspaceId}
                packageId={selectedId}
                canEdit={canEdit}
                canApprove={canApprove}
                onChanged={() => void refreshList()}
                onToast={onToast}
              />
            ) : (
              <div className="empty-state"><strong>选择一个内容包开始编辑</strong></div>
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
