export type UserRole = "admin" | "user";

export interface UserAccount {
  id: number;
  username: string;
  role: UserRole;
  enabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ShopAccess {
  id: number;
  name: string;
  accountLabel: string;
  mallId: string | null;
  enabled: boolean;
}

export interface AuthSession {
  user: UserAccount;
  activeShop: ShopAccess;
  availableShops: ShopAccess[];
}

export interface LoginInput {
  username: string;
  password: string;
}

export type RegisterInput = LoginInput;

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface AdminUserUpdateInput {
  role?: UserRole | undefined;
  enabled?: boolean | undefined;
}

export interface AdminPasswordResetInput {
  newPassword: string;
}

export type MetricKey =
  | "impressions"
  | "clicks"
  | "visitors"
  | "cartUsers"
  | "orders"
  | "detailPaidBuyers"
  | "detailPaymentConversionRate"
  | "impressionOrderConversionRate"
  | "searchImpressions";

export interface DailyMetric {
  date: string;
  spu: string;
  firstListedAt: string | null;
  impressions: number;
  clicks: number;
  visitors: number;
  cartUsers: number;
  orders: number;
  detailPaidBuyers: number;
  detailPaymentConversionRate: number | null;
  impressionOrderConversionRate: number | null;
  searchImpressions: number;
}

export type ImageSource = "embedded" | "remote" | "none";

export interface ProductSummary extends DailyMetric {
  imageUrl: string | null;
  imageSource: ImageSource;
  clickThroughRate: number | null;
  cartRate: number | null;
  orderRate: number | null;
}

export interface MetricTotals {
  productCount: number;
  impressions: number;
  clicks: number;
  visitors: number;
  cartUsers: number;
  orders: number;
  detailPaidBuyers: number;
  searchImpressions: number;
  clickThroughRate: number | null;
  cartRate: number | null;
  detailPaymentConversionRate: number | null;
  impressionOrderConversionRate: number | null;
}

export interface TrendPoint extends MetricTotals {
  date: string;
}

export interface DashboardResponse {
  selectedDate: string | null;
  previousDate: string | null;
  availableDates: string[];
  totals: MetricTotals;
  previousTotals: MetricTotals | null;
  trend: TrendPoint[];
  rankings: ProductSummary[];
}

export interface ProductDetailResponse {
  spu: string;
  imageUrl: string | null;
  imageSource: ImageSource;
  firstListedAt: string | null;
  history: ProductSummary[];
}

export interface SpuComparisonCandidate {
  spu: string;
  imageUrl: string | null;
  imageSource: ImageSource;
  firstListedAt: string | null;
  latestDate: string;
}

export interface SpuComparisonProduct {
  spu: string;
  imageUrl: string | null;
  imageSource: ImageSource;
  firstListedAt: string | null;
  selected: ProductSummary;
  history: ProductSummary[];
}

export interface SpuComparisonResponse {
  selectedDate: string;
  commonDates: string[];
  products: SpuComparisonProduct[];
}

export interface ProductOperationRecord {
  id: number;
  spu: string;
  operatedAt: string;
  content: string;
  note: string | null;
  createdByUsername: string;
  updatedByUsername: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductOperationInput {
  operatedAt: string;
  content: string;
  note: string | null;
}

export interface GlobalOperationRecord {
  id: number;
  operatedAt: string;
  content: string;
  note: string | null;
  createdByUsername: string;
  updatedByUsername: string;
  createdAt: string;
  updatedAt: string;
}

export type GlobalOperationInput = ProductOperationInput;

export interface ImportIssue {
  row: number | null;
  field: string | null;
  severity: "warning" | "error";
  message: string;
}

export interface ImportPreview {
  token: string;
  fileName: string;
  dataDate: string;
  rowCount: number;
  validRowCount: number;
  duplicateDate: boolean;
  existingRowCount: number;
  embeddedImageCount: number;
  remoteImageCount: number;
  issues: ImportIssue[];
  sample: ProductSummary[];
}

export type ImageTaskStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface ProductBatchOperationInput extends ProductOperationInput {
  spus: string[];
}

export interface ProductBatchOperationFailure {
  spu: string;
  reason: string;
}

export interface ProductBatchOperationResult {
  requestedCount: number;
  successCount: number;
  succeededSpus: string[];
  failures: ProductBatchOperationFailure[];
}

export interface ImageTaskProgress {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  percent: number;
}

export interface ImportCommitResponse {
  batchId: number;
  dataDate: string;
  importedRows: number;
  replacedRows: number;
  imageCount: number;
  queuedImageCount: number;
}

export interface ImportBatch {
  id: number;
  fileName: string;
  dataDate: string;
  rowCount: number;
  importedAt: string;
  status: "completed" | "failed" | "rolled_back";
  replacedBatchId: number | null;
  issueCount: number;
  imageProgress: ImageTaskProgress;
}

export type AnomalyType =
  | "impressions_drop"
  | "ctr_drop"
  | "cart_rate_drop"
  | "conversion_drop"
  | "zero_orders"
  | "data_quality";

export interface AnomalyItem {
  type: AnomalyType;
  severity: "info" | "warning" | "critical";
  spu: string;
  date: string;
  title: string;
  description: string;
  currentValue: number | null;
  previousValue: number | null;
  changeRate: number | null;
}

export interface AnomalyThresholds {
  impressionsDrop: number;
  clickThroughRateDrop: number;
  cartRateDrop: number;
  conversionRateDrop: number;
  consecutiveZeroOrderDays: number;
  minimumImpressions: number;
}

export type TemuBrowserRuntimeStatus =
  | "STOPPED"
  | "STARTING"
  | "READY"
  | "LOGIN_REQUIRED"
  | "RISK_BLOCKED"
  | "ERROR";

export interface TemuShopGrantUser {
  id: number;
  username: string;
}

export interface TemuShopProfile {
  id: number;
  name: string;
  accountLabel: string;
  profileKey: string;
  mallId: string | null;
  cdpPort: number;
  fingerprintSeed: string;
  locale: string;
  timezone: string;
  enabled: boolean;
  runtimeStatus: TemuBrowserRuntimeStatus;
  processId: number | null;
  lastStartedAt: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  grantedUsers: TemuShopGrantUser[];
}

export interface TemuShopProfileCreateInput {
  name: string;
  accountLabel: string;
  locale?: string;
  timezone?: string;
  enabled?: boolean;
  grantedUserIds?: number[];
}

export interface TemuShopProfileUpdateInput {
  name?: string | undefined;
  accountLabel?: string | undefined;
  locale?: string | undefined;
  timezone?: string | undefined;
  enabled?: boolean | undefined;
}

export interface TemuShopGrantUpdateInput {
  userIds: number[];
}

export interface TemuBrowserEvent {
  id: number;
  shopProfileId: number;
  eventType: string;
  status: TemuBrowserRuntimeStatus | null;
  message: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface TemuBrowserActionResult {
  profile: TemuShopProfile;
  message: string;
}

export interface TemuTrafficSyncStatus {
  id: number;
  shopProfileId: number;
  requestedByUsername: string;
  timeDimension: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  importedItems: number;
  replacedItems: number;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface TemuTrafficSyncActionResult {
  sync: TemuTrafficSyncStatus;
  message: string;
}

export interface ApiResponse<T> {
  data: T;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
