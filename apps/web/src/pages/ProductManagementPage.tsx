import {
  DeleteOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import {
  PRODUCT_MANAGEMENT_COLUMN_KEYS,
  type ProductManagementColumnKey,
  type ProductManagementRecord,
  type ProductManagementTrafficLimitSkc,
  type ProductManagementRecordInput,
  type ProductManagementSettings,
  type ProductManagementSpuLink,
} from "@temu-analytics/shared";
import {
  Button,
  Card,
  Checkbox,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createProductManagementRecord,
  deleteProductManagementRecord,
  errorMessage,
  getProductManagementRecords,
  getProductManagementTrafficLimitSkcs,
  saveProductManagementColumnPreferences,
  saveProductManagementSettings,
  updateProductManagementRecord,
  type ProductManagementSearchParams,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ProductLifecycleDetailModal } from "../components/product-management/ProductLifecycleDetailModal";
import { ProductTrafficLimitSkcDrawer } from "../components/product-management/ProductTrafficLimitSkcDrawer";

const { Title, Text, Link } = Typography;

type Scope = "mine" | "shop";

interface SearchValues {
  spu: string;
  skc: string;
  sku: string;
  productCode: string;
}

const columnLabels: Record<ProductManagementColumnKey, string> = {
  image: "图片",
  productCode: "货号",
  serialNumber: "序列号",
  goodsValue: "货值",
  totalCost: "总成本",
  profitThresholdPrice: "利率门槛值",
  recommendedPrice: "推荐售价",
  spu: "SPU",
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
  ...PRODUCT_MANAGEMENT_COLUMN_KEYS,
  null,
];

const emptySearch: SearchValues = {
  spu: "",
  skc: "",
  sku: "",
  productCode: "",
};

function activeSearch(values: SearchValues): ProductManagementSearchParams {
  const result: ProductManagementSearchParams = {};
  if (values.spu.trim()) result.spu = values.spu.trim();
  if (values.skc.trim()) result.skc = values.skc.trim();
  if (values.sku.trim()) result.sku = values.sku.trim();
  if (values.productCode.trim()) result.productCode = values.productCode.trim();
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
      reviewPrice: link.reviewPrice,
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

export function ProductManagementPage() {
  const { session } = useAuth();
  const initialScope: Scope = session?.user.role === "admin" ? "shop" : "mine";
  const [scope, setScope] = useState<Scope>(initialScope);
  const [records, setRecords] = useState<ProductManagementRecord[]>([]);
  const [settings, setSettings] = useState<ProductManagementSettings>({
    shippingCostPerKg: 60,
    recommendedProfitMargin: 0.55,
    profitThresholdRate: 0.45,
    updatedAt: null,
  });
  const [loading, setLoading] = useState(false);
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
  const [detailRecord, setDetailRecord] =
    useState<ProductManagementRecord | null>(null);
  const [editing, setEditing] = useState<ProductManagementRecord | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trafficLimitRow, setTrafficLimitRow] =
    useState<ProductListRow | null>(null);
  const [trafficLimitSkcs, setTrafficLimitSkcs] = useState<
    ProductManagementTrafficLimitSkc[]
  >([]);
  const [trafficLimitLoading, setTrafficLimitLoading] = useState(false);
  const [form] = Form.useForm<ProductManagementRecordInput>();
  const [settingsForm] =
    Form.useForm<Omit<ProductManagementSettings, "updatedAt">>();
  const [messageApi, contextHolder] = message.useMessage();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getProductManagementRecords(
        scope,
        activeSearch(appliedSearch),
      );
      setRecords(result.records);
      setSettings(result.settings);
      setVisibleColumns(result.columnPreferences.visibleColumns);
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, messageApi, scope]);

  useEffect(() => void reload(), [reload]);

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

  const columns = useMemo(() => {
    const allColumns = [
      {
        title: "图片",
        width: 72,
        render: () => <div className="image-placeholder large" />,
      },
      { title: "货号", dataIndex: "productCode", width: 180 },
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
        title: "SPU",
        dataIndex: ["spuLink", "spu"],
        width: 150,
        render: (value: string | null) => value ?? "待补充",
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
        render: (_: unknown, row: ProductListRow) =>
          percent(row.spuLink?.reviewProfitMargin ?? null),
      },
      {
        title: "建议折扣",
        width: 100,
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
        render: (_: unknown, row: ProductListRow) => row.spuLink?.roas ?? "-",
      },
      {
        title: "限流价格",
        width: 100,
        render: (_: unknown, row: ProductListRow) =>
          money(row.spuLink?.trafficLimitPrice ?? null),
      },
      {
        title: "限流利润率",
        width: 110,
        render: (_: unknown, row: ProductListRow) =>
          percent(row.spuLink?.trafficLimitProfitMargin ?? null),
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
        render: (_: unknown, row: ProductListRow) =>
          row.spuLink?.orderCount ?? "待订单模块补充",
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
        width: 140,
        render: (_: unknown, row: ProductListRow) => (
          <Space wrap>
            <Button size="small" onClick={() => setDetailRecord(row)}>
              详情
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
    return allColumns.filter((_column, index) => {
      const key = columnOrder[index];
      return key === null || (key !== undefined && visibleColumns.includes(key));
    });
  }, [reload, visibleColumns]);

  return (
    <div>
      {contextHolder}
      <div className="page-heading">
        <div>
          <Title level={2}>产品管理</Title>
          <Text type="secondary">
            维护产品成本基础、多个 SPU / SKC / SKU 定价绑定
          </Text>
        </div>
        <Space>
          <Segmented
            value={scope}
            onChange={(value) => setScope(value as Scope)}
            options={[
              { label: "我的数据", value: "mine" },
              { label: "全店数据", value: "shop" },
            ]}
          />
          <Button
            icon={<SettingOutlined />}
            onClick={() => {
              setColumnDraft(visibleColumns);
              setColumnSettingsOpen(true);
            }}
          >
            列表显示设置
          </Button>
          {session?.user.role === "admin" && (
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
              onPressEnter={() => setAppliedSearch(searchValues)}
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
              onPressEnter={() => setAppliedSearch(searchValues)}
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
              onPressEnter={() => setAppliedSearch(searchValues)}
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
              onPressEnter={() => setAppliedSearch(searchValues)}
              placeholder="多个货号片段使用空格分隔"
              allowClear
              style={{ width: 240, display: "block" }}
            />
          </div>
          <Button
            type="primary"
            icon={<SearchOutlined />}
            onClick={() => setAppliedSearch(searchValues)}
          >
            查询
          </Button>
          <Button
            onClick={() => {
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
        <Table<ProductListRow>
          loading={loading}
          rowKey="rowKey"
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 20, showSizeChanger: true }}
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

      <Modal
        title={editing ? "编辑产品主档" : "新增产品主档"}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={() => void save()}
        confirmLoading={saving}
        width={1100}
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
                      <Form.Item
                        name={[field.name, "reviewPrice"]}
                        label="核价价"
                      >
                        <InputNumber min={0} precision={2} />
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
