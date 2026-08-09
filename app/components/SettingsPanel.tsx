"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, ROLE_LABELS } from "./api";
import type { Member, WorkspaceDetail } from "./types";

/**
 * 设置（FR-01）：品牌资料（可核验事实清单）+ 成员管理（管理员）+ 工作区信息。
 * 生成内容时只能引用“已确认事实”清单中的内容，其余以 [待确认] 占位。
 */

const ROLES = ["admin", "editor", "approver", "viewer"];

export function SettingsPanel({
  workspaceId,
  role,
  sessionUserId,
  onToast,
}: {
  workspaceId: string;
  role: string;
  sessionUserId: string;
  onToast: (message: string) => void;
}) {
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [profile, setProfile] = useState({
    name: "",
    audience: "",
    tone: "",
    bannedTopics: "",
    verifiedFacts: "",
  });
  const [savingProfile, setSavingProfile] = useState(false);

  const [inviteUserId, setInviteUserId] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviting, setInviting] = useState(false);

  const canManage = role === "admin";
  const canEdit = role === "admin" || role === "editor" || role === "approver";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.get<WorkspaceDetail>(`/api/workspaces/${workspaceId}`);
      setDetail(payload);
      setProfile({
        name: payload.brandProfile?.name ?? "",
        audience: payload.brandProfile?.audience ?? "",
        tone: payload.brandProfile?.tone ?? "",
        bannedTopics: (payload.brandProfile?.bannedTopics ?? []).join("\n"),
        verifiedFacts: (payload.brandProfile?.verifiedFacts ?? []).join("\n"),
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "设置加载失败。");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveProfile() {
    setSavingProfile(true);
    setError("");
    try {
      const result = await api.put<{ notice: string }>(`/api/workspaces/${workspaceId}/brand-profile`, {
        name: profile.name,
        audience: profile.audience,
        tone: profile.tone,
        bannedTopics: splitLines(profile.bannedTopics),
        verifiedFacts: splitLines(profile.verifiedFacts),
      });
      onToast(result.notice);
      void load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "保存失败。");
    } finally {
      setSavingProfile(false);
    }
  }

  async function invite() {
    if (!inviteUserId.trim()) return;
    setInviting(true);
    setError("");
    try {
      const result = await api.post<{ notice: string }>(`/api/workspaces/${workspaceId}/members`, {
        userId: inviteUserId.trim(),
        role: inviteRole,
      });
      onToast(result.notice);
      setInviteUserId("");
      void load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "邀请失败。");
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(userId: string, nextRole: string) {
    setError("");
    try {
      await api.patch(`/api/workspaces/${workspaceId}/members`, { userId, role: nextRole });
      void load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "角色调整失败。");
    }
  }

  async function removeMember(userId: string) {
    if (!window.confirm(`确定移除成员 ${userId}？此操作会写入审计日志。`)) return;
    setError("");
    try {
      const result = await api.patch<{ notice: string }>(`/api/workspaces/${workspaceId}/members`, {
        userId,
        remove: true,
      });
      onToast(result.notice);
      void load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "移除失败。");
    }
  }

  if (loading) {
    return <div className="empty-state"><strong>正在加载设置…</strong></div>;
  }

  return (
    <section className="studio" aria-labelledby="settings-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">为生成提供依据</p>
          <h2 id="settings-title">工作区设置</h2>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="settings-grid">
        <div className="form-card">
          <h3>品牌资料</h3>
          <p className="gate-copy">
            生成带货文案时，系统只能引用下方“已确认事实”清单；没有资料或事实不足时输出占位符 [待确认]，
            不会编造价格、功效、库存或资质。
          </p>
          <div className="form-grid">
            <label className="field">
              <span>品牌名称 <em>*</em></span>
              <input
                value={profile.name}
                disabled={!canEdit}
                onChange={(event) => setProfile({ ...profile, name: event.target.value })}
                maxLength={60}
              />
            </label>
            <label className="field">
              <span>目标客群</span>
              <input
                value={profile.audience}
                disabled={!canEdit}
                onChange={(event) => setProfile({ ...profile, audience: event.target.value })}
                placeholder="例如：25–35 岁、本地通勤、注重性价比"
                maxLength={500}
              />
            </label>
            <label className="field span-2">
              <span>语气基调</span>
              <input
                value={profile.tone}
                disabled={!canEdit}
                onChange={(event) => setProfile({ ...profile, tone: event.target.value })}
                placeholder="例如：克制、真诚、清晰"
                maxLength={200}
              />
            </label>
            <label className="field span-2">
              <span>禁用话题（每行一条）</span>
              <textarea
                value={profile.bannedTopics}
                disabled={!canEdit}
                onChange={(event) => setProfile({ ...profile, bannedTopics: event.target.value })}
                rows={4}
                placeholder={"功效承诺\n价格战\n医疗建议"}
              />
            </label>
            <label className="field span-2">
              <span>已确认事实（每行一条；仅这些会被生成引擎引用）</span>
              <textarea
                value={profile.verifiedFacts}
                disabled={!canEdit}
                onChange={(event) => setProfile({ ...profile, verifiedFacts: event.target.value })}
                rows={6}
                placeholder={"招牌产品：山见桂花拿铁，售价 28 元\n营业时间：每日 10:00–22:00\n门店地址：XX 路 88 号（可核验）"}
              />
            </label>
          </div>
          {canEdit && (
            <button className="button primary" type="button" disabled={savingProfile || !profile.name.trim()} onClick={() => void saveProfile()}>
              {savingProfile ? "保存中…" : "保存品牌资料"}
            </button>
          )}
          {detail?.brandProfile && <p className="gate-note">当前版本 v{detail.brandProfile.version}，保存将提升版本号并写入审计。</p>}
        </div>

        {canManage && (
          <div className="form-card">
            <h3>成员管理</h3>
            <div className="member-invite">
              <label className="field">
                <span>用户 ID（Cloudflare Access 用户标识）</span>
                <input value={inviteUserId} onChange={(event) => setInviteUserId(event.target.value)} placeholder="例如：user-xxx@example.com" maxLength={128} />
              </label>
              <label className="field">
                <span>角色</span>
                <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
                  {ROLES.map((item) => (
                    <option key={item} value={item}>{ROLE_LABELS[item]}</option>
                  ))}
                </select>
              </label>
              <button className="button primary" type="button" disabled={inviting || !inviteUserId.trim()} onClick={() => void invite()}>
                {inviting ? "添加中…" : "邀请成员"}
              </button>
            </div>
            <ul className="member-list">
              {(detail?.members ?? []).map((member: Member) => (
                <li key={member.userId} className="member-row">
                  <span className="avatar" aria-hidden="true">{member.userId.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <strong>{member.userId}</strong>
                    <small>{member.userId === sessionUserId ? "（你）" : `加入于 ${formatTime(member.createdAt)}`}</small>
                  </div>
                  <select
                    value={member.role}
                    aria-label={`${member.userId} 的角色`}
                    disabled={member.userId === sessionUserId}
                    onChange={(event) => void changeRole(member.userId, event.target.value)}
                  >
                    {ROLES.map((item) => (
                      <option key={item} value={item}>{ROLE_LABELS[item]}</option>
                    ))}
                  </select>
                  {member.userId !== sessionUserId && (
                    <button type="button" className="button secondary small" onClick={() => void removeMember(member.userId)}>
                      移除
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="gate-note">权限矩阵：管理员全权限；编辑仅编辑；审批人含审批/导出/审计；只读成员仅查看。</p>
          </div>
        )}
      </div>
    </section>
  );
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
