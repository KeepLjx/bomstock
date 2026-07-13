// ============================================================================
// 用户认证与会话管理
// - 密码哈希：Node 内置 crypto.scrypt（无第三方依赖，离线可用）
// - 会话：HttpOnly cookie -> user_sessions 表（token 存哈希）
// - 所有用户同权（操作员），仅用于审计追溯
// ============================================================================

import crypto from "node:crypto";
import { db } from "@/db";
import { users, userSessions } from "@/db/schema";
import { eq, and, lt } from "drizzle-orm";

export const SESSION_COOKIE = "bom_session";
/** 普通会话有效期 7 天 */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
  status: string;
}

// ---------------------------------------------------------------------------
// 密码哈希
// ---------------------------------------------------------------------------

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/** 生成 scrypt 密码哈希，格式：scrypt:<salt>:<hash> */
export function hashPassword(password: string): string {
  const salt = randomHex(16);
  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString("hex");
  return `scrypt:${salt}:${hash}`;
}

/** 校验密码 */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [algo, salt, hash] = stored.split(":");
    if (algo !== "scrypt" || !salt || !hash) return false;
    const test = crypto.scryptSync(password, salt, 64).toString("hex");
    // 定长比较，避免计时攻击
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
  } catch {
    return false;
  }
}

/** 生成不透明会话 token */
function generateToken(): string {
  return randomHex(32);
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// 用户
// ---------------------------------------------------------------------------

export async function findUserByUsername(username: string) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserById(id: string) {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/** 创建新用户（用于注册），返回是否成功（用户名唯一冲突返回 false） */
export async function createUser(input: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<{ ok: boolean; error?: string; user?: AuthUser }> {
  const username = input.username.trim();
  if (username.length < 2) {
    return { ok: false, error: "用户名至少 2 个字符" };
  }
  if (input.password.length < 6) {
    return { ok: false, error: "密码至少 6 位" };
  }
  const existing = await findUserByUsername(username);
  if (existing) {
    return { ok: false, error: "用户名已存在" };
  }
  const id = `usr_${randomHex(8)}`;
  try {
    const [row] = await db
      .insert(users)
      .values({
        id,
        username,
        passwordHash: hashPassword(input.password),
        displayName: input.displayName?.trim() || null,
        status: "active",
      })
      .returning();
    return { ok: true, user: toAuthUser(row) };
  } catch {
    return { ok: false, error: "创建用户失败（用户名可能已存在）" };
  }
}

/** 修改密码：校验旧密码后写入新哈希 */
export async function changeUserPassword(
  userId: string,
  oldPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getUserById(userId);
  if (!user) return { ok: false, error: "用户不存在" };
  if (!verifyPassword(oldPassword, user.passwordHash)) {
    return { ok: false, error: "原密码错误" };
  }
  if (newPassword.length < 6) {
    return { ok: false, error: "新密码至少 6 位" };
  }
  await db
    .update(users)
    .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(users.id, userId));
  return { ok: true };
}

/** 列出所有用户（用于日志/审计展示用户名） */
export async function listUsers(): Promise<AuthUser[]> {
  const rows = await db.select().from(users);
  return rows.map(toAuthUser);
}

function toAuthUser(u: typeof users.$inferSelect): AuthUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    status: u.status,
  };
}

/**
 * 确保默认管理员存在（首次启动 / 无任何用户时自动创建）。
 * 默认账号：admin / admin123（仅用于离线局域网环境，请登录后修改）。
 */
export async function ensureDefaultUser(): Promise<void> {
  const existing = await db.select().from(users).limit(1);
  if (existing.length > 0) return;
  const id = `usr_${randomHex(8)}`;
  await db.insert(users).values({
    id,
    username: "admin",
    passwordHash: hashPassword("admin123"),
    displayName: "管理员",
    status: "active",
  });
}

// ---------------------------------------------------------------------------
// 会话（创建/校验/销毁）
// ---------------------------------------------------------------------------

export interface CreatedSession {
  token: string;
  expiresAt: Date;
  maxAge: number;
}

export async function createSession(userId: string): Promise<CreatedSession> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const id = `ses_${randomHex(8)}`;
  await db.insert(userSessions).values({
    id,
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });
  await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, userId));
  return { token, expiresAt, maxAge: SESSION_TTL_MS };
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  try {
    await db
      .delete(userSessions)
      .where(eq(userSessions.tokenHash, hashToken(token)));
  } catch {
    // 忽略
  }
}

/** 校验 cookie 中的 token，返回用户（过期/无效返回 null） */
export async function getUserFromToken(
  token: string | undefined | null,
): Promise<AuthUser | null> {
  if (!token) return null;
  const rows = await db
    .select({
      session: userSessions,
      user: users,
    })
    .from(userSessions)
    .innerJoin(users, eq(userSessions.userId, users.id))
    .where(eq(userSessions.tokenHash, hashToken(token)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.session.expiresAt.getTime() < Date.now()) return null;
  if (row.user.status !== "active") return null;
  // 异步刷新 last_seen（不阻塞）
  db.update(userSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(userSessions.id, row.session.id))
    .then(() => {})
    .catch(() => {});
  return toAuthUser(row.user);
}

/** 清理过期会话（可选调用） */
export async function pruneExpiredSessions(): Promise<void> {
  try {
    await db.delete(userSessions).where(lt(userSessions.expiresAt, new Date()));
  } catch {
    // 忽略
  }
}

// ---------------------------------------------------------------------------
// 请求辅助：从 NextRequest / cookies 读取当前用户
// ---------------------------------------------------------------------------

import type { NextRequest } from "next/server";

export async function getRequestUser(req: NextRequest): Promise<AuthUser | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  await ensureDefaultUser();
  return getUserFromToken(token);
}

/** 用于 API 路由：返回用户或抛出 401 友好结构 */
export async function requireUser(req: NextRequest): Promise<AuthUser> {
  const user = await getRequestUser(req);
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}

export class UnauthorizedError extends Error {
  status = 401;
  constructor() {
    super("未登录或会话已过期");
  }
}
