// ============================================================================
// 客户端统一请求封装
// - 统一处理「未登录 / 会话过期」（HTTP 401）：自动跳转登录页并提示，
//   避免页面停留在过期状态、接口反复返回 401 却无任何反馈。
// - 仅 /api/auth/login、/api/auth/register 例外（401 表示账号或密码错误，
//   由登录表单自行提示，不应触发跳转）。
// ============================================================================

let sessionExpiredRedirecting = false;

function isCredentialEndpoint(input: RequestInfo | URL): boolean {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.pathname
        : "";
  return url.includes("/api/auth/login") || url.includes("/api/auth/register");
}

/** 会话过期：跳转登录页并携带 expired 标记（登录页据此提示「登录已过期」） */
export function handleSessionExpired(): void {
  if (typeof window === "undefined") return;
  if (sessionExpiredRedirecting) return; // 并发 / 轮询请求只触发一次跳转
  sessionExpiredRedirecting = true;
  const redirect = window.location.pathname + window.location.search;
  window.location.assign(
    `/login?redirect=${encodeURIComponent(redirect)}&expired=1`,
  );
}

/** 统一 API 请求：遇到 401（会话过期）时自动跳转登录页 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 && !isCredentialEndpoint(input)) {
    handleSessionExpired();
  }
  return res;
}
