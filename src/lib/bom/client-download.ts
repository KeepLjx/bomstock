// ============================================================================
// 客户端文件下载工具
// 采用 fetch -> Blob -> object URL -> <a download> 方式，
// 由用户手势触发，兼容沙箱 iframe（普通 <a href> 跳转 attachment 会被拦截）
// ============================================================================

interface DownloadResult {
  ok: boolean;
  error?: string;
}

/**
 * 下载指定 API 文件。成功时自动触发浏览器下载。
 * @param url   下载接口 URL
 * @param filename 期望保存的文件名
 */
export async function downloadFile(
  url: string,
  filename: string,
): Promise<DownloadResult> {
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      let msg = `服务器返回 ${res.status}`;
      try {
        const data = await res.json();
        if (data?.error) msg = data.error;
      } catch {
        /* 非 JSON 响应 */
      }
      return { ok: false, error: msg };
    }

    const blob = await res.blob();
    if (blob.size === 0) {
      return { ok: false, error: "下载内容为空，文件可能已被清理" };
    }

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    // 清理
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    }, 1500);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: `下载失败：${(e as Error).message}` };
  }
}
