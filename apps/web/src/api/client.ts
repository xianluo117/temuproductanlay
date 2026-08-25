import axios from 'axios';
import type {
  AdminPasswordResetInput,
  AdminUserUpdateInput,
  AnomalyItem,
  AuthSession,
  ChangePasswordInput,
  AnomalyThresholds,
  ApiResponse,
  DashboardResponse,
  GlobalOperationInput,
  GlobalOperationRecord,
  ImportBatch,
  ImportCommitResponse,
  ImportPreview,
  ProductBatchOperationInput,
  ProductBatchOperationResult,
  ProductDetailResponse,
  ProductOperationInput,
  ProductOperationRecord,
  ProductSummary,
  SpuComparisonCandidate,
  SpuComparisonResponse,
  UserAccount,
} from '@temu-analytics/shared';

export interface BackupInfo {
  fileName: string;
  type: 'automatic' | 'manual' | 'pre_restore';
  createdAt: string;
  localDate: string;
  latestDataDate: string | null;
  earliestDataDate: string | null;
  importBatchCount: number;
  metricRowCount: number;
  productCount: number;
  byteSize: number;
}

const http = axios.create({ baseURL: '/api', timeout: 120_000, withCredentials: true });

export async function login(username: string, password: string): Promise<AuthSession> {
  return (await http.post<ApiResponse<AuthSession>>('/auth/login', { username, password })).data.data;
}

export async function register(username: string, password: string): Promise<AuthSession> {
  return (await http.post<ApiResponse<AuthSession>>('/auth/register', { username, password })).data.data;
}

export async function getSession(): Promise<AuthSession> {
  return (await http.get<ApiResponse<AuthSession>>('/auth/session')).data.data;
}

export async function logout(): Promise<void> {
  await http.post('/auth/logout');
}

export async function changePassword(input: ChangePasswordInput): Promise<void> {
  await http.put('/auth/password', input);
}

export async function getUsers(): Promise<UserAccount[]> {
  return (await http.get<ApiResponse<UserAccount[]>>('/auth/users')).data.data;
}

export async function switchActiveOwner(id: number): Promise<AuthSession> {
  return (await http.put<ApiResponse<AuthSession>>(`/auth/active-owner/${id}`)).data.data;
}

export async function updateUser(id: number, input: AdminUserUpdateInput): Promise<UserAccount> {
  return (await http.patch<ApiResponse<UserAccount>>(`/auth/users/${id}`, input)).data.data;
}

export async function resetUserPassword(id: number, input: AdminPasswordResetInput): Promise<void> {
  await http.post(`/auth/users/${id}/reset-password`, input);
}

export async function getDashboard(date?: string): Promise<DashboardResponse> {
  return (await http.get<ApiResponse<DashboardResponse>>('/dashboard', { params: { date } })).data.data;
}

export async function getProducts(params: Record<string, string | undefined>): Promise<ProductSummary[]> {
  return (await http.get<ApiResponse<ProductSummary[]>>('/products', { params })).data.data;
}

export async function getProductDetail(spu: string): Promise<ProductDetailResponse> {
  return (await http.get<ApiResponse<ProductDetailResponse>>(`/products/${spu}`)).data.data;
}

export async function getSpuComparisonCandidates(): Promise<SpuComparisonCandidate[]> {
  return (await http.get<ApiResponse<SpuComparisonCandidate[]>>('/spu-comparison/candidates')).data.data;
}

export async function getSpuComparison(spus: string[], date?: string): Promise<SpuComparisonResponse> {
  return (await http.get<ApiResponse<SpuComparisonResponse>>('/spu-comparison', {
    params: { spus: spus.join(','), date },
  })).data.data;
}

export async function getGlobalOperations(): Promise<GlobalOperationRecord[]> {
  return (await http.get<ApiResponse<GlobalOperationRecord[]>>('/global-operations')).data.data;
}

export async function createGlobalOperation(input: GlobalOperationInput): Promise<GlobalOperationRecord> {
  return (await http.post<ApiResponse<GlobalOperationRecord>>('/global-operations', input)).data.data;
}

