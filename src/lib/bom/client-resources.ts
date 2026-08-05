import type { ResourcesState, ResourceStatus } from "@/components/bom/types";
import { apiFetch } from "@/lib/api-client";
/** 获取持久资源（库存表 / 工单表）状态 */
export async function fetchResources(): Promise<ResourcesState> {
  const res = await apiFetch("/api/bom/resources", { cache: "no-store" });
  if (!res.ok) throw new Error("获取数据资源状态失败");
  return (await res.json()) as ResourcesState;
}
/** 上传/更新某个持久资源 */
export async function uploadResource(
  kind: "inventory" | "work_order",
  file: File,
): Promise<ResourceStatus> {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("files", file);
  const res = await apiFetch("/api/bom/resources", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "更新资源失败");
  return data as ResourceStatus;
}