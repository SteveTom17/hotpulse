"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { AuditEvent } from "./types";

/**
 * 审计记录（FR-07 验收标准 4）：生成、编辑、审批、导出与失败操作均可按内容包查询。
 * 普通成员无删除日志权限，本面板只读；仅 admin / approver 可访问。
 */

const ACTION_LABELS: Record<string, string> = {
  "workspace.created": "创建工作区",
  "workspace.updated": "更新工作区",
  "member.added": "添加成员",
  "member.removed": "移除成员",
  "member.role_changed": "调整角色",
  "brand_profile.updated": "更新品牌资料",
  "trend.imported": "导入热点",
  "trend.status_changed": "标记热点状态",
  "connector.created": "创建连接器",
  "connector.updated": "更新连接器",
  "connector.deleted": "删除连接器",
  "connector.sync_run": "连接器同步",
  "connector.sync_failed": "连接器同步失败",
  "content.generated": "生成内容",
  "content.edited": "编辑内容",
  "content.regenerated": "重新生成",
  "content.version_restored": "恢复版本",
  "content.approved": "人工审批通过",
  "content.risk_overridden": "风险等级人工上调",
  "content.rejected": "内容被驳回",
  "content.exported": "合规导出",
  "legal.agreed": "同意协议",
  "billing.activated": "开通专业版",
  "billing.invoice_paid": "发票确认",
  "account.data_deleted": "账户数据删除",
  "support.ticket_created": "创建支持工单",
};

export function AuditPanel({ workspaceId }: { workspaceId: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [packageFilter, setPackageFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = packageFilter ? `?contentPackageId=${encodeURIComponent(packageFilter)}` : "";
      const payload = await api.get<{ events: AuditEvent[] }>(`/api/workspaces/${workspaceId}/audit${query}`);
      setEvents(payload.events);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "审计日志加载失败。");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, packageFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="studio" aria-labelledby="audit-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">不可篡改的追溯</p>
          <h2 id="audit-title">审计记录</h2>
        </div>
        <span className="sync-state"><span className="status-dot" />只读 · 按内容包可查</span>
      </div>

      <div className="search-row">
        <label>
          <span className="sr-only">按内容包 ID 筛选</span>
          <input
            type="search"
            value={packageFilter}
            onChange={(event) => setPackageFilter(event.target.value.trim())}
            placeholder="按内容包 ID 筛选（留空显示全部）"
          />
        </label>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {loading ? (
        <div className="empty-state"><strong>正在加载审计日志…</strong></div>
      ) : events.length === 0 ? (
        <div className="empty-state"><strong>暂无审计记录</strong><p>生成、审批、导出等动作会自动记录在此。</p></div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>动作</th>
                <th>操作人</th>
                <th>内容包</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td><time>{formatTime(event.createdAt)}</time></td>
                  <td><strong>{ACTION_LABELS[event.action] ?? event.action}</strong></td>
                  <td>{event.actorUserId}</td>
                  <td>{event.contentPackageId ? shortId(event.contentPackageId) : "—"}</td>
                  <td className="detail-cell">{summarize(event.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function summarize(detail: Record<string, unknown>): string {
  if (!detail || Object.keys(detail).length === 0) return "—";
  const parts = Object.entries(detail)
    .filter(([key]) => !["reasons", "contentJson"].includes(key))
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value).slice(0, 40) : String(value).slice(0, 40)}`);
  return parts.join("；") || "—";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
