import {
  DeleteOutlined,
  PlusOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import type {
  ProductManagementRecord,
  ProductManagementRecordInput,
  ProductManagementSettings,
} from "@temu-analytics/shared";
import {
  Button,
  Card,
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
import { useCallback, useEffect, useState } from "react";
import {
  createProductManagementRecord,
  deleteProductManagementRecord,
  errorMessage,
  getProductManagementRecords,
  saveProductManagementSettings,
  updateProductManagementRecord,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";

const { Title, Text, Link } = Typography;
type Scope = "mine" | "shop";

const emptyInput: ProductManagementRecordInput = {
  productCode: "",
  note: null,
  weightKg: 0,
  purchaseLinks: [],
  spuLinks: [],
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
    note: record.note,
    weightKg: record.weightKg,
    purchaseLinks: record.purchaseLinks,
    spuLinks: record.spuLinks.map((link) => ({
      spu: link.spu,
      initialReviewPrice: link.initialReviewPrice,
      reviewPrice: link.reviewPrice,
      activityDiscountOverride: link.activityDiscountOverride,
      roas: link.roas,
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

export function ProductManagementPage() {
  const { session } = useAuth();
  const [scope, setScope] = useState<Scope>("mine");
  const [records, setRecords] = useState<ProductManagementRecord[]>([]);
  const [settings, setSettings] = useState<ProductManagementSettings>({
    shippingCostPerKg: 0,
    recommendedProfitMargin: 0.55,
    updatedAt: null,
  });
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<ProductManagementRecord | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [form] = Form.useForm<ProductManagementRecordInput>();
  const [settingsForm] =
    Form.useForm<Omit<ProductManagementSettings, "updatedAt">>();
  const [messageApi, contextHolder] = message.useMessage();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getProductManagementRecords(scope);
      setRecords(result.records);
      setSettings(result.settings);
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [messageApi, scope]);

  useEffect(() => void reload(), [reload]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue(emptyInput);
    setEditorOpen(true);
  };

  const openEdit = (record: ProductManagementRecord) => {
    setEditing(record);
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
      setSettings(await saveProductManagementSettings(values));
      setSettingsOpen(false);
      messageApi.success("全局定价参数已保存");
      await reload();
    } catch (error) {
      if (error instanceof Error) messageApi.error(errorMessage(error));
    }
  };

  const columns = [
    {
      title: "图片",
      width: 72,
      render: () => <div className="image-placeholder large" />,
    },
    { title: "货号", dataIndex: "productCode", width: 180 },
    {
      title: "内部 ID",
      dataIndex: "internalProductId",
      width: 100,
      render: (value: string | null) => value ?? "-",
    },
    { title: "货值", dataIndex: "goodsValue", width: 90, render: money },
    { title: "重量/KG", dataIndex: "weightKg", width: 100 },
    { title: "总成本", dataIndex: "totalCost", width: 100, render: money },
    {
      title: "推荐售价",
      dataIndex: "recommendedPrice",
      width: 100,
      render: money,
    },
    {
      title: "进货链接",
      width: 120,
      render: (_: unknown, record: ProductManagementRecord) => (
        <Space direction="vertical" size={0}>
          {record.purchaseLinks.slice(0, 3).map((url, index) => (
            <Link key={`${url}-${index}`} href={url} target="_blank">
              链接 {index + 1}
            </Link>
          ))}
          {record.purchaseLinks.length === 0 && "-"}
        </Space>
      ),
    },
    { title: "创建人", dataIndex: "createdByUsername", width: 100 },
    { title: "备注", dataIndex: "note", ellipsis: true },
    {
      title: "操作",
      fixed: "right" as const,
      width: 140,
      render: (_: unknown, record: ProductManagementRecord) =>
        record.canEdit ? (
          <Space>
            <Button size="small" onClick={() => openEdit(record)}>
              编辑
            </Button>
            <Popconfirm
              title="确认删除该产品主档及全部 SPU 绑定？"
              onConfirm={async () => {
                await deleteProductManagementRecord(record.id);
                await reload();
              }}
            >
              <Button size="small" danger>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ) : (
          <Tag>只读</Tag>
        ),
    },
  ];

  return (
    <div>
      {contextHolder}
      <div className="page-heading">
        <div>
          <Title level={2}>产品管理</Title>
          <Text type="secondary">
            维护产品成本基础、进货链接和多个 SPU / SKC / SKU 定价绑定
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
          <Text type="secondary">
            全店数据中，他人创建的记录仅管理员可修改。
          </Text>
        </Space>
      </Card>
      <Card bordered={false}>
        <Table<ProductManagementRecord>
          loading={loading}
          rowKey="id"
          columns={columns}
          dataSource={records}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 1350 }}
          expandable={{
            expandedRowRender: (record) => (
              <Table
                size="small"
                pagination={false}
                rowKey="id"
                dataSource={record.spuLinks}
                columns={[
                  {
                    title: "SPU",
                    dataIndex: "spu",
                    render: (value: string | null) => value ?? "待补充",
                  },
                  {
                    title: "SKC / SKU",
                    render: (_: unknown, link) =>
                      link.bindings.length ? (
                        <Space direction="vertical" size={0}>
                          {link.bindings.map((binding) => (
                            <Text key={binding.id}>
                              {[
                                binding.skcId,
                                binding.skcCode,
                                binding.skuId,
                                binding.skuCode,
                              ]
                                .filter(Boolean)
                                .join(" / ")}
                            </Text>
                          ))}
                        </Space>
                      ) : (
                        "-"
                      ),
                  },
                  {
                    title: "初次核价最低价",
                    dataIndex: "initialReviewPrice",
                    render: money,
                  },
                  { title: "核价价", dataIndex: "reviewPrice", render: money },
                  {
                    title: "核价利润率",
                    dataIndex: "reviewProfitMargin",
                    render: percent,
                  },
                  {
                    title: "建议折扣",
                    dataIndex: "suggestedActivityDiscount",
                    render: percent,
                  },
                  {
                    title: "最终折扣",
                    dataIndex: "finalActivityDiscount",
                    render: percent,
                  },
                  {
                    title: "活动价",
                    dataIndex: "activityPrice",
                    render: money,
                  },
                  { title: "流量价", dataIndex: "trafficPrice", render: money },
                  {
                    title: "ROAS",
                    dataIndex: "roas",
                    render: (value: number | null) => value ?? "-",
                  },
                  {
                    title: "订单数量",
                    dataIndex: "orderCount",
                    render: (value: number | null) => value ?? "待订单模块补充",
                  },
                ]}
              />
            ),
          }}
        />
      </Card>

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
            <Form.Item name="note" label="备注">
              <Input style={{ width: 360 }} />
            </Form.Item>
          </Space>
          <Text type="secondary">
            系统从第一段末尾提取货值，从第二段提取内部
            ID；颜色和尺码段不参与解析。
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
                      <Form.Item name={[field.name, "roas"]} label="ROAS">
                        <InputNumber min={0} precision={2} />
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
                  onClick={() =>
                    add({
                      spu: null,
                      initialReviewPrice: null,
                      reviewPrice: null,
                      activityDiscountOverride: null,
                      roas: null,
                      orderCount: null,
                      bindings: [],
                    })
                  }
                >
                  添加 SPU 链接
                </Button>
              </Space>
            )}
          </Form.List>
        </Form>
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
            rules={[{ required: true }]}
          >
            <InputNumber min={0} precision={2} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="recommendedProfitMargin"
            label="推荐售价利润率"
            rules={[{ required: true }]}
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
