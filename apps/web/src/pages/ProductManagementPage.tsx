import {
  DeleteOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import {
  PRODUCT_MANAGEMENT_COLUMN_KEYS,
  type ProductManagementColumnKey,
  type ProductManagementListResponse,
  type ProductManagementRecord,
  type ProductManagementTrafficLimitSkc,
  type Y2InventoryRecord,
  type ProductManagementRecordInput,
  type ProductManagementSettings,
  type ProductManagementSpuLink,
  type ProductDetailResponse,
  type ProductManagementBySpuResponse,
} from "@temu-analytics/shared";
import {
  Button,
  Card,
  Checkbox,
  DatePicker,
  Select,
  Divider,
  Drawer,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Tooltip,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Key } from "react";
import type { Dayjs } from "dayjs";
import {
  createProductManagementRecord,
  deleteProductManagementRecord,
  errorMessage,
  getProductManagementRecord,
  getProductDetail,
  getProductManagementBySpu,
  getProductManagementRecords,
  getY2Inventory,
  getProductManagementTrafficLimitSkcs,
  saveProductManagementColumnPreferences,
  saveProductManagementPageSize,
  saveProductManagementSettings,
  updateProductManagementRecord,
  type ProductManagementSearchParams,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ProductLifecycleDetailModal } from "../components/product-management/ProductLifecycleDetailModal";
import { ProductManagementSpuDrawer } from "../components/product-management/ProductManagementSpuDrawer";
import { SpuTrafficDrawer } from "../components/product-management/SpuTrafficDrawer";
import { ProductTrafficLimitSkcDrawer } from "../components/product-management/ProductTrafficLimitSkcDrawer";

const { Title, Text, Link } = Typography;

type Scope = "mine" | "shop";

type MetricFilter = { min: number | null; max: number | null };

interface SearchValues {
  spu: string;
  skc: string;
  sku: string;
  productCode: string;
  firstListedAtRange: [Dayjs, Dayjs] | null;
  reviewProfitMargin: MetricFilter;
  suggestedActivityDiscount: MetricFilter;
  roas: MetricFilter;
  trafficLimitProfitMargin: MetricFilter;
}

const columnLabels: Record<ProductManagementColumnKey, string> = {
  image: "图片",
  productCode: "货号",
  y2Inventory: "Y2库存",
  serialNumber: "序列号",
  goodsValue: "货值",
  totalCost: "总成本",
  profitThresholdPrice: "利率门槛值",
  recommendedPrice: "推荐售价",
  spu: "SPU",
  firstListedAt: "入站时间",
  spuNote: "SPU备注",
  initialReviewPrice: "初次核价最低价",
  reviewPrice: "核价价",
  reviewProfitMargin: "核价利润率",
  suggestedActivityDiscount: "建议折扣",
  finalActivityDiscount: "最终折扣",
  activityPrice: "活动价",
  trafficPrice: "流量价",
  roas: "ROAS",
  trafficLimitPrice: "限流价格",
  trafficLimitProfitMargin: "限流利润率",
  trafficLimitSuggestedActivityDiscount: "限流建议折扣",
  trafficLimitFinalActivityDiscount: "限流最终折扣",
  trafficLimitActivityPrice: "限流活动价",
  trafficLimitTrafficPrice: "限流流量价",
  trafficLimitRoas: "限流 ROAS",
  orderCount: "订单数量",
  purchaseLinks: "进货链接",
  createdBy: "创建人",
};

const columnOrder: Array<ProductManagementColumnKey | null> = [
  "image",
  "spu",
  ...PRODUCT_MANAGEMENT_COLUMN_KEYS.filter((key) => key !== "image" && key !== "spu"),
  null,
];

const emptySearch: SearchValues = {
  spu: "",
  skc: "",
  sku: "",
  productCode: "",
  firstListedAtRange: null,
  reviewProfitMargin: { min: null, max: null },
  suggestedActivityDiscount: { min: null, max: null },
  roas: { min: null, max: null },
  trafficLimitProfitMargin: { min: null, max: null },
};

function activeSearch(values: SearchValues): ProductManagementSearchParams {
  const result: ProductManagementSearchParams = {};
  if (values.spu.trim()) result.spu = values.spu.trim();
  if (values.skc.trim()) result.skc = values.skc.trim();
  if (values.sku.trim()) result.sku = values.sku.trim();
  if (values.productCode.trim()) result.productCode = values.productCode.trim();
  if (values.firstListedAtRange) {
    result.firstListedAtStart = values.firstListedAtRange[0].format("YYYY-MM-DD");
    result.firstListedAtEnd = values.firstListedAtRange[1].format("YYYY-MM-DD");
  }
  const filters = [
    ["reviewProfitMargin", values.reviewProfitMargin],
    ["suggestedActivityDiscount", values.suggestedActivityDiscount],
    ["roas", values.roas],
    ["trafficLimitProfitMargin", values.trafficLimitProfitMargin],
  ] as const;
  for (const [key, filter] of filters) {
    if (filter.min !== null) result[`${key}Min` as keyof ProductManagementSearchParams] = filter.min as never;
    if (filter.max !== null) result[`${key}Max` as keyof ProductManagementSearchParams] = filter.max as never;
  }
  return result;
}

const emptySpu = (): ProductManagementRecordInput["spuLinks"][number] => ({
  spu: null,
  note: null,
  initialReviewPrice: null,
  reviewPrice: null,
  activityDiscountOverride: null,
  orderCount: null,
  bindings: [],
});

const emptyInput: ProductManagementRecordInput = {
  productCode: "",
  weightKg: 0.3,
  goodsValue: null,
  purchaseLinks: [],
  spuLinks: [emptySpu()],
};

function money(value: number | null): string {
  return value === null ? "-" : value.toFixed(2);
}

function percent(value: number | null): string {
  return value === null ? "-" : `${(value * 100).toFixed(1)}%`;
}

function profitTag(value: number | null) {
  if (value === null) return <Tag>缺失</Tag>;
  return <Tag color={value >= 0.45 ? "green" : value >= 0.3 ? "orange" : "red"}>{percent(value)}</Tag>;
}

function productManagementColumnGroup(key: ProductManagementColumnKey | null | undefined): string {
  if (key === null) return "actions";
  if (["image", "productCode", "y2Inventory", "serialNumber"].includes(key ?? "")) return "identity";
  if (["goodsValue", "totalCost", "profitThresholdPrice", "recommendedPrice"].includes(key ?? "")) return "cost";
  if (["spu", "firstListedAt", "spuNote", "initialReviewPrice", "reviewPrice", "reviewProfitMargin"].includes(key ?? "")) return "review";
  if (["suggestedActivityDiscount", "finalActivityDiscount", "activityPrice", "trafficPrice", "roas"].includes(key ?? "")) return "campaign";
  if ((key ?? "").startsWith("trafficLimit")) return "limit";
  if (key === "orderCount") return "conversion";
  return "meta";
}

function toInput(
  record: ProductManagementRecord,
): ProductManagementRecordInput {
  return {
    productCode: record.productCode,
    weightKg: record.weightKg,
    goodsValue: record.goodsValue,
    purchaseLinks: record.purchaseLinks,
    spuLinks: record.spuLinks.map((link) => ({
      spu: link.spu,
      note: link.note,
      initialReviewPrice: link.initialReviewPrice,
      reviewPrice: null,
      activityDiscountOverride: link.activityDiscountOverride,
      orderCount: link.orderCount,
      bindings: link.bindings.map((binding) => ({
        skcId: binding.skcId,
        skuId: binding.skuId,
        skcCode: binding.skcCode,
        skuCode: binding.skuCode,
      })),
    })),
  };
}

interface ProductListRow extends ProductManagementRecord {
  rowKey: string;
  spuLink: ProductManagementSpuLink | null;
}

function productListSortValue(
  row: ProductListRow,
  key: ProductManagementColumnKey | null,
): string | number | null {
  if (!key) return null;
  switch (key) {
    case "image": return row.spuLink?.displayImageUrl ?? row.imageUrl ?? null;
    case "productCode": return row.productCode;
    case "y2Inventory": return row.y2Inventory?.totalQuantity ?? null;
    case "serialNumber": return row.serialNumber ?? null;
    case "goodsValue": return row.goodsValue;
    case "totalCost": return row.totalCost;
    case "profitThresholdPrice": return row.profitThresholdPrice;
    case "recommendedPrice": return row.recommendedPrice;
    case "spu": return row.spuLink?.spu ?? null;
    case "firstListedAt": return row.spuLink?.firstListedAt ?? null;
    case "spuNote": return row.spuLink?.note ?? null;
    case "initialReviewPrice": return row.spuLink?.initialReviewPrice ?? null;
    case "reviewPrice": return row.spuLink?.reviewPrice ?? null;
    case "reviewProfitMargin": return row.spuLink?.reviewProfitMargin ?? null;
    case "suggestedActivityDiscount": return row.spuLink?.suggestedActivityDiscount ?? null;
    case "finalActivityDiscount": return row.spuLink?.finalActivityDiscount ?? null;
    case "activityPrice": return row.spuLink?.activityPrice ?? null;
    case "trafficPrice": return row.spuLink?.trafficPrice ?? null;
    case "roas": return row.spuLink?.roas ?? null;
    case "trafficLimitPrice": return row.spuLink?.trafficLimitPrice ?? null;
    case "trafficLimitProfitMargin": return row.spuLink?.trafficLimitProfitMargin ?? null;
    case "trafficLimitSuggestedActivityDiscount": return row.spuLink?.trafficLimitSuggestedActivityDiscount ?? null;
    case "trafficLimitFinalActivityDiscount": return row.spuLink?.trafficLimitFinalActivityDiscount ?? null;
    case "trafficLimitActivityPrice": return row.spuLink?.trafficLimitActivityPrice ?? null;
    case "trafficLimitTrafficPrice": return row.spuLink?.trafficLimitTrafficPrice ?? null;
    case "trafficLimitRoas": return row.spuLink?.trafficLimitRoas ?? null;
    case "orderCount": return row.spuLink?.orderCount ?? null;
    case "purchaseLinks": return row.purchaseLinks.join(" ");
    case "createdBy": return row.createdByUsername;
  }
}

function compareProductListRows(
  left: ProductListRow,
  right: ProductListRow,
  key: ProductManagementColumnKey | null,
): number {
  const a = productListSortValue(left, key);
  const b = productListSortValue(right, key);
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "zh-CN", { numeric: true });
}

