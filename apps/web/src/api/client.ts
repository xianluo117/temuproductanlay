import type {
  AdminPasswordResetInput,
  AdminUserUpdateInput,
  AnomalyItem,
  AnomalyThresholds,
  ApiResponse,
  AuthSession,
  ChangePasswordInput,
  DashboardResponse,
  GlobalOperationInput,
  GlobalOperationRecord,
  ImageDownloadConcurrencySettings,
  ImageDownloadConcurrencySettingsInput,
  ImportBatch,
  ImportCommitResponse,
  ImportPreview,
  ProductBatchOperationInput,
  ProductBatchOperationResult,
  ProductDetailResponse,
  ProductManagementColumnPreferences,
  ProductManagementListResponse,
  ProductManagementTrafficLimitSkc,
  ProductManagementRecord,
  ProductManagementRecordInput,
  ProductManagementSettings,
  ProductOperationInput,
  ProductOperationRecord,
  ProductSummary,
  SpuComparisonCandidate,
  SpuComparisonResponse,
  TemuBrowserActionResult,
  TemuBrowserEvent,
  TemuLifecycleListResponse,
  TemuLifecycleSyncStatus,
  TemuShopGrantUpdateInput,
  TemuShopProfile,
  TemuShopProfileCreateInput,
  TemuShopProfileUpdateInput,
  TemuTrafficSyncActionResult,
  TemuTrafficSyncStatus,
  UserAccount,
  ZhihouAccount,
  ZhihouAccountInput,
  ZhihouLoginTestResult,
  ZhihouOrderReferencesResponse,
  ZhihouOrderSummaryResponse,
  ZhihouOrderSyncBatch,
  ZhihouSkuMatchStatus,
} from "@temu-analytics/shared";
import axios from "axios";

export interface BackupInfo {
  fileName: string;
  type: "automatic" | "manual" | "pre_restore";
  createdAt: string;
  localDate: string;
  latestDataDate: string | null;
  earliestDataDate: string | null;
  importBatchCount: number;
  metricRowCount: number;
  productCount: number;
  byteSize: number;
}

const http = axios.create({
  baseURL: "/api",
  timeout: 120_000,
  withCredentials: true,
});

export async function login(
  username: string,
  password: string,
): Promise<AuthSession> {
  return (
    await http.post<ApiResponse<AuthSession>>("/auth/login", {
      username,
      password,
    })
  ).data.data;
}

export async function register(
  username: string,
  password: string,
): Promise<AuthSession> {
  return (
    await http.post<ApiResponse<AuthSession>>("/auth/register", {
      username,
      password,
    })
  ).data.data;
}

export async function getSession(): Promise<AuthSession> {
  return (await http.get<ApiResponse<AuthSession>>("/auth/session")).data.data;
}

export async function logout(): Promise<void> {
  await http.post("/auth/logout");
}

export async function changePassword(
  input: ChangePasswordInput,
): Promise<void> {
  await http.put("/auth/password", input);
}

export async function getUsers(): Promise<UserAccount[]> {
  return (await http.get<ApiResponse<UserAccount[]>>("/auth/users")).data.data;
}

export async function switchActiveShop(id: number): Promise<AuthSession> {
  return (await http.put<ApiResponse<AuthSession>>(`/auth/active-shop/${id}`))
    .data.data;
}

export async function updateUser(
  id: number,
  input: AdminUserUpdateInput,
): Promise<UserAccount> {
  return (
    await http.patch<ApiResponse<UserAccount>>(`/auth/users/${id}`, input)
  ).data.data;
}

export async function resetUserPassword(
  id: number,
  input: AdminPasswordResetInput,
): Promise<void> {
  await http.post(`/auth/users/${id}/reset-password`, input);
}

export async function getDashboard(date?: string): Promise<DashboardResponse> {
  return (
    await http.get<ApiResponse<DashboardResponse>>("/dashboard", {
      params: { date },
    })
  ).data.data;
}

export async function getProducts(
  params: Record<string, string | undefined>,
): Promise<ProductSummary[]> {
  return (
    await http.get<ApiResponse<ProductSummary[]>>("/products", { params })
  ).data.data;
}

export interface ProductManagementSearchParams {
  spu?: string;
  skc?: string;
  sku?: string;
  productCode?: string;
}

export interface ProductManagementListParams
  extends ProductManagementSearchParams {
  page?: number;
  pageSize?: 20 | 50 | 100 | 200;
}

export async function getProductManagementRecords(
  scope: "mine" | "shop" = "mine",
  params: ProductManagementListParams = {},
): Promise<ProductManagementListResponse> {
  return (
    await http.get<ApiResponse<ProductManagementListResponse>>(
      "/product-management",
      { params: { scope, ...params } },
    )
  ).data.data;
}

