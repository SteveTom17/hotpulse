import { getDb } from "../../../db";
import { supportTickets } from "../../../db/schema";
import { guardSession } from "../../../lib/api-helpers";
import { fail, json } from "../../../lib/http";

/**
 * POST /api/support：提交申诉、投诉、咨询或数据请求工单。
 * 工单按用户留存，运营方在后台处理；用于“申诉与人工复核入口”。
 */

const CATEGORIES = new Set(["complaint", "appeal", "question", "data_request"]);
const MAX_MESSAGE_LENGTH = 4000;

export async function POST(request: Request) {
  const guard = await guardSession(request);
  if (guard.error) return guard.error;
  const { session } = guard;

  let body: { category?: string; subject?: string; message?: string; workspaceId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail(400, "BAD_REQUEST", "请求内容不是有效的 JSON。");
  }

  const category = body.category ?? "question";
  if (!CATEGORIES.has(category)) {
    return fail(400, "BAD_REQUEST", "工单类型无效。");
  }
  const subject = (body.subject ?? "").trim().slice(0, 200);
  const message = (body.message ?? "").trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!subject || !message) {
    return fail(400, "BAD_REQUEST", "主题与描述为必填项。");
  }

  const db = getDb();
  const id = crypto.randomUUID();
  await db.insert(supportTickets).values({
    id,
    workspaceId: body.workspaceId ?? null,
    userId: session.userId,
    category: category as "complaint" | "appeal" | "question" | "data_request",
    subject,
    message,
  });

  return json({
    ticket: { id, status: "open" },
    notice: "已收到你的工单。申诉与数据请求将在 3 个工作日内由人工处理。",
  });
}