function ProductManagementImage({ row }: { row: ProductListRow }) {
  const localUrl = row.spuLink?.localImageUrl ?? null;
  const remoteUrl = row.spuLink?.remoteImageUrl ?? null;
  const [src, setSrc] = useState(localUrl ?? remoteUrl);

  useEffect(() => setSrc(localUrl ?? remoteUrl), [localUrl, remoteUrl]);

  const statusText = {
    ready: "本地图片",
    pending: "原图预览 · 等待下载",
    processing: "原图预览 · 下载中",
    failed: "原图预览 · 本地下载失败",
    remote_only: "原图预览",
    missing: "暂无图片",
  }[row.spuLink?.imageStatus ?? "missing"];

  if (!src) return <Tooltip title={statusText}><div className="image-placeholder large" /></Tooltip>;
  return (
    <Tooltip title={row.spuLink?.imageError ?? statusText}>
      <Image
        src={src}
        width={58}
        height={58}
        preview
        referrerPolicy="no-referrer"
        style={{ objectFit: "cover" }}
        fallback="data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='58' height='58'%3E%3Crect width='100%25' height='100%25' fill='%23f0f0f0'/%3E%3Ctext x='50%25' y='52%25' text-anchor='middle' fill='%23999' font-size='10'%3E无图片%3C/text%3E%3C/svg%3E"
        onError={() => {
          if (src === localUrl && remoteUrl) setSrc(remoteUrl);
        }}
      />
    </Tooltip>
  );
}