export async function getProductManagementRecord(
  id: number,
): Promise<ProductManagementRecord> {
  return (
    await http.get<ApiResponse<ProductManagementRecord>>(
      `/product-management/${id}`,
    )
  ).data.data;
}

export async function createProductManagementRecord(
  input: ProductManagementRecordInput,
): Promise<ProductManagementRecord> {
  return (
    await http.post<ApiResponse<ProductManagementRecord>>(
      "/product-management",
      input,
    )
  ).data.data;
}

export async function updateProductManagementRecord(
  id: number,
  input: ProductManagementRecordInput,
): Promise<ProductManagementRecord> {
  return (
    await http.put<ApiResponse<ProductManagementRecord>>(
      `/product-management/${id}`,
      input,
    )
  ).data.data;
}

export async function deleteProductManagementRecord(id: number): Promise<void> {
  await http.delete(`/product-management/${id}`);
}

export async function getProductManagementTrafficLimitSkcs(
  id: number,
  spu: string,
): Promise<ProductManagementTrafficLimitSkc[]> {
  return (
    await http.get<ApiResponse<ProductManagementTrafficLimitSkc[]>>(
      `/product-management/${id}/traffic-limit-skcs`,
      { params: { spu } },
    )
  ).data.data;
}

export async function saveProductManagementColumnPreferences(
  input: ProductManagementColumnPreferences,
): Promise<ProductManagementColumnPreferences> {
  return (
    await http.put<ApiResponse<ProductManagementColumnPreferences>>(
      "/product-management/columns",
      input,
    )
  ).data.data;
}

export async function saveProductManagementPageSize(
  pageSize: 20 | 50 | 100 | 200,
): Promise<20 | 50 | 100 | 200> {
  return (
    await http.put<ApiResponse<{ pageSize: 20 | 50 | 100 | 200 }>>(
      "/product-management/page-size",
      { pageSize },
    )
  ).data.data.pageSize;
}

export async function saveProductManagementSettings(
  input: Omit<ProductManagementSettings, "updatedAt">,
): Promise<ProductManagementSettings> {
  return (
    await http.put<ApiResponse<ProductManagementSettings>>(
      "/product-management/settings",
      input,
    )
  ).data.data;
}

export async function syncTemuLifecycle(): Promise<TemuLifecycleSyncStatus> {
  return (
    await http.post<ApiResponse<TemuLifecycleSyncStatus>>(
      "/temu/lifecycle/sync",
    )
  ).data.data;
}

export async function getTemuLifecycle(): Promise<TemuLifecycleListResponse> {
  return (
    await http.get<ApiResponse<TemuLifecycleListResponse>>("/temu/lifecycle")
  ).data.data;
}

export async function getProductDetail(
  spu: string,
): Promise<ProductDetailResponse> {
  return (
    await http.get<ApiResponse<ProductDetailResponse>>(`/products/${spu}`)
  ).data.data;
}

export async function getSpuComparisonCandidates(): Promise<
  SpuComparisonCandidate[]
> {
  return (
    await http.get<ApiResponse<SpuComparisonCandidate[]>>(
      "/spu-comparison/candidates",
    )
  ).data.data;
}

export async function getSpuComparison(
  spus: string[],
  date?: string,
): Promise<SpuComparisonResponse> {
  return (
    await http.get<ApiResponse<SpuComparisonResponse>>("/spu-comparison", {
      params: { spus: spus.join(","), date },
    })
  ).data.data;
}

export async function getGlobalOperations(): Promise<GlobalOperationRecord[]> {
  return (
    await http.get<ApiResponse<GlobalOperationRecord[]>>("/global-operations")
  ).data.data;
}

export async function createGlobalOperation(
  input: GlobalOperationInput,
): Promise<GlobalOperationRecord> {
  return (
    await http.post<ApiResponse<GlobalOperationRecord>>(
      "/global-operations",
      input,
    )
  ).data.data;
}

export async function updateGlobalOperation(
  id: number,
  input: GlobalOperationInput,
): Promise<GlobalOperationRecord> {
  return (
    await http.put<ApiResponse<GlobalOperationRecord>>(
      `/global-operations/${id}`,
      input,
    )
  ).data.data;
}

export async function deleteGlobalOperation(id: number): Promise<void> {
  await http.delete(`/global-operations/${id}`);
}

export async function createProductOperationsBatch(
  input: ProductBatchOperationInput,
): Promise<ProductBatchOperationResult> {
  return (
    await http.post<ApiResponse<ProductBatchOperationResult>>(
      "/products/operations/batch",
      input,
    )
  ).data.data;
}

export async function getProductOperations(
  spu: string,
): Promise<ProductOperationRecord[]> {
  return (
    await http.get<ApiResponse<ProductOperationRecord[]>>(
      `/products/${encodeURIComponent(spu)}/operations`,
    )
  ).data.data;
}

