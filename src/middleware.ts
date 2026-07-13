import { NextResponse, type NextRequest } from "next/server";

// 注意：middleware 运行在 Edge 运行时，不能引入带 DB 依赖的 @/lib/auth。
// 这里仅做轻量的 cookie 存在性校验，真正的会话校验在各 API/页面内进行。
const SESSION_COOKIE = "bom_session";

// 公开路径：登录、认证接口、健康检查、静态资源
function isPublicPath(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname === "/api/health") return true;
  return false;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "未登录或会话已过期" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // 排除静态资源与 Next 内部路径
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico)$).*)"],
};