export function ProductManagementPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const isAdmin = session?.user.role === "admin";
  const initialScope: Scope = "shop";
  const [scope, setScope] = useState<Scope>(initialScope);
  const [records, setRecords] = useState<ProductManagementRecord[]>([]);
  const [settings, setSettings] = useState<ProductManagementSettings>({
    shippingCostPerKg: 60,
    recommendedProfitMargin: 0.55,
    profitThresholdRate: 0.45,
    updatedAt: null,
  });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 50 | 100 | 200 | null>(null);
  const [total, setTotal] = useState(0);
  const [visibleColumns, setVisibleColumns] = useState<ProductManagementColumnKey[]>(
    [...PRODUCT_MANAGEMENT_COLUMN_KEYS],
  );
  const [columnDraft, setColumnDraft] = useState<ProductManagementColumnKey[]>(
    [...PRODUCT_MANAGEMENT_COLUMN_KEYS],
  );
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
  const [columnSettingsSaving, setColumnSettingsSaving] = useState(false);
  const [searchValues, setSearchValues] = useState<SearchValues>(emptySearch);
  const [appliedSearch, setAppliedSearch] = useState<SearchValues>(emptySearch);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [detailRecord, setDetailRecord] =
    useState<ProductManagementRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [trafficSpu, setTrafficSpu] = useState<string | null>(null);
  const [trafficData, setTrafficData] = useState<ProductDetailResponse | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [editing, setEditing] = useState<ProductManagementRecord | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [productDetailSpu, setProductDetailSpu] = useState<string | null>(null);
  const [productDetailData, setProductDetailData] = useState<ProductManagementBySpuResponse | null>(null);
  const [productDetailLoading, setProductDetailLoading] = useState(false);
  const [trafficLimitRow, setTrafficLimitRow] =
    useState<ProductListRow | null>(null);
  const [trafficLimitSkcs, setTrafficLimitSkcs] = useState<
    ProductManagementTrafficLimitSkc[]
  >([]);
  const [trafficLimitLoading, setTrafficLimitLoading] = useState(false);
  const [imageRefreshTick, setImageRefreshTick] = useState(0);
  const [inventoryBinding, setInventoryBinding] = useState<Y2InventoryRecord | null>(null);
  const [inventoryBindingLoading, setInventoryBindingLoading] = useState(false);
  const [form] = Form.useForm<ProductManagementRecordInput>();
  const [settingsForm] =
    Form.useForm<Omit<ProductManagementSettings, "updatedAt">>();
  const [messageApi, contextHolder] = message.useMessage();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        ...activeSearch(appliedSearch),
        page,
        ...(pageSize ? { pageSize } : {}),
      };
      console.info("[产品管理分页] 请求列表", { scope, ...params });
      const result = await getProductManagementRecords(scope, params);
      console.info("[产品管理分页] 收到列表", {
        requestPage: page,
        requestPageSize: pageSize ?? "使用服务端偏好",
        responsePage: result.page,
        responsePageSize: result.pageSize,
        recordCount: result.records.length,
        total: result.total,
      });
      setRecords(result.records);
      setPage(result.page);
      setPageSize(result.pageSize);
      setTotal(result.total);
      setSettings(result.settings);
      setVisibleColumns(result.columnPreferences.visibleColumns);
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, imageRefreshTick, messageApi, page, pageSize, scope]);

  const copySelectedSpus = async () => {
    const selectedRows = selectedRowKeys.map((key) => ({
      key,
      row: rows.find((row) => row.rowKey === key) ?? null,
    }));
    const spus = [...new Set(selectedRows
      .map(({ row }) => row?.spuLink?.spu ?? null)
      .filter((spu): spu is string => Boolean(spu)))];
    console.info("[产品管理复制 SPU] 选择映射", {
      selectedRowKeys,
      currentRowCount: rows.length,
      selectedRowCount: selectedRows.length,
      unresolvedRowKeys: selectedRows.filter(({ row }) => !row).map(({ key }) => key),
      emptySpuRowKeys: selectedRows
        .filter(({ row }) => row && !row.spuLink?.spu)
        .map(({ key }) => key),
      spus,
    });
    if (!spus.length) {
      messageApi.warning("请先勾选包含 SPU 的产品行。");
      return;
    }

    const text = spus.join("\n");
    const fallbackCopy = () => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.top = "-9999px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } finally {
        document.body.removeChild(textarea);
      }
      console.info("[产品管理复制 SPU] 降级复制结果", { copied, textLength: text.length });
      return copied;
    };

    console.info("[产品管理复制 SPU] 剪贴板能力", {
      selectedRowCount: selectedRowKeys.length,
      spuCount: spus.length,
      textLength: text.length,
      isSecureContext: window.isSecureContext,
      clipboardAvailable: Boolean(navigator.clipboard),
      writeTextAvailable: typeof navigator.clipboard?.writeText === "function",
      userAgent: navigator.userAgent,
    });

    try {
      if (typeof navigator.clipboard?.writeText === "function") {
        await navigator.clipboard.writeText(text);
        console.info("[产品管理复制 SPU] 原生写入成功", { spuCount: spus.length });
      } else if (!fallbackCopy()) {
        throw new Error("浏览器不支持自动复制。");
      }
      messageApi.success(`已复制 ${spus.length} 个 SPU`);
    } catch (error) {
      console.error("[产品管理复制 SPU] 原生写入失败，尝试降级复制", {
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      if (fallbackCopy()) {
        messageApi.success(`已复制 ${spus.length} 个 SPU`);
        return;
      }
      messageApi.error("复制失败，请检查浏览器剪贴板权限后重试。");
    }
  };


  useEffect(() => void reload(), [reload]);

  useEffect(() => {
    const hasActiveImageTasks = records.some((record) =>
      record.spuLinks.some((link) =>
        link.imageStatus === "pending" || link.imageStatus === "processing",
      ),
    );
    if (!hasActiveImageTasks) return;
    const timer = window.setTimeout(
      () => setImageRefreshTick((value) => value + 1),
      5_000,
    );
    return () => window.clearTimeout(timer);
  }, [records]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue(emptyInput);
    setEditorOpen(true);
  };

  const openEdit = (record: ProductManagementRecord) => {
    setEditing(record);
    form.resetFields();
    form.setFieldsValue(toInput(record));
    setEditorOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      if (editing) await updateProductManagementRecord(editing.id, values);
      else await createProductManagementRecord(values);
      messageApi.success(editing ? "产品主档已更新" : "产品主档已创建");
      setEditorOpen(false);
      await reload();
    } catch (error) {
      if (error instanceof Error) messageApi.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async () => {
    try {
      const values = await settingsForm.validateFields();
      if (
        !Number.isFinite(values.shippingCostPerKg) ||
        !Number.isFinite(values.recommendedProfitMargin) ||
        !Number.isFinite(values.profitThresholdRate)
      ) {
        messageApi.error("运费和利率设置必须是有效数字。");
        return;
      }
      setSettings(await saveProductManagementSettings(values));
      setSettingsOpen(false);
      messageApi.success("全局定价参数已保存");
      await reload();
    } catch (error) {
      if (error instanceof Error) messageApi.error(errorMessage(error));
    }
  };

  const openDetail = async (row: ProductListRow) => {
    setDetailLoading(true);
    try {
      setDetailRecord(await getProductManagementRecord(row.id));
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setDetailLoading(false);
    }
  };

  const openTrafficLimitSkcs = async (row: ProductListRow) => {
    const spu = row.spuLink?.spu;
    if (!spu) return;
    setTrafficLimitRow(row);
    setTrafficLimitSkcs([]);
    setTrafficLimitLoading(true);
    try {
      setTrafficLimitSkcs(await getProductManagementTrafficLimitSkcs(row.id, spu));
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setTrafficLimitLoading(false);
    }
  };

  const openTrafficData = async (spu: string) => {
    setTrafficSpu(spu);
    setTrafficData(null);
    setTrafficLoading(true);
    try {
      setTrafficData(await getProductDetail(spu));
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setTrafficLoading(false);
    }
  };

  const openProductManagementDetail = async (spu: string) => {
    setProductDetailSpu(spu);
    setProductDetailData(null);
    setProductDetailLoading(true);
    try {
      setProductDetailData(await getProductManagementBySpu(spu));
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setProductDetailLoading(false);
    }
  };

  const openInventoryBinding = async (row: ProductListRow) => {
    if (!row.y2Inventory) {
      navigate("/y2-inventory");
      return;
    }
    setInventoryBindingLoading(true);
    try {
      setInventoryBinding(await getY2Inventory(row.y2Inventory.inventoryId));
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setInventoryBindingLoading(false);
    }
  };

  const saveColumnSettings = async () => {
    setColumnSettingsSaving(true);
    try {
      const preferences = await saveProductManagementColumnPreferences({
        visibleColumns: columnDraft,
      });
      setVisibleColumns(preferences.visibleColumns);
      setColumnSettingsOpen(false);
      messageApi.success("列表显示设置已保存");
    } catch (error) {
      if (error instanceof Error) messageApi.error(errorMessage(error));
    } finally {
      setColumnSettingsSaving(false);
    }
  };

  const rows = useMemo<ProductListRow[]>(
    () =>
      records.flatMap((record) =>
        (record.spuLinks.length ? record.spuLinks : [null]).map((spuLink) => ({
          ...record,
          rowKey: `${record.id}-${spuLink?.id ?? "empty"}`,
          spuLink,
        })),
      ),
    [records],
  );

  const filteredRows = useMemo(() => rows.filter((row) => {
    const filters: Array<[number | null, number | null, number | null]> = [
      [appliedSearch.reviewProfitMargin.min, appliedSearch.reviewProfitMargin.max, row.spuLink?.reviewProfitMargin ?? null],
      [appliedSearch.suggestedActivityDiscount.min, appliedSearch.suggestedActivityDiscount.max, row.spuLink?.suggestedActivityDiscount ?? null],
      [appliedSearch.roas.min, appliedSearch.roas.max, row.spuLink?.roas ?? null],
      [appliedSearch.trafficLimitProfitMargin.min, appliedSearch.trafficLimitProfitMargin.max, row.spuLink?.trafficLimitProfitMargin ?? null],
    ];
    return filters.every(([min, max, value]) =>
      (min === null || (value !== null && value >= min)) &&
      (max === null || (value !== null && value <= max)),
    );
  }), [appliedSearch, rows]);


  const columns = useMemo(() => {
    const allColumns = [
      {
        title: "图片",
        fixed: "left" as const,
        width: 80,
        render: (_: unknown, row: ProductListRow) => <ProductManagementImage row={row} />,
      },
      {
        title: "SPU",
        dataIndex: ["spuLink", "spu"],
        fixed: "left" as const,
        width: 150,
        render: (value: string | null) => value ?? <Tag color="orange">待补充</Tag>,
      },
      { title: "货号", dataIndex: "productCode", width: 180 },
      {
        title: "Y2库存",
        width: 150,
        render: (_: unknown, row: ProductListRow) => row.y2Inventory ? (
          <Space direction="vertical" size={2}>
            <Tag color={row.y2Inventory.totalQuantity > 0 ? "blue" : "red"}>{row.y2Inventory.totalQuantity} 件</Tag>
            {row.y2Inventory.unmatchedColorCount + row.y2Inventory.conflictColorCount > 0 ? (
              <Tag color="orange">待处理 {row.y2Inventory.unmatchedColorCount + row.y2Inventory.conflictColorCount}</Tag>
            ) : (
              <Text type="secondary">已匹配 {row.y2Inventory.matchedColorCount}</Text>
            )}
          </Space>
        ) : <Tag color="orange">未录入</Tag>,
      },
      {
        title: "序列号",
        dataIndex: "serialNumber",
        width: 90,
        render: (value: string | null) => value ?? "-",
      },
      { title: "货值", dataIndex: "goodsValue", width: 90, render: money },
      { title: "总成本", dataIndex: "totalCost", width: 100, render: money },
      {
        title: "利率门槛值",
        dataIndex: "profitThresholdPrice",
        width: 110,
        render: money,
      },
      {
        title: "推荐售价",
        dataIndex: "recommendedPrice",
        width: 100,
        render: money,
      },
      {
        title: "入站时间",
        dataIndex: ["spuLink", "firstListedAt"],
        width: 120,
        render: (value: string | null) => value ?? <Tag color="orange">待补充</Tag>,
      },
      {
        title: "SPU备注",
        dataIndex: ["spuLink", "note"],
        width: 180,
        ellipsis: true,
        render: (value: string | null) => value ?? "-",
      },
      {
        title: "初次核价最低价",
        width: 120,
        render: (_: unknown, row: ProductListRow) =>
          money(row.spuLink?.initialReviewPrice ?? null),
      },
      {
        title: "核价价",
        width: 100,
        render: (_: unknown, row: ProductListRow) =>
          money(row.spuLink?.reviewPrice ?? null),
      },
      {
        title: "核价利润率",
        width: 110,
        sorter: (a: ProductListRow, b: ProductListRow) =>
          (a.spuLink?.reviewProfitMargin ?? -Infinity) - (b.spuLink?.reviewProfitMargin ?? -Infinity),
        render: (_: unknown, row: ProductListRow) =>
          profitTag(row.spuLink?.reviewProfitMargin ?? null),
      },
      {
        title: "建议折扣",
        width: 100,
        sorter: (a: ProductListRow, b: ProductListRow) =>
          (a.spuLink?.suggestedActivityDiscount ?? -Infinity) - (b.spuLink?.suggestedActivityDiscount ?? -Infinity),
        render: (_: unknown, row: ProductListRow) =>
          percent(row.spuLink?.suggestedActivityDiscount ?? null),
      },
      {
        title: "最终折扣",
        width: 100,
        render: (_: unknown, row: ProductListRow) =>
          percent(row.spuLink?.finalActivityDiscount ?? null),
      },
      {
        title: "活动价",
        width: 100,
        render: (_: unknown, row: ProductListRow) =>
          money(row.spuLink?.activityPrice ?? null),
      },
      {
        title: "流量价",
        width: 100,
        render: (_: unknown, row: ProductListRow) =>
          money(row.spuLink?.trafficPrice ?? null),
      },
      {
        title: "ROAS",
        width: 80,
        sorter: (a: ProductListRow, b: ProductListRow) =>
          (a.spuLink?.roas ?? -Infinity) - (b.spuLink?.roas ?? -Infinity),
        render: (_: unknown, row: ProductListRow) => row.spuLink?.roas ?? "-",
      },
      {
        title: "限流价格",
        width: 100,
        render: (_: unknown, row: ProductListRow) => {
          const value = row.spuLink?.trafficLimitPrice ?? null;
          return value === null ? <Text type="secondary">-</Text> : <Tag color="volcano">{money(value)}</Tag>;
        },
      },
      {
        title: "限流利润率",
        width: 110,
        sorter: (a: ProductListRow, b: ProductListRow) =>
          (a.spuLink?.trafficLimitProfitMargin ?? -Infinity) - (b.spuLink?.trafficLimitProfitMargin ?? -Infinity),
        render: (_: unknown, row: ProductListRow) =>
          profitTag(row.spuLink?.trafficLimitProfitMargin ?? null),
      },
      {
        title: "限流建议折扣",
        width: 120,
        render: (_: unknown, row: ProductListRow) =>
          percent(row.spuLink?.trafficLimitSuggestedActivityDiscount ?? null),
      },
      {
        title: "限流最终折扣",
        width: 120,
        render: (_: unknown, row: ProductListRow) =>
          percent(row.spuLink?.trafficLimitFinalActivityDiscount ?? null),
      },
      {
        title: "限流活动价",
        width: 110,
        render: (_: unknown, row: ProductListRow) =>
          money(row.spuLink?.trafficLimitActivityPrice ?? null),
      },
      {
        title: "限流流量价",
        width: 110,
        render: (_: unknown, row: ProductListRow) =>
          money(row.spuLink?.trafficLimitTrafficPrice ?? null),
      },
      {
        title: "限流 ROAS",
        width: 100,
        render: (_: unknown, row: ProductListRow) =>
          row.spuLink?.trafficLimitRoas ?? "-",
      },
      {
        title: "订单数量",
        width: 110,
        render: (_: unknown, row: ProductListRow) => {
          const value = row.spuLink?.orderCount;
          return value === null || value === undefined
            ? <Tag color="orange">待补充</Tag>
            : <Tag color={value > 0 ? "green" : "default"}>{value}</Tag>;
        },
      },
      {
        title: "进货链接",
        width: 120,
        render: (_: unknown, row: ProductListRow) => (
          <Space direction="vertical" size={0}>
            {row.purchaseLinks.slice(0, 3).map((url, index) => (
              <Link key={`${url}-${index}`} href={url} target="_blank">
                链接 {index + 1}
              </Link>
            ))}
            {row.purchaseLinks.length === 0 && "-"}
          </Space>
        ),
      },
      { title: "创建人", dataIndex: "createdByUsername", width: 100 },
      {
        title: "操作",
        fixed: "right" as const,
        width: 210,
        render: (_: unknown, row: ProductListRow) => (
          <Space wrap>
            <Button
              size="small"
              loading={detailLoading}
              onClick={() => void openDetail(row)}
            >
              详情
            </Button>
            <Button
              size="small"
              disabled={!row.spuLink?.spu}
              loading={trafficLoading && trafficSpu === row.spuLink?.spu}
              onClick={() => row.spuLink?.spu && void openTrafficData(row.spuLink.spu)}
            >
              流量数据
            </Button>
            {row.spuLink?.trafficLimitPrice !== null &&
              row.spuLink?.trafficLimitPrice !== undefined && (
                <Button
                  size="small"
                  danger
                  onClick={() => void openTrafficLimitSkcs(row)}
                >
                  限流 SKC
                </Button>
              )}
            <Button
              size="small"
              onClick={() => row.spuLink?.spu && void openProductManagementDetail(row.spuLink.spu)}
              disabled={!row.spuLink?.spu}
            >
              产品详细
            </Button>
            <Button
              size="small"
              loading={inventoryBindingLoading}
              onClick={() => void openInventoryBinding(row)}
            >
              库存绑定
            </Button>
            {row.canEdit ? (
              <>
                <Button size="small" onClick={() => openEdit(row)}>
                  编辑
                </Button>
                <Popconfirm
                  title="确认删除该产品主档及全部 SPU 绑定？"
                  onConfirm={async () => {
                    await deleteProductManagementRecord(row.id);
                    await reload();
                  }}
                >
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </>
            ) : (
              <Tag>只读</Tag>
            )}
          </Space>
        ),
      },
    ];
    return allColumns
      .map((column, index) => {
        const groupClass = `data-column data-column--${productManagementColumnGroup(columnOrder[index])}`;
        const key = columnOrder[index];
        if (key === null) {
          return {
            ...column,
            className: groupClass,
            onHeaderCell: () => ({ className: groupClass }),
          };
        }
        return {
          ...column,
          key: key as string,
          sorter: (left: ProductListRow, right: ProductListRow) =>
            compareProductListRows(left, right, key as ProductManagementColumnKey),
          className: groupClass,
          onHeaderCell: () => ({ className: groupClass }),
        };
      })
      .filter((_column, index) => {
        const key = columnOrder[index];
        return key === null || (key !== undefined && visibleColumns.includes(key));
      });
  }, [detailLoading, reload, visibleColumns]);

  return (
    <div>
      {contextHolder}
      <div className="page-heading">
        <div>
          <Title level={2}>产品管理</Title>
          <Text type="secondary">
            维护产品成本基础、多个 SPU / SKC / SKU 定价绑定；普通用户可查看已授权店铺的全部产品
          </Text>
        </div>
        <Space>
          {isAdmin && <Segmented
            value={scope}
            onChange={(value) => {
              setPage(1);
              setScope(value as Scope);
            }}
            options={[{ label: "全店数据", value: "shop" }, { label: "我的数据", value: "mine" }]}
          />}
          <Button
            icon={<SettingOutlined />}
            onClick={() => {
              setColumnDraft(visibleColumns);
              setColumnSettingsOpen(true);
            }}
          >
            列表显示设置
          </Button>
          {isAdmin && (
            <Button
              icon={<SettingOutlined />}
              onClick={() => {
                settingsForm.setFieldsValue(settings);
                setSettingsOpen(true);
              }}
            >
              管理员设置
            </Button>
          )}
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增产品
          </Button>
        </Space>
      </div>
      <Card bordered={false} className="section-row">
        <Space wrap>
          <Text>运费/KG：{settings.shippingCostPerKg}</Text>
          <Text>
            推荐售价利润率：{percent(settings.recommendedProfitMargin)}
          </Text>
          <Text>利率门槛率：{percent(settings.profitThresholdRate)}</Text>
          <Text type="secondary">
            全店数据中，他人创建的记录仅管理员可修改。
          </Text>
        </Space>
      </Card>
      <Card bordered={false} className="section-row" title="产品搜索">
        <Space wrap align="end">
          <div>
            <Text type="secondary">SPU 精确搜索</Text>
            <Input
              value={searchValues.spu}
              onChange={(event) =>
                setSearchValues((current) => ({
                  ...current,
                  spu: event.target.value,
                }))
              }
              onPressEnter={() => {
                setPage(1);
                setAppliedSearch(searchValues);
              }}
              placeholder="多个 SPU 使用空格分隔"
              allowClear
              style={{ width: 220, display: "block" }}
            />
          </div>
          <div>
            <Text type="secondary">SKC 精确搜索</Text>
            <Input
              value={searchValues.skc}
              onChange={(event) =>
                setSearchValues((current) => ({
                  ...current,
                  skc: event.target.value,
                }))
              }
              onPressEnter={() => {
                setPage(1);
                setAppliedSearch(searchValues);
              }}
              placeholder="多个 SKC 使用空格分隔"
              allowClear
              style={{ width: 220, display: "block" }}
            />
          </div>
          <div>
            <Text type="secondary">SKU 精确搜索</Text>
            <Input
              value={searchValues.sku}
              onChange={(event) =>
                setSearchValues((current) => ({
                  ...current,
                  sku: event.target.value,
                }))
              }
              onPressEnter={() => {
                setPage(1);
                setAppliedSearch(searchValues);
              }}
              placeholder="多个 SKU 使用空格分隔"
              allowClear
              style={{ width: 220, display: "block" }}
            />
          </div>
          <div>
            <Text type="secondary">货号模糊搜索</Text>
            <Input
              value={searchValues.productCode}
              onChange={(event) =>
                setSearchValues((current) => ({
                  ...current,
                  productCode: event.target.value,
                }))
              }
              onPressEnter={() => {
                setPage(1);
                setAppliedSearch(searchValues);
              }}
              placeholder="多个货号片段使用空格分隔"
              allowClear
              style={{ width: 240, display: "block" }}
            />
          </div>
          <div>
            <Text type="secondary">入站时间</Text>
            <DatePicker.RangePicker
              value={searchValues.firstListedAtRange}
              onChange={(value) => setSearchValues((current) => ({
                ...current,
                firstListedAtRange: value as [Dayjs, Dayjs] | null,
              }))}
              style={{ width: 250, display: "block" }}
            />
          </div>
          {(["reviewProfitMargin", "suggestedActivityDiscount", "roas", "trafficLimitProfitMargin"] as const).map((key) => (
            <Space key={key} size={4}>
              <Text type="secondary">{({ reviewProfitMargin: "核价利润率", suggestedActivityDiscount: "建议折扣", roas: "ROAS", trafficLimitProfitMargin: "限流利润率" })[key]}</Text>
              <InputNumber placeholder="最小" value={searchValues[key].min} onChange={(value) => setSearchValues((current) => ({ ...current, [key]: { ...current[key], min: value } }))} />
              <InputNumber placeholder="最大" value={searchValues[key].max} onChange={(value) => setSearchValues((current) => ({ ...current, [key]: { ...current[key], max: value } }))} />
            </Space>
          ))}
          <Button
            type="primary"
            icon={<SearchOutlined />}
            onClick={() => {
              setPage(1);
              setAppliedSearch(searchValues);
            }}
          >
            查询
          </Button>
          <Button
            onClick={() => {
              setPage(1);
              setSearchValues(emptySearch);
              setAppliedSearch(emptySearch);
            }}
          >
            重置
          </Button>
          <Text type="secondary">
            同字段内任意关键词命中；不同字段同时满足。
          </Text>
        </Space>
      </Card>
      <Card bordered={false}>
        <Space style={{ marginBottom: 12 }}>
          <Button icon={<CopyOutlined />} onClick={() => void copySelectedSpus()} disabled={!selectedRowKeys.length}>
            复制勾选 SPU
          </Button>
          <Text type="secondary">已选 {selectedRowKeys.length} 行</Text>
        </Space>
        <Table<ProductListRow>
          className="business-data-table product-management-table"
          sticky={{ offsetHeader: 64 }}
          loading={loading}
          rowKey="rowKey"
          columns={columns as never}
          dataSource={filteredRows}
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          pagination={{
            current: page,
            pageSize: pageSize ?? 20,
            total,
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100, 200],
            showTotal: (value) => `共 ${value} 个产品主档`,
            onChange: (nextPage, nextPageSize) => {
              const size = nextPageSize as 20 | 50 | 100 | 200;
              console.info("[产品管理分页] 表格分页变更", {
                currentPage: page,
                currentPageSize: pageSize ?? 20,
                nextPage,
                nextPageSize: size,
              });
              if (size !== (pageSize ?? 20)) {
                setPage(1);
                setPageSize(size);
                void saveProductManagementPageSize(size).catch((error) =>
                  messageApi.error(errorMessage(error)),
                );
                return;
              }
              setPage(nextPage);
            },
          }}
          scroll={{ x: 3000 }}
        />
      </Card>

      <ProductLifecycleDetailModal
        record={detailRecord}
        onClose={() => setDetailRecord(null)}
      />
      <ProductTrafficLimitSkcDrawer
        open={Boolean(trafficLimitRow)}
        productCode={trafficLimitRow?.productCode ?? null}
        spu={trafficLimitRow?.spuLink?.spu ?? null}
        loading={trafficLimitLoading}
        items={trafficLimitSkcs}
        onClose={() => setTrafficLimitRow(null)}
      />
      <SpuTrafficDrawer
        open={Boolean(trafficSpu)}
        loading={trafficLoading}
        data={trafficData}
        onClose={() => setTrafficSpu(null)}
      />
      <ProductManagementSpuDrawer
        open={Boolean(productDetailSpu)}
        loading={productDetailLoading}
        data={productDetailData}
        onClose={() => setProductDetailSpu(null)}
      />

      <Drawer
        title={`Y2库存绑定 · ${inventoryBinding?.productCode ?? ""} · ${inventoryBinding?.spu ?? "待绑定SPU"}`}
        open={Boolean(inventoryBinding)}
        onClose={() => setInventoryBinding(null)}
        width={980}
        extra={<Button type="primary" onClick={() => navigate(`/y2-inventory?inventoryId=${inventoryBinding?.id ?? ""}`)}>编辑库存绑定</Button>}
      >
        {inventoryBinding && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Space align="start" wrap>
              {inventoryBinding.imageUrl ? <Image src={inventoryBinding.imageUrl} width={100} height={100} style={{ objectFit: "cover" }} /> : null}
              <Space direction="vertical">
                <Text strong>{inventoryBinding.productCode}</Text>
                <Text>SPU：{inventoryBinding.spu ?? "待后续绑定"}</Text>
                <Text type="secondary">备注：{inventoryBinding.note ?? "-"}</Text>
              </Space>
            </Space>
            <Space wrap>
              <Tag color="blue">总库存 {inventoryBinding.totalQuantity}</Tag>
              <Tag color="success">已匹配颜色 {inventoryBinding.matchedColorCount}</Tag>
              <Tag color={inventoryBinding.unmatchedColorCount ? "warning" : "default"}>未匹配 {inventoryBinding.unmatchedColorCount}</Tag>
              <Tag color={inventoryBinding.conflictColorCount ? "error" : "default"}>冲突 {inventoryBinding.conflictColorCount}</Tag>
            </Space>
            <Table
              rowKey="id"
              pagination={false}
              bordered
              dataSource={inventoryBinding.colors}
              scroll={{ x: Math.max(720, 300 + inventoryBinding.sizes.length * 110) }}
              columns={[
                {
                  title: "颜色 / SKC",
                  fixed: "left",
                  width: 240,
                  render: (_value: unknown, color: Y2InventoryRecord["colors"][number]) => <Space>{color.imageUrl ? <Image src={color.imageUrl} width={42} height={42} /> : null}<Space direction="vertical" size={0}><Text strong>{color.color}</Text><Text type="secondary">{color.skcCode ?? color.matchMessage ?? "未绑定"}</Text></Space></Space>,
                },
                ...inventoryBinding.sizes.map((size) => ({
                  title: size,
                  width: 110,
                  align: "center" as const,
                  render: (_value: unknown, color: Y2InventoryRecord["colors"][number]) => {
                    const cell = color.cells.find((item) => item.size === size);
                    return cell ? <Tooltip title={cell.matchMessage ?? cell.skuCode ?? cell.skuId ?? "已匹配"}><Tag color={cell.matchStatus === "matched" ? "success" : cell.matchStatus === "conflict" ? "error" : "warning"}>{cell.quantity}</Tag></Tooltip> : "-";
                  },
                })),
                { title: "合计", dataIndex: "totalQuantity", fixed: "right", width: 90 },
              ]}
            />
          </Space>
        )}
      </Drawer>

      <Modal
        title={editing ? "编辑产品主档" : "新增产品主档"}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={() => void save()}
        confirmLoading={saving}
        width={1100}
        className="product-editor-modal"
        okText="保存"
      >
        <Form form={form} layout="vertical">
          <Space align="start" wrap>
            <Form.Item
              name="productCode"
              label="货号"
              rules={[{ required: true }, { max: 200 }]}
            >
              <Input
                placeholder="例如 HB30-GY058-grey-S"
                style={{ width: 260 }}
              />
            </Form.Item>
            <Form.Item
              name="weightKg"
              label="重量/KG"
              rules={[{ required: true }]}
            >
              <InputNumber min={0} precision={3} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item
              name="goodsValue"
              label="货值"
              extra="默认按货号自动计算；填写后覆盖自动值"
            >
              <InputNumber min={0} precision={2} placeholder="空=自动计算" />
            </Form.Item>
          </Space>
          <Text type="secondary">
            系统从第一段末尾提取货值，从第一个“-”后的字段提取序列号；颜色和尺码段不参与解析。
          </Text>
          <Divider orientation="left">进货链接</Divider>
          <Form.List name="purchaseLinks">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: "100%" }}>
                {fields.map((field) => (
                  <Space key={field.key} style={{ width: "100%" }}>
                    <Form.Item
                      {...field}
                      rules={[{ type: "url", message: "请输入完整链接" }]}
                      style={{ flex: 1, marginBottom: 0 }}
                    >
                      <Input placeholder="https://..." />
                    </Form.Item>
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => remove(field.name)}
                    />
                  </Space>
                ))}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add("")}
                >
                  添加进货链接
                </Button>
              </Space>
            )}
          </Form.List>
          <Divider orientation="left">SPU 定价与绑定</Divider>
          <Form.List name="spuLinks">
            {(fields, { add, remove }) => (
              <Space
                direction="vertical"
                style={{ width: "100%" }}
                size="middle"
              >
                {fields.map((field) => (
                  <Card
                    key={field.key}
                    size="small"
                    title={`SPU 链接 ${field.name + 1}`}
                    extra={
                      <Button
                        danger
                        type="text"
                        onClick={() => remove(field.name)}
                      >
                        删除
                      </Button>
                    }
                  >
                    <Space align="start" wrap>
                      <Form.Item name={[field.name, "spu"]} label="SPU">
                        <Input style={{ width: 180 }} />
                      </Form.Item>
                      <Form.Item name={[field.name, "note"]} label="SPU备注">
                        <Input style={{ width: 280 }} />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, "initialReviewPrice"]}
                        label="初次核价最低价"
                      >
                        <InputNumber min={0} precision={2} />
                      </Form.Item>
                      <Form.Item label="核价价">
                        <Text type="secondary">
                          从生命周期数据自动读取
                        </Text>
                      </Form.Item>
                      <Form.Item
                        name={[field.name, "activityDiscountOverride"]}
                        label="活动折扣覆盖"
                      >
                        <InputNumber
                          min={0.01}
                          max={1}
                          precision={2}
                          placeholder="空=自动"
                        />
                      </Form.Item>
                      <Form.Item label="ROAS">
                        <Text type="secondary">
                          保存后按核价利润率和最终折扣实时计算
                        </Text>
                      </Form.Item>
                      <Form.Item
                        name={[field.name, "orderCount"]}
                        label="订单数量（预留）"
                      >
                        <InputNumber min={0} precision={0} />
                      </Form.Item>
                    </Space>
                    <Form.List name={[field.name, "bindings"]}>
                      {(bindingFields, bindingActions) => (
                        <Space direction="vertical" style={{ width: "100%" }}>
                          {bindingFields.map((binding) => (
                            <Space key={binding.key} wrap>
                              <Form.Item
                                name={[binding.name, "skcId"]}
                                label="SKC ID"
                              >
                                <Input />
                              </Form.Item>
                              <Form.Item
                                name={[binding.name, "skcCode"]}
                                label="SKC 货号"
                              >
                                <Input />
                              </Form.Item>
                              <Form.Item
                                name={[binding.name, "skuId"]}
                                label="SKU ID"
                              >
                                <Input />
                              </Form.Item>
                              <Form.Item
                                name={[binding.name, "skuCode"]}
                                label="SKU 货号"
                              >
                                <Input />
                              </Form.Item>
                              <Button
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() =>
                                  bindingActions.remove(binding.name)
                                }
                              />
                            </Space>
                          ))}
                          <Button
                            type="dashed"
                            onClick={() =>
                              bindingActions.add({
                                skcId: null,
                                skuId: null,
                                skcCode: null,
                                skuCode: null,
                              })
                            }
                          >
                            添加 SKC / SKU 绑定
                          </Button>
                        </Space>
                      )}
                    </Form.List>
                  </Card>
                ))}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add(emptySpu())}
                >
                  添加 SPU 链接
                </Button>
              </Space>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        title="列表常态显示设置"
        open={columnSettingsOpen}
        onCancel={() => setColumnSettingsOpen(false)}
        onOk={() => void saveColumnSettings()}
        confirmLoading={columnSettingsSaving}
        okText="保存"
        width={760}
        className="column-settings-modal"
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Text type="secondary">
            设置按当前用户保存，并在所有店铺共用。操作列固定显示。
          </Text>
          <Checkbox.Group
            value={columnDraft}
            options={PRODUCT_MANAGEMENT_COLUMN_KEYS.map((key) => ({
              label: columnLabels[key],
              value: key,
            }))}
            onChange={(values) =>
              setColumnDraft(values as ProductManagementColumnKey[])
            }
            style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}
          />
          <Button
            onClick={() =>
              setColumnDraft([...PRODUCT_MANAGEMENT_COLUMN_KEYS])
            }
          >
            恢复全部显示
          </Button>
        </Space>
      </Modal>

      <Modal
        title="管理员设置"
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        onOk={() => void saveSettings()}
        okText="保存"
      >
        <Form form={settingsForm} layout="vertical">
          <Form.Item
            name="shippingCostPerKg"
            label="运费/KG"
            rules={[{ required: true, type: "number" }]}
          >
            <InputNumber min={0} precision={2} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="recommendedProfitMargin"
            label="推荐售价利润率"
            rules={[{ required: true, type: "number" }]}
          >
            <InputNumber
              min={0}
              max={0.99}
              step={0.01}
              precision={2}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="profitThresholdRate"
            label="利率门槛率"
            rules={[{ required: true, type: "number" }]}
          >
            <InputNumber
              min={0}
              max={0.99}
              step={0.01}
              precision={2}
              style={{ width: "100%" }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