export async function createProductOperation(
  spu: string,
  input: ProductOperationInput,
): Promise<ProductOperationRecord> {
  return (
    await http.post<ApiResponse<ProductOperationRecord>>(
      `/products/${encodeURIComponent(spu)}/operations`,
      input,
    )
  ).data.data;
}

export async function updateProductOperation(
  spu: string,
  id: number,
  input: ProductOperationInput,
): Promise<ProductOperationRecord> {
  return (
    await http.put<ApiResponse<ProductOperationRecord>>(
      `/products/${encodeURIComponent(spu)}/operations/${id}`,
      input,
    )
  ).data.data;
}

export async function deleteProductOperation(
  spu: string,
  id: number,
): Promise<void> {
  await http.delete(`/products/${encodeURIComponent(spu)}/operations/${id}`);
}

export async function previewImport(file: File): Promise<ImportPreview> {
  const form = new FormData();
  form.append("file", file);
  return (await http.post<ApiResponse<ImportPreview>>("/imports/preview", form))
    .data.data;
}

export async function commitImport(
  token: string,
  overwrite: boolean,
): Promise<ImportCommitResponse> {
  return (
    await http.post<ApiResponse<ImportCommitResponse>>("/imports/commit", {
      token,
      overwrite,
    })
  ).data.data;
}

export async function getImports(): Promise<ImportBatch[]> {
  return (await http.get<ApiResponse<ImportBatch[]>>("/imports")).data.data;
}

export async function getAnomalies(date?: string): Promise<AnomalyItem[]> {
  return (
    await http.get<ApiResponse<AnomalyItem[]>>("/anomalies", {
      params: { date },
    })
  ).data.data;
}

export async function getThresholds(): Promise<AnomalyThresholds> {
  return (
    await http.get<ApiResponse<AnomalyThresholds>>(
      "/settings/anomaly-thresholds",
    )
  ).data.data;
}

export async function saveThresholds(
  value: AnomalyThresholds,
): Promise<AnomalyThresholds> {
  return (
    await http.put<ApiResponse<AnomalyThresholds>>(
      "/settings/anomaly-thresholds",
      value,
    )
  ).data.data;
}

export async function getBackups(): Promise<BackupInfo[]> {
  return (await http.get<ApiResponse<BackupInfo[]>>("/backups")).data.data;
}

export async function createBackup(): Promise<BackupInfo> {
  return (await http.post<ApiResponse<BackupInfo>>("/backups")).data.data;
}

export async function restoreStoredBackup(fileName: string): Promise<void> {
  await http.post(`/backups/${encodeURIComponent(fileName)}/restore`);
}

export async function restoreUploadedBackup(file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  await http.post("/backups/restore", form);
}

export async function getSystemBackups(): Promise<BackupInfo[]> {
  return (await http.get<ApiResponse<BackupInfo[]>>("/system-backups")).data
    .data;
}

export async function createSystemBackup(): Promise<BackupInfo> {
  return (await http.post<ApiResponse<BackupInfo>>("/system-backups")).data
    .data;
}

export async function restoreStoredSystemBackup(
  fileName: string,
): Promise<void> {
  await http.post(`/system-backups/${encodeURIComponent(fileName)}/restore`);
}

export async function restoreUploadedSystemBackup(file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  await http.post("/system-backups/restore", form);
}

export async function getImageDownloadConcurrencySettings(): Promise<ImageDownloadConcurrencySettings> {
  return (
    await http.get<ApiResponse<ImageDownloadConcurrencySettings>>(
      "/admin/temu-shops/settings/image-download-concurrency",
    )
  ).data.data;
}

export async function saveImageDownloadConcurrencySettings(
  input: ImageDownloadConcurrencySettingsInput,
): Promise<ImageDownloadConcurrencySettings> {
  return (
    await http.put<ApiResponse<ImageDownloadConcurrencySettings>>(
      "/admin/temu-shops/settings/image-download-concurrency",
      input,
    )
  ).data.data;
}

export async function getTemuShopProfiles(): Promise<TemuShopProfile[]> {
  return (await http.get<ApiResponse<TemuShopProfile[]>>("/admin/temu-shops"))
    .data.data;
}

export async function createTemuShopProfile(
  input: TemuShopProfileCreateInput,
): Promise<TemuShopProfile> {
  return (
    await http.post<ApiResponse<TemuShopProfile>>("/admin/temu-shops", input)
  ).data.data;
}

export async function updateTemuShopProfile(
  id: number,
  input: TemuShopProfileUpdateInput,
): Promise<TemuShopProfile> {
  return (
    await http.patch<ApiResponse<TemuShopProfile>>(
      `/admin/temu-shops/${id}`,
      input,
    )
  ).data.data;
}

export async function deleteTemuShopProfile(id: number): Promise<void> {
  await http.delete(`/admin/temu-shops/${id}`);
}

