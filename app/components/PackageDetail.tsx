"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, DEMO_ENGINE_NAME, RISK_LABELS, STATUS_LABELS } from "./api";
import type {
  ExportPayload,
  GeneratedContent,
  PackageDetailPayload,
} from "./types";

/**
 * 内容包详情（FR-05/06/07）：编辑保存新版本、恢复历史版本、三项人工审批门禁、
 * 风险上调、合规导出（manifest.json）。审批通过后状态置为 approved 才可导出。
 */

const RISK_OPTIONS = [
  { value: "low", label: "低风险" },
  { value: "medium", label: "需复核" },
  { value: "high", label: "高风险" },
];

export function PackageDetail({
  workspaceId,
  packageId,
  canEdit,
  canApprove,
  onChanged,
  onToast,
}: {
  workspaceId: string;
  packageId: string;
  canEdit: boolean;
  canApprove: boolean;
  onChanged?: (status: string) => void;
  onToast: (message: string) => void;
}) {
  const [payload, setPayload] = useState<PackageDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<GeneratedContent | null>(null);
  const [saving, setSaving] = useState(false);

  const [checks, setChecks] = useState({ sources: false, facts: false, label: false });
  const [overrideRisk, setOverrideRisk] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [approving, setApproving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.get<PackageDetailPayload>(
        `/api/workspaces/${workspaceId}/content-packages/${packageId}`,
      );
      setPayload(result);
      setDraft(result.package.content);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "内容包加载失败。");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, packageId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <div className="empty-state"><strong>正在加载内容包…</strong></div>;
  }
  if (!payload) {
    return <div className="empty-state"><strong>{error || "内容包不存在。"}</strong></div>;
  }

  const pkg = payload.package;
  const demoEngine = pkg.modelName === DEMO_ENGINE_NAME;
  const isDraft = pkg.status === "draft";
  const placeholders = pkg.placeholders;

  function updateDraft<K extends keyof GeneratedContent>(key: K, value: GeneratedContent[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function saveVersion() {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const result = await api.patch<{ package: { id: string; status: string; version: number } }>(
        `/api/workspaces/${workspaceId}/content-packages/${packageId}`,
        { content: draft },
      );
      onToast(`已保存为新版本 v${result.package.version}，需重新审批后才能导出。`);
      onChanged?.(result.package.status);
      void load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function restoreVersion(version: number) {
    setError("");
    try {
      const result = await api.patch<{ package: { id: string; status: string; version: number } }>(
        `/api/workspaces/${workspaceId}/content-packages/${packageId}`,
        { restoreVersion: version },
      );
      onToast(`已恢复版本 v${version}（保存为 v${result.package.version}），需重新审批。`);
      onChanged?.(result.package.status);
      void load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "恢复版本失败。");
    }
  }

  async function approve() {
    if (!checks.sources || !checks.facts || !checks.label) return;
    setApproving(true);
    setError("");
    try {
      const result = await api.post<{ notice: string }>(
        `/api/workspaces/${workspaceId}/content-packages/${packageId}/approve`,
        {
          sourcesConfirmed: checks.sources,
          factsConfirmed: checks.facts,
          aiLabelConfirmed: checks.label,
          overrideRisk: overrideRisk || undefined,
          overrideReason: overrideReason.trim() || undefined,
        },
      );
      onToast(result.notice);
      onChanged?.("approved");
      void load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "审批提交失败。");
    } finally {
      setApproving(false);
    }
  }

  async function exportPackage() {
    setExporting(true);
    setError("");
    try {
      const result = await api.post<ExportPayload>(
        `/api/workspaces/${workspaceId}/content-packages/${packageId}/export`,
      );
      downloadManifest(result);
      onToast(result.notice);
      onChanged?.("exported");
      void load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "导出失败。");
    } finally {
      setExporting(false);
    }
  }

  const allChecked = checks.sources && checks.facts && checks.label;
  const approvalDirty = !allChecked || overrideRisk !== "" && !overrideReason.trim();

  return (
    <div className="studio-grid">
      <div className="editor-column">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">{pkg.trend.risk === "blocked" ? "禁止" : "AI 草案 · 待核验"}</p>
            <h2>{pkg.trend.title}</h2>
          </div>
          <span className={`workflow-state ${pkg.status === "approved" ? "approved" : pkg.status === "exported" ? "exported" : "review"}`}>
            {STATUS_LABELS[pkg.status] ?? pkg.status}
          </span>
        </div>
        <p className="detail-summary">{pkg.trend.summary}</p>

        {demoEngine && (
          <div className="error-banner" role="note">
            当前为演示生成引擎（{pkg.modelName}）。产物仅供流程演示，不得对外发布；请接入正式模型并完成评估。
          </div>
        )}

        {placeholders.length > 0 && (
          <div className="error-banner" role="alert">
            文案包含未确认事实占位：{placeholders.join("、")}。审批前必须替换为已核验的商品/门店事实。
          </div>
        )}

        <fieldset className="content-block" disabled={!canEdit || !isDraft}>
          <legend>标题钩子</legend>
          {(draft?.hooks ?? []).map((hook, index) => (
            <label key={index}>
              <span>版本 {index + 1}</span>
              <input
                value={hook}
                onChange={(event) => {
                  const hooks = [...(draft?.hooks ?? [])];
                  hooks[index] = event.target.value;
                  updateDraft("hooks", hooks);
                }}
              />
            </label>
          ))}
        </fieldset>

        <label className="content-block">
          <span className="block-title">30–60 秒短视频脚本</span>
          <textarea
            value={draft?.script ?? ""}
            disabled={!canEdit || !isDraft}
            onChange={(event) => updateDraft("script", event.target.value)}
            rows={11}
          />
        </label>

        <label className="content-block">
          <span className="block-title">图文 / 带货文案</span>
          <textarea
            value={draft?.caption ?? ""}
            disabled={!canEdit || !isDraft}
            onChange={(event) => updateDraft("caption", event.target.value)}
            rows={7}
          />
        </label>

        <label className="content-block">
          <span className="block-title">视觉创意说明</span>
          <textarea
            value={draft?.visual ?? ""}
            disabled={!canEdit || !isDraft}
            onChange={(event) => updateDraft("visual", event.target.value)}
            rows={6}
          />
        </label>

        {canEdit && isDraft && (
          <div className="detail-actions">
            <button className="button primary" type="button" disabled={saving || !draft} onClick={() => void saveVersion()}>
              {saving ? "保存中…" : "保存为新版本"}
            </button>
          </div>
        )}

        <section className="source-section" aria-labelledby="detail-source-title">
          <div className="subheading">
            <h3 id="detail-source-title">来源证据</h3>
            <span>{payload.sources.length} 条</span>
          </div>
          <ul>
            {payload.sources.map((source, index) => (
              <li key={index}>
                <span className="source-initial" aria-hidden="true">{source.provider.slice(0, 1)}</span>
                <span>
                  <strong>{source.provider}</strong>
                  <small>{source.licenseStatus === "authorized" ? "授权接口" : source.licenseStatus === "customer_import" ? "客户导入" : "模拟数据"} · {formatTime(source.collectedAt)}</small>
                </span>
                {source.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer">打开</a>}
              </li>
            ))}
          </ul>
        </section>

        <section className="source-section" aria-labelledby="version-title">
          <div className="subheading">
            <h3 id="version-title">版本历史（当前 v{payload.revisions[0]?.version ?? 1}）</h3>
            <span>哈希 {pkg.versionHash.slice(0, 8)}…</span>
          </div>
          <ul>
            {payload.revisions.map((revision) => (
              <li key={revision.version} className="revision-row">
                <span>
                  <strong>v{revision.version} · {revision.note ?? "编辑"}</strong>
                  <small>{revision.editedBy} · {formatTime(revision.createdAt)}</small>
                </span>
                {canEdit && isDraft && revision.version !== (payload.revisions[0]?.version ?? 1) && (
                  <button type="button" className="button secondary small" onClick={() => void restoreVersion(revision.version)}>
                    恢复此版本
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <aside className="review-column" aria-labelledby="review-title">
        <div className="review-card">
          <p className="eyebrow">发布前门禁</p>
          <h3 id="review-title">人工审批清单</h3>
          <p>确认的不是“文案好不好看”，而是来源、事实与标识是否足以支撑发布。</p>

          <label className="check-row" htmlFor={`review-sources-${packageId}`} aria-label="来源已核验">
            <input
              id={`review-sources-${packageId}`}
              type="checkbox"
              checked={checks.sources}
              onChange={(event) => setChecks({ ...checks, sources: event.target.checked })}
            />
            <span>
              <strong>来源已核验</strong>
              <small>每条来源可打开原始链接，授权状态已确认</small>
            </span>
          </label>

          <label className="check-row" htmlFor={`review-facts-${packageId}`} aria-label="商品事实已确认">
            <input
              id={`review-facts-${packageId}`}
              type="checkbox"
              checked={checks.facts}
              onChange={(event) => setChecks({ ...checks, facts: event.target.checked })}
            />
            <span>
              <strong>商品事实已确认</strong>
              <small>价格、库存、时效、资质和功效均有依据；无占位符残留</small>
            </span>
          </label>

          <label className="check-row" htmlFor={`review-label-${packageId}`} aria-label="AI 标识已保留">
            <input
              id={`review-label-${packageId}`}
              type="checkbox"
              checked={checks.label}
              onChange={(event) => setChecks({ ...checks, label: event.target.checked })}
            />
            <span>
              <strong>AI 标识已保留</strong>
              <small>发布内容与导出清单均标注 AI 辅助创作，不剥离标识</small>
            </span>
          </label>

          {canApprove && isDraft && (
            <div className="approve-form">
              <label className="field">
                <span>上调风险等级（可选，仅可上调）</span>
                <select value={overrideRisk} onChange={(event) => setOverrideRisk(event.target.value)}>
                  <option value="">不调整（保持 {RISK_LABELS[pkg.trend.risk]}）</option>
                  {RISK_OPTIONS.filter((item) => rank(item.value) > rank(pkg.trend.risk)).map((item) => (
                    <option key={item.value} value={item.value}>上调为{item.label}</option>
                  ))}
                </select>
              </label>
              {overrideRisk && (
                <label className="field">
                  <span>上调原因（必填，最长 300 字）</span>
                  <textarea
                    value={overrideReason}
                    maxLength={300}
                    rows={2}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    placeholder="例如：话题出现未经证实的伤亡数字，需升级为高风险处理"
                  />
                </label>
              )}
            </div>
          )}

          {error && <div className="error-banner" role="alert">{error}</div>}

          <button
            className="button primary full"
            type="button"
            disabled={!canApprove || !isDraft || approvalDirty || approving}
            onClick={() => void approve()}
          >
            {approving ? "提交中…" : "确认并批准"}
          </button>
          <button
            className="button secondary full"
            type="button"
            disabled={pkg.status !== "approved" || exporting}
            onClick={() => void exportPackage()}
            title={pkg.status !== "approved" ? "仅审批通过后可导出（FR-07）" : undefined}
          >
            {exporting ? "导出中…" : pkg.status === "exported" ? "已导出（可重复下载）" : "导出合规包"}
          </button>
          {pkg.status !== "approved" && (
            <p className="method-note">未审批内容不可导出；审批动作与版本哈希将写入审计日志。</p>
          )}
        </div>

        <div className="audit-card">
          <div className="subheading">
            <h3>追溯信息</h3>
            <span>{demoEngine ? "演示引擎" : pkg.modelName}</span>
          </div>
          <ol>
            <li className="done"><span />来源已载入（{payload.sources.length} 条）<time>{formatTime(pkg.createdAt)}</time></li>
            <li className="done"><span />生成内容草案<time>{pkg.status !== "draft" ? formatTime(pkg.updatedAt) : "已保存"}</time></li>
            <li className={pkg.approvedAt ? "done" : ""}><span />人工审批<time>{pkg.approvedAt ? formatTime(pkg.approvedAt) : "等待"}</time></li>
            <li className={pkg.status === "exported" ? "done" : ""}><span />导出交付包<time>{pkg.status === "exported" ? "已导出" : "等待"}</time></li>
          </ol>
          {pkg.approvedBy && <p className="method-note">审批人：{pkg.approvedBy} · {formatTime(pkg.approvedAt ?? "")}</p>}
        </div>
      </aside>
    </div>
  );
}

function rank(risk: string): number {
  return risk === "low" ? 0 : risk === "medium" ? 1 : risk === "high" ? 2 : 3;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function downloadManifest(result: ExportPayload) {
  const blob = new Blob([JSON.stringify(result.manifest, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `hotpulse-${String(result.manifest.packageId ?? "package")}-manifest.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
