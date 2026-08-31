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

export interface ImageDownloadConcurrencySettings {
  legacyImportConcurrency: number;
  globalQueueConcurrency: number;
  updatedAt: string | null;
}

export interface ImageDownloadConcurrencySettingsInput {
  legacyImportConcurrency: number;
  globalQueueConcurrency: number;
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

export interface ProductManagementSettings {
  shippingCostPerKg: number;
  recommendedProfitMargin: number;
  profitThresholdRate: number;
  updatedAt: string | null;
}

export interface TemuLifecycleSyncStatus {
  id: number;
  shopProfileId: number;
  requestedByUsername: string;
  pageSize: number;
  totalPages: number;
  totalSpus: number;
  totalSkcs: number;
  totalSkus: number;
  status: "running" | "completed" | "failed" | "partial";
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface TemuLifecycleSku {
  id: number;
  skuId: string | null;
  skuCode: string | null;
  sizeName: string | null;
  specificationJson: string | null;
  lowestSupplierPrice: number | null;
  trafficLimitPrice: number | null;
  /** @deprecated 使用 trafficLimitPrice。 */
  suggestedPrice: number | null;
}

export interface TemuLifecycleSkc {
  id: number;
  skcId: string | null;
  skcCode: string | null;
  attributeJson: string | null;
  /** 生命周期返回的 SKC 规格图 URL。 */
  imageUrl: string | null;
  /** 图片下载完成后的本地资产 ID。 */
  imageAssetId: number | null;
  lowestSupplierPrice: number | null;
  /** @deprecated 使用 lowestSupplierPrice。 */
  lowestReviewPrice: number | null;
  trafficLimitPrice: number | null;
  skus: TemuLifecycleSku[];
}

export interface TemuLifecycleSpu {
  id: number;
  spu: string;
  productId: string | null;
  productCode: string | null;
  mainImageUrl: string | null;
  skcs: TemuLifecycleSkc[];
  lowestSupplierPrice: number | null;
  /** @deprecated 使用 lowestSupplierPrice。 */
  lowestReviewPrice: number | null;
  trafficLimitPrice: number | null;
  lastSyncBatchId: number;
}

export interface TemuLifecycleListResponse {
  shopProfileId: number;
  latestSync: TemuLifecycleSyncStatus | null;
  items: TemuLifecycleSpu[];
}

export interface ProductLifecycleSkuDetail {
  skuId: string | null;
  skuCode: string | null;
  displayCode: string | null;
  sizeName: string | null;
  attributes: string[];
  lowestSupplierPrice: number | null;
  trafficLimitPrice: number | null;
}

export interface ProductLifecycleSkcDetail {
  skcId: string | null;
  skcCode: string | null;
  displayCode: string | null;
  attributes: string[];
  lowestSupplierPrice: number | null;
  trafficLimitPrice: number | null;
  skus: ProductLifecycleSkuDetail[];
}

export interface ProductLifecycleSpuDetail {
  spu: string;
  lowestSupplierPrice: number | null;
  trafficLimitPrice: number | null;
  skcs: ProductLifecycleSkcDetail[];
}

export interface ProductLifecycleMatch {
  matchType: "skc" | "sku" | "none";
  spu: string | null;
  skcCodes: string[];
  skuCodes: string[];
  skcAttributes: string[];
  skuAttributes: string[];
  lowestSupplierPrice: number | null;
  /** @deprecated 使用 lowestSupplierPrice。 */
  lowestReviewPrice: number | null;
  trafficLimitPrice: number | null;
  details: ProductLifecycleSpuDetail[];
}

export type Y2InventoryMatchStatus = "matched" | "unmatched" | "conflict";

export interface Y2InventorySummary {
  inventoryId: number;
  totalQuantity: number;
  matchedColorCount: number;
  unmatchedColorCount: number;
  conflictColorCount: number;
}

export interface Y2InventoryCell {
  id: number;
  size: string;
  quantity: number;
  skuRowId: number | null;
  skuId: string | null;
  skuCode: string | null;
  matchStatus: Y2InventoryMatchStatus;
  matchMessage: string | null;
}

export interface Y2InventorySpuSpec {
  spu: string;
  colorRowId: number;
  cellId: number;
  skcRowId: number | null;
  skuRowId: number | null;
}

export interface Y2InventoryColorRow {
  id: number;
  color: string;
  skcRowId: number | null;
  skcId: string | null;
  skcCode: string | null;
  imageUrl: string | null;
  matchStatus: Y2InventoryMatchStatus;
  matchMessage: string | null;
  totalQuantity: number;
  cells: Y2InventoryCell[];
}

export interface Y2InventoryRecord {
  id: number;
  productManagementRecordId: number | null;
  productCode: string | null;
  spu: string | null;
  productCodes: string[];
  spus: string[];
  imageAssetId: number | null;
  imageUrl: string | null;
  note: string | null;
  sizes: string[];
  totalQuantity: number;
  matchedColorCount: number;
  unmatchedColorCount: number;
  conflictColorCount: number;
  colors: Y2InventoryColorRow[];
  spuSpecs: Y2InventorySpuSpec[];
  createdAt: string;
  updatedAt: string;
}

export interface Y2InventoryListItem extends Y2InventoryRecord {}

export interface Y2InventoryListResponse {
  items: Y2InventoryListItem[];
  totalQuantity: number;
  matchedCount: number;
  issueCount: number;
}

export interface Y2InventoryCellInput {
  size: string;
  quantity: number;
  skuRowId?: number | null | undefined;
}

export interface Y2InventorySpuSpecInput {
  spu: string;
  skcRowId: number | null;
  cells: Array<{
    size: string;
    skuRowId: number | null;
  }>;
}

export interface Y2InventoryColorInput {
  color?: string | undefined;
  skcRowId?: number | null | undefined;
  cells: Y2InventoryCellInput[];
  spuSpecs?: Y2InventorySpuSpecInput[];
}

export interface Y2InventoryRecordInput {
  productCode: string | null;
  spu: string | null;
  productCodes?: string[];
  spus?: string[];
  imageAssetId: number | null;
  note: string | null;
  sizes: string[];
  colors: Y2InventoryColorInput[];
}

export interface Y2InventoryImageUploadResult {
  assetId: number;
  imageUrl: string;
}

export interface Y2InventoryChangeLog {
  id: number;
  inventoryProductId: number | null;
  productCode: string;
  action: "create" | "update" | "delete";
  changedByUsername: string;
  beforeTotalQuantity: number | null;
  afterTotalQuantity: number | null;
  changedAt: string;
}

export interface Y2InventoryBindingCandidate {
  rowId: number;
  id: string | null;
  code: string | null;
  label: string;
  imageUrl: string | null;
}

export interface Y2InventoryBindingOptions {
  spu: string;
  resolvedFromProductCode: boolean;
  availableSpus?: string[];
  skcs: Array<Y2InventoryBindingCandidate & {
    skus: Y2InventoryBindingCandidate[];
  }>;
}

export interface ProductManagementBinding {
  id: number;
  skcId: string | null;
  skuId: string | null;
  skcCode: string | null;
  skuCode: string | null;
}

export interface ProductManagementTrafficLimitSku {
  skuId: string | null;
  skuCode: string | null;
  displayCode: string | null;
  sizeName: string | null;
  attributes: string[];
  trafficLimitPrice: number | null;
}

export interface ProductManagementTrafficLimitSkc {
  spu: string;
  skcId: string | null;
  skcCode: string | null;
  displayCode: string | null;
  attributes: string[];
  trafficLimitPrice: number;
  skus: ProductManagementTrafficLimitSku[];
}

export type ProductManagementImageStatus =
  | "ready"
  | "pending"
  | "processing"
  | "failed"
  | "remote_only"
  | "missing";

export interface ProductManagementSpuLink {
  id: number;
  spu: string | null;
  note: string | null;
  localImageUrl: string | null;
  remoteImageUrl: string | null;
  displayImageUrl: string | null;
  imageStatus: ProductManagementImageStatus;
  imageError: string | null;
  initialReviewPrice: number | null;
  reviewPrice: number | null;
  reviewProfitMargin: number | null;
  suggestedActivityDiscount: number | null;
  activityDiscountOverride: number | null;
  finalActivityDiscount: number | null;
  activityPrice: number | null;
  trafficPrice: number | null;
  roas: number | null;
  trafficLimitPrice: number | null;
  trafficLimitProfitMargin: number | null;
  trafficLimitSuggestedActivityDiscount: number | null;
  trafficLimitFinalActivityDiscount: number | null;
  trafficLimitActivityPrice: number | null;
  trafficLimitTrafficPrice: number | null;
  trafficLimitRoas: number | null;
  orderCount: number | null;
  bindings: ProductManagementBinding[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductManagementRecord {
  id: number;
  shopProfileId: number;
  createdByUserId: number;
  createdByUsername: string;
  canEdit: boolean;
  productCode: string;
  /** @deprecated 旧内部字段，仅为数据库和备份兼容保留，不用于页面展示。 */
  internalProductId: string | null;
  serialNumber: string | null;
  weightKg: number;
  goodsValue: number | null;
  totalCost: number | null;
  profitThresholdPrice: number | null;
  recommendedPrice: number | null;
  imageUrl: string | null;
  purchaseLinks: string[];
  spuLinks: ProductManagementSpuLink[];
  lifecycleMatch: ProductLifecycleMatch;
  y2Inventory: Y2InventorySummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductManagementBindingInput {
  skcId: string | null;
  skuId: string | null;
  skcCode: string | null;
  skuCode: string | null;
}

export interface ProductManagementSpuLinkInput {
  spu: string | null;
  note: string | null;
  initialReviewPrice: number | null;
  reviewPrice: number | null;
  activityDiscountOverride: number | null;
  orderCount: number | null;
  bindings: ProductManagementBindingInput[];
}

export interface ProductManagementRecordInput {
  productCode: string;
  weightKg: number;
  /** 手工货值；为空时使用货号自动解析值。 */
  goodsValue: number | null;
  purchaseLinks: string[];
  spuLinks: ProductManagementSpuLinkInput[];
}

export const PRODUCT_MANAGEMENT_COLUMN_KEYS = [
  "image",
  "productCode",
  "y2Inventory",
  "serialNumber",
  "goodsValue",
  "totalCost",
  "profitThresholdPrice",
  "recommendedPrice",
  "spu",
  "spuNote",
  "initialReviewPrice",
  "reviewPrice",
  "reviewProfitMargin",
  "suggestedActivityDiscount",
  "finalActivityDiscount",
  "activityPrice",
  "trafficPrice",
  "roas",
  "trafficLimitPrice",
  "trafficLimitProfitMargin",
  "trafficLimitSuggestedActivityDiscount",
  "trafficLimitFinalActivityDiscount",
  "trafficLimitActivityPrice",
  "trafficLimitTrafficPrice",
  "trafficLimitRoas",
  "orderCount",
  "purchaseLinks",
  "createdBy",
] as const;

export type ProductManagementColumnKey =
  (typeof PRODUCT_MANAGEMENT_COLUMN_KEYS)[number];

export interface ProductManagementColumnPreferences {
  visibleColumns: ProductManagementColumnKey[];
}

export const PRODUCT_MANAGEMENT_PAGE_SIZES = [20, 50, 100, 200] as const;

export type ProductManagementPageSize =
  (typeof PRODUCT_MANAGEMENT_PAGE_SIZES)[number];

export interface ProductManagementListResponse {
  scope: "mine" | "shop";
  settings: ProductManagementSettings;
  columnPreferences: ProductManagementColumnPreferences;
  page: number;
  pageSize: ProductManagementPageSize;
  total: number;
  totalPages: number;
  records: ProductManagementRecord[];
}

export type ZhihouAccountTestStatus = "untested" | "success" | "failed";
export type ZhihouSyncStatus = "running" | "completed" | "failed";
export type ZhihouSkuMatchStatus = "matched" | "unmatched" | "conflict";
export type ZhihouSkuMatchType = "sku_id" | "sku_code" | "none";

export interface ZhihouAccount {
  id: number;
  account: string;
  enabled: boolean;
  hasPassword: boolean;
  lastTestStatus: ZhihouAccountTestStatus;
  lastTestedAt: string | null;
  lastTestError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ZhihouAccountInput {
  account: string;
  password?: string | undefined;
  enabled: boolean;
}

export interface ZhihouLoginTestResult {
  success: boolean;
  account: string;
  testedAt: string;
  message: string;
}

export interface ZhihouOrderSyncBatch {
  id: number;
  requestedByUserId: number;
  requestedByUsername: string;
  status: ZhihouSyncStatus;
  pageCount: number;
  orderCount: number;
  itemCount: number;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

/**
 * 智猴订单和库存响应中的 `spu` 实际承载 SKU。本系统统一命名为
 * `zhihouSku`，禁止将该值直接当作产品管理的上级 SPU 使用。
 */
export interface ZhihouNewOrderItem {
  id: number;
  syncBatchId: number;
  orderNo: string;
  zhihouSku: string;
  productName: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  specificationImageUrl: string | null;
  mainImageUrl: string | null;
  storeName: string | null;
  countryCode: string | null;
  submittedAt: string | null;
}

export interface ZhihouSkuMatchResult {
  status: ZhihouSkuMatchStatus;
  matchType: ZhihouSkuMatchType;
  zhihouSku: string;
  productManagementRecordId: number | null;
  shopProfileId: number | null;
  parentSpu: string | null;
  productCode: string | null;
  purchaseLinks: string[];
  message: string | null;
}

export interface ZhihouOrderReference {
  orderNo: string;
  quantity: number;
  storeName: string | null;
  countryCode: string | null;
  submittedAt: string | null;
}

export interface ZhihouInventoryPickOption {
  inventoryCellId: number;
  productCode: string;
  color: string;
  size: string;
  quantity: number;
  isExact: boolean;
  isSavedConversion: boolean;
}

export interface ZhihouStockPickInput {
  targetKey: string;
  inventoryCellId: number;
  quantity: number;
  saveConversion: boolean;
}

export interface ZhihouStockPickItem {
  id: number;
  imageUrl: string | null;
  imageUrls: string[];
  targetKey: string;
  parentSpu: string | null;
  targetZhihouSku: string;
  targetColor: string;
  targetSize: string;
  inventoryCellId: number;
  productCode: string;
  sourceColor: string;
  sourceSize: string;
  pickedQuantity: number;
  matchedQuantity: number;
  unmatchedQuantity: number;
  adjustedQuantity: number;
  inventoryAdjusted: boolean;
  createdAt: string;
}

export interface ZhihouAllocatedOrderItem {
  pickItemId: number;
  targetZhihouSku: string;
  targetColor: string;
  targetSize: string;
  sourceColor: string;
  sourceSize: string;
  quantity: number;
}

export interface ZhihouAllocatedOrder {
  orderNo: string;
  submittedAt: string | null;
  requiredQuantity: number;
  allocatedQuantity: number;
  complete: boolean;
  items: ZhihouAllocatedOrderItem[];
}

export interface ZhihouStockPickDashboard {
  picks: ZhihouStockPickItem[];
  orders: ZhihouAllocatedOrder[];
  totalPickedQuantity: number;
  totalUnmatchedQuantity: number;
  totalUnadjustedQuantity: number;
  completedOrderCount: number;
}

export interface ZhihouStockMatchResult {
  allocatedQuantity: number;
  completedOrderCount: number;
}

export interface ZhihouBatchStockPickInput {
  targetKeys: string[];
}

export interface ZhihouBatchStockPickPreview {
  targetCount: number;
  pickableTargetCount: number;
  expectedQuantity: number;
  insufficientTargetCount: number;
  unavailableTargetCount: number;
}

export interface ZhihouBatchStockPickResult extends ZhihouBatchStockPickPreview {
  pickedQuantity: number;
  createdPickCount: number;
}

export interface ZhihouInventoryAdjustmentResult {
  adjustedQuantity: number;
  adjustedPickCount: number;
  skippedPickCount: number;
}

export interface ZhihouOrderMatrixCell {
  key: string;
  productManagementRecordId: number | null;
  parentSpu: string | null;
  zhihouSkus: string[];
  productCodes: string[];
  color: string;
  size: string;
  requiredQuantity: number;
  y2InventoryQuantity: number | null;
  inventoryPickableQuantity: number;
  pickedQuantity: number;
  remainingPurchaseQuantity: number;
  inventoryDifference: number | null;
  suggestedPurchaseQuantity: number | null;
  inventoryPickOptions: ZhihouInventoryPickOption[];
  inventoryMatchStatus: Y2InventoryMatchStatus | null;
  inventoryMatchMessage: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  purchaseLinks: string[];
  matchStatus: ZhihouSkuMatchStatus;
  matchMessage: string | null;
  orderCount: number;
  orderNos: string[];
}

export interface ZhihouOrderMatrixColorRow {
  key: string;
  color: string;
  imageUrl: string | null;
  imageUrls: string[];
  requiredQuantity: number;
  y2InventoryQuantity: number;
  suggestedPurchaseQuantity: number;
  cells: Record<string, ZhihouOrderMatrixCell>;
}

export interface ZhihouOrderMatrix {
  key: string;
  productManagementRecordId: number | null;
  parentSpu: string | null;
  fallbackSku: string | null;
  productCodes: string[];
  purchaseLinks: string[];
  sizes: string[];
  colorRows: ZhihouOrderMatrixColorRow[];
  requiredQuantity: number;
  y2InventoryQuantity: number;
  inventoryPickableQuantity: number;
  pickedQuantity: number;
  remainingPurchaseQuantity: number;
  suggestedPurchaseQuantity: number;
  matchStatus: ZhihouSkuMatchStatus;
}

export interface ZhihouOrderSummaryResponse {
  latestSync: ZhihouOrderSyncBatch | null;
  storeNames: string[];
  matrices: ZhihouOrderMatrix[];
  totalRequiredQuantity: number;
  totalY2InventoryQuantity: number;
  totalSuggestedPurchaseQuantity: number;
  matchedRowCount: number;
  unmatchedRowCount: number;
  conflictRowCount: number;
}

export interface ZhihouOrderReferencesResponse {
  summaryKey: string;
  orders: ZhihouOrderReference[];
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