export async function updateGlobalOperation(id: number, input: GlobalOperationInput): Promise<GlobalOperationRecord> {
  return (await http.put<ApiResponse<GlobalOperationRecord>>(`/global-operations/${id}`, input)).data.data;
}

export async function deleteGlobalOperation(id: number): Promise<void> {
  await http.delete(`/global-operations/${id}`);
}

export async function createProductOperationsBatch(input: ProductBatchOperationInput): Promise<ProductBatchOperationResult> {
  return (await http.post<ApiResponse<ProductBatchOperationResult>>('/products/operations/batch', input)).data.data;
}

export async function getProductOperations(spu: string): Promise<ProductOperationRecord[]> {
  return (await http.get<ApiResponse<ProductOperationRecord[]>>(`/products/${encodeURIComponent(spu)}/operations`)).data.data;
}

export async function createProductOperation(spu: string, input: ProductOperationInput): Promise<ProductOperationRecord> {
  return (await http.post<ApiResponse<ProductOperationRecord>>(`/products/${encodeURIComponent(spu)}/operations`, input)).data.data;
}

export async function updateProductOperation(spu: string, id: number, input: ProductOperationInput): Promise<ProductOperationRecord> {
  return (await http.put<ApiResponse<ProductOperationRecord>>(`/products/${encodeURIComponent(spu)}/operations/${id}`, input)).data.data;
}

export async function deleteProductOperation(spu: string, id: number): Promise<void> {
  await http.delete(`/products/${encodeURIComponent(spu)}/operations/${id}`);
}

export async function previewImport(file: File): Promise<ImportPreview> {
  const form = new FormData();
  form.append('file', file);
  return (await http.post<ApiResponse<ImportPreview>>('/imports/preview', form)).data.data;
}

export async function commitImport(token: string, overwrite: boolean): Promise<ImportCommitResponse> {
  return (await http.post<ApiResponse<ImportCommitResponse>>('/imports/commit', { token, overwrite })).data.data;
}

export async function getImports(): Promise<ImportBatch[]> {
  return (await http.get<ApiResponse<ImportBatch[]>>('/imports')).data.data;
}

export async function getAnomalies(date?: string): Promise<AnomalyItem[]> {
  return (await http.get<ApiResponse<AnomalyItem[]>>('/anomalies', { params: { date } })).data.data;
}

export async function getThresholds(): Promise<AnomalyThresholds> {
  return (await http.get<ApiResponse<AnomalyThresholds>>('/settings/anomaly-thresholds')).data.data;
}

export async function saveThresholds(value: AnomalyThresholds): Promise<AnomalyThresholds> {
  return (await http.put<ApiResponse<AnomalyThresholds>>('/settings/anomaly-thresholds', value)).data.data;
}

export async function getBackups(): Promise<BackupInfo[]> {
  return (await http.get<ApiResponse<BackupInfo[]>>('/backups')).data.data;
}

export async function createBackup(): Promise<BackupInfo> {
  return (await http.post<ApiResponse<BackupInfo>>('/backups')).data.data;
}

export async function restoreStoredBackup(fileName: string): Promise<void> {
  await http.post(`/backups/${encodeURIComponent(fileName)}/restore`);
}

export async function restoreUploadedBackup(file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  await http.post('/backups/restore', form);
}

export async function getSystemBackups(): Promise<BackupInfo[]> {
  return (await http.get<ApiResponse<BackupInfo[]>>('/system-backups')).data.data;
}

export async function createSystemBackup(): Promise<BackupInfo> {
  return (await http.post<ApiResponse<BackupInfo>>('/system-backups')).data.data;
}

export async function restoreStoredSystemBackup(fileName: string): Promise<void> {
  await http.post(`/system-backups/${encodeURIComponent(fileName)}/restore`);
}

export async function restoreUploadedSystemBackup(file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  await http.post('/system-backups/restore', form);
}

export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) return error.response?.data?.error?.message ?? error.message;
  return error instanceof Error ? error.message : '操作失败';
}