export async function updateTemuShopGrants(
  id: number,
  input: TemuShopGrantUpdateInput,
): Promise<TemuShopProfile> {
  return (
    await http.put<ApiResponse<TemuShopProfile>>(
      `/admin/temu-shops/${id}/grants`,
      input,
    )
  ).data.data;
}

export async function startTemuShopBrowser(
  id: number,
): Promise<TemuBrowserActionResult> {
  return (
    await http.post<ApiResponse<TemuBrowserActionResult>>(
      `/admin/temu-shops/${id}/browser/start-login`,
    )
  ).data.data;
}

export async function checkTemuShopBrowser(
  id: number,
): Promise<TemuBrowserActionResult> {
  return (
    await http.post<ApiResponse<TemuBrowserActionResult>>(
      `/admin/temu-shops/${id}/browser/health`,
    )
  ).data.data;
}

export async function stopTemuShopBrowser(
  id: number,
): Promise<TemuBrowserActionResult> {
  return (
    await http.post<ApiResponse<TemuBrowserActionResult>>(
      `/admin/temu-shops/${id}/browser/stop`,
    )
  ).data.data;
}

export async function startTemuTrafficSync(
  id: number,
): Promise<TemuTrafficSyncActionResult> {
  return (
    await http.post<ApiResponse<TemuTrafficSyncActionResult>>(
      `/admin/temu-shops/${id}/traffic/sync`,
    )
  ).data.data;
}

export async function startTemuLifecycleSync(
  id: number,
): Promise<{ sync: TemuLifecycleSyncStatus; message: string }> {
  return (
    await http.post<
      ApiResponse<{ sync: TemuLifecycleSyncStatus; message: string }>
    >(`/admin/temu-shops/${id}/lifecycle/sync`)
  ).data.data;
}

export async function getLatestTemuTrafficSync(
  id: number,
): Promise<TemuTrafficSyncStatus | null> {
  return (
    await http.get<ApiResponse<TemuTrafficSyncStatus | null>>(
      `/admin/temu-shops/${id}/traffic/sync/latest`,
    )
  ).data.data;
}

export async function getLatestTemuLifecycleSync(
  id: number,
): Promise<TemuLifecycleSyncStatus | null> {
  return (
    await http.get<ApiResponse<TemuLifecycleSyncStatus | null>>(
      `/admin/temu-shops/${id}/lifecycle/sync/latest`,
    )
  ).data.data;
}

export async function getTemuBrowserEvents(
  id: number,
): Promise<TemuBrowserEvent[]> {
  return (
    await http.get<ApiResponse<TemuBrowserEvent[]>>(
      `/admin/temu-shops/${id}/events`,
    )
  ).data.data;
}

export async function getZhihouAccount(): Promise<ZhihouAccount | null> {
  return (
    await http.get<ApiResponse<ZhihouAccount | null>>(
      "/admin/zhihou-erp/account",
    )
  ).data.data;
}

export async function saveZhihouAccount(
  input: ZhihouAccountInput,
): Promise<ZhihouAccount> {
  return (
    await http.put<ApiResponse<ZhihouAccount>>(
      "/admin/zhihou-erp/account",
      input,
    )
  ).data.data;
}

export async function testZhihouAccount(): Promise<ZhihouLoginTestResult> {
  return (
    await http.post<ApiResponse<ZhihouLoginTestResult>>(
      "/admin/zhihou-erp/account/test",
    )
  ).data.data;
}

export async function getLatestZhihouOrderSync(): Promise<
  ZhihouOrderSyncBatch | null
> {
  return (
    await http.get<ApiResponse<ZhihouOrderSyncBatch | null>>(
      "/admin/zhihou-erp/sync/latest",
    )
  ).data.data;
}

export async function syncZhihouPendingOrders(): Promise<ZhihouOrderSyncBatch> {
  return (
    await http.post<ApiResponse<ZhihouOrderSyncBatch>>(
      "/admin/zhihou-erp/sync",
    )
  ).data.data;
}

export async function getZhihouOrderSummary(params: {
  search?: string;
  matchStatus?: ZhihouSkuMatchStatus;
} = {}): Promise<ZhihouOrderSummaryResponse> {
  return (
    await http.get<ApiResponse<ZhihouOrderSummaryResponse>>(
      "/zhihou-orders/summary",
      { params },
    )
  ).data.data;
}

export async function getZhihouOrderReferences(
  key: string,
): Promise<ZhihouOrderReferencesResponse> {
  return (
    await http.get<ApiResponse<ZhihouOrderReferencesResponse>>(
      `/zhihou-orders/summary/${encodeURIComponent(key)}/orders`,
    )
  ).data.data;
}

export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error))
    return error.response?.data?.error?.message ?? error.message;
  return error instanceof Error ? error.message : "操作失败";
}
