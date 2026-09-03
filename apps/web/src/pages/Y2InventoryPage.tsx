import { DeleteOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import type React from "react";
import type {
  Y2InventoryBindingOptions,
  Y2InventoryChangeLog,
  Y2InventoryListItem,
  Y2InventoryRecord,
  Y2InventoryRecordInput,
} from "@temu-analytics/shared";
import {
  Button,
  Card,
  Col,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Upload,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteY2Inventory,
  exportY2Inventory,
  errorMessage,
  getY2Inventory,
  getY2InventoryBindingOptions,
  getY2InventoryList,
  getY2InventoryChangeLogs,
  saveY2Inventory,
  updateY2InventoryQuantity,
  uploadY2InventoryImage,
} from "../api/client";
import { localDateTime } from "../utils/date-time";

const { Title, Text } = Typography;
const defaultSizes = ["S", "M", "L", "XL", "XXL"];
const normalize = (value: string) => value.trim().toUpperCase().replace(/[\s_\-]+/g, "");

const emptyInput = (): Y2InventoryRecordInput => ({
  productCode: "",
  spu: null,
  productCodes: [],
  spus: [],
  imageAssetId: null,
  note: null,
  sizes: [...defaultSizes],
  colors: [{ color: "", cells: defaultSizes.map((size) => ({ size, quantity: 0 })), spuSpecs: [] }],
});

function toInput(record: Y2InventoryRecord): Y2InventoryRecordInput {
  return {
    productCode: record.productCode,
    spu: record.spu,
    productCodes: record.productCodes,
    spus: record.spus,
    imageAssetId: record.imageAssetId,
    note: record.note,
    sizes: record.sizes,
    colors: record.colors.map((color) => ({
      color: color.color,
      skcRowId: color.skcRowId,
      spuSpecs: record.spus.map((spuValue) => ({
        spu: spuValue,
        skcRowId: record.spuSpecs.find((spec) => spec.spu === spuValue && spec.colorRowId === color.id)?.skcRowId ?? null,
        cells: record.sizes.map((size) => {
          const cell = color.cells.find((item) => item.size === size);
          const spec = record.spuSpecs.find((item) => item.spu === spuValue && item.colorRowId === color.id && item.cellId === cell?.id);
          return { size, skuRowId: spec?.skuRowId ?? null };
        }),
      })),
      cells: record.sizes.map((size) => {
        const cell = color.cells.find((item) => item.size === size);
        return { size, quantity: cell?.quantity ?? 0, skuRowId: cell?.skuRowId ?? null };
      }),
    })),
  };
}

function statusTag(item: Y2InventoryListItem) {
  if (item.conflictColorCount) return <Tag color="error">冲突 {item.conflictColorCount}</Tag>;
  if (item.unmatchedColorCount) return <Tag color="warning">未匹配 {item.unmatchedColorCount}</Tag>;
  return <Tag color="success">全部匹配</Tag>;
}

function inventoryImage(item: Y2InventoryListItem) {
  return item.imageUrl
    ? <Image preview={{ src: item.imageUrl }} src={item.imageUrl} width={56} height={56} style={{ objectFit: "cover" }} />
    : <div className="image-placeholder large" />;
}

function inventoryCell(
  item: Y2InventoryListItem["colors"][number],
  size: string,
  renderCell: (cell: Y2InventoryListItem["colors"][number]["cells"][number]) => React.ReactNode,
) {
  const cell = item.cells.find((value) => value.size === size);
  if (!cell) return <Text type="secondary">-</Text>;
  return renderCell(cell);
}

type EditingQuantity = {
  productId: number;
  cellId: number;
  quantity: number | null;
  originalQuantity: number;
};

export function Y2InventoryPage() {
  const [items, setItems] = useState<Y2InventoryListItem[]>([]);
  const [showSpu, setShowSpu] = useState(false);
  const [summary, setSummary] = useState({ totalQuantity: 0, matchedCount: 0, issueCount: 0 });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [bindingOptions, setBindingOptions] = useState<Y2InventoryBindingOptions | null>(null);
  const [logs, setLogs] = useState<Y2InventoryChangeLog[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [form] = Form.useForm<Y2InventoryRecordInput>();
  const [messageApi, contextHolder] = message.useMessage();
  const [exporting, setExporting] = useState(false);
  const [editingQuantity, setEditingQuantity] = useState<EditingQuantity | null>(null);
  const savingQuantityCellIds = useRef(new Set<number>());
  const cancelledQuantityCellId = useRef<number | null>(null);
  const queryInventoryOpened = useRef(false);
  const sizes = Form.useWatch("sizes", form) ?? defaultSizes;
  const spu = Form.useWatch("spu", form);
  const spus = Form.useWatch("spus", form) ?? [];
  const productCode = Form.useWatch("productCode", form);

  const reload = useCallback(async () => {
    console.debug("[Y2Inventory] reload:start", {
      search: search.trim(),
      pathname: window.location.pathname,
      searchParams: window.location.search,
      scrollY: window.scrollY,
      navigationType: performance.getEntriesByType("navigation")[0]?.toJSON?.(),
    });
    setLoading(true);
    try {
      const data = await getY2InventoryList(search.trim() || undefined);
      setItems(data.items);
      setSummary(data);
      console.debug("[Y2Inventory] reload:success", {
        itemCount: data.items.length,
        scrollY: window.scrollY,
      });
    } catch (error) {
      console.error("[Y2Inventory] reload:error", error);
      messageApi.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [messageApi, search]);

  useEffect(() => {
    console.debug("[Y2Inventory] mounted", {
      pathname: window.location.pathname,
      searchParams: window.location.search,
      scrollY: window.scrollY,
      navigationType: performance.getEntriesByType("navigation")[0]?.toJSON?.(),
    });
    return () => console.debug("[Y2Inventory] unmounted", { scrollY: window.scrollY });
  }, []);

  useEffect(() => void reload(), [reload]);

  useEffect(() => {
    if (queryInventoryOpened.current) return;
    const id = Number(new URLSearchParams(window.location.search).get("inventoryId"));
    if (!Number.isInteger(id) || id <= 0) return;
    queryInventoryOpened.current = true;
    void openEdit(id);
  });

  const applyAutomaticSku = (fieldName: number) => {
    const skcRowId = form.getFieldValue(["colors", fieldName, "skcRowId"]);
    const skc = bindingOptions?.skcs.find((item) => item.rowId === skcRowId);
    if (!skc) {
      messageApi.warning("请先选择SKC。");
      return;
    }
    const cells = form.getFieldValue(["colors", fieldName, "cells"]) ?? [];
    form.setFieldValue(["colors", fieldName, "cells"], cells.map((cell: { size: string; quantity: number; skuRowId?: number | null }) => {
      const matches = skc.skus.filter((sku) => normalize(sku.label) === normalize(cell.size));
      return { ...cell, skuRowId: matches.length === 1 ? matches[0]!.rowId : null };
    }));
    messageApi.success("已完成当前颜色行SKU自动识别。");
  };

  const applyAutomaticSpuSpecs = (fieldName: number) => {
    const colors = form.getFieldValue("colors") ?? [];
    const current = colors[fieldName];
    const spus = [...new Set([...(form.getFieldValue("spus") ?? []), form.getFieldValue("spu") ?? ""]
      .map((value: string) => value.trim()).filter(Boolean))];
    if (!spus.length) {
      messageApi.warning("请先添加至少一个SPU并加载规格。");
      return;
    }
    const nextSpecs = spus.map((value) => {
      const option = bindingOptions?.spuOptions?.find((item) => normalize(item.spu) === normalize(value));
      const candidates = option?.skcs ?? (normalize(value) === normalize(bindingOptions?.spu ?? "") ? bindingOptions?.skcs ?? [] : []);
      const matches = candidates.filter((skc) =>
        normalize(skc.label) === normalize(current?.color ?? "") ||
        normalize(skc.label).endsWith(normalize(current?.color ?? "")),
      );
      const skc = matches.length === 1 ? matches[0] : undefined;
      return {
        spu: value,
        colorRowId: 0,
        cellId: 0,
        skcRowId: skc?.rowId ?? null,
        cells: (current?.cells ?? []).map((cell: { size: string }) => ({
          size: cell.size,
          skuRowId: skc?.skus.filter((sku) => normalize(sku.label) === normalize(cell.size)).length === 1
            ? skc.skus.find((sku) => normalize(sku.label) === normalize(cell.size))?.rowId ?? null
            : null,
        })),
      };
    });
    form.setFieldValue(["colors", fieldName, "spuSpecs"], nextSpecs);
    messageApi.success(`已生成 ${spus.length} 个SPU的规格绑定。`);
  };

  const loadBindings = async () => {
    const normalizedSpus = [...new Set([spu ?? "", ...spus].map((value) => value.trim()).filter(Boolean))];
    const normalizedProductCode = productCode?.trim() ?? "";
    const currentInventoryId = editingId ?? undefined;
    if (!normalizedSpus.length && !currentInventoryId) {
      messageApi.warning("请先填写至少一个SPU。");
      return;
    }
    try {
      const options = await getY2InventoryBindingOptions({
        ...(normalizedSpus[0] ? { spu: normalizedSpus[0] } : {}),
        ...(normalizedProductCode ? { productCode: normalizedProductCode } : {}),
        ...(currentInventoryId ? { inventoryProductId: currentInventoryId } : {}),
      });
      setBindingOptions(options);
      if (options.spu && !normalizedSpus.length) form.setFieldValue("spu", options.spu);
      const colors: Y2InventoryRecordInput["colors"] = form.getFieldValue("colors") ?? [];
      const primarySpuOptions = options.spuOptions?.[0]?.skcs ?? options.skcs;
      form.setFieldValue("colors", colors.map((color) => {
        const matches = primarySpuOptions.filter((skc) => normalize(skc.label) === normalize(color.color ?? "") || normalize(skc.label).endsWith(normalize(color.color ?? "")));
        const skc = matches.length === 1 ? matches[0] : undefined;
        return { ...color, skcRowId: skc?.rowId ?? color.skcRowId ?? null };
      }));
      messageApi.success(options.resolvedFromProductCode ? `已根据货号找到SPU ${options.spu}，并自动匹配规格` : "已加载生命周期SKC/SKU规格");
    } catch (error) {
      messageApi.error(errorMessage(error));
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setBindingOptions(null);
    setImageUrl(null);
    form.setFieldsValue(emptyInput());
    setOpen(true);
  };

  const openEdit = async (id: number) => {
    console.debug("[Y2Inventory] openEdit:start", { id, scrollY: window.scrollY });
    try {
      const record = await getY2Inventory(id);
      setEditingId(id);
      form.setFieldsValue(toInput(record));
      setImageUrl(record.imageUrl);
      setBindingOptions(await getY2InventoryBindingOptions({ inventoryProductId: id }));
      setOpen(true);
      console.debug("[Y2Inventory] openEdit:modal-opened", { id, scrollY: window.scrollY });
    } catch (error) {
      console.error("[Y2Inventory] openEdit:error", { id, error });
      messageApi.error(errorMessage(error));
    }
  };

  const syncCells = (nextSizes: string[]) => {
    const current: Y2InventoryRecordInput["colors"] = form.getFieldValue("colors") ?? [];
    form.setFieldValue("colors", current.map((color) => ({
      ...color,
      cells: nextSizes.map((size) => color.cells?.find((cell) => cell.size === size) ?? { size, quantity: 0 }),
    })));
  };

  const uploadImage = async (file: File) => {
    setImageUploading(true);
    try {
      const result = await uploadY2InventoryImage(file);
      form.setFieldValue("imageAssetId", result.assetId);
      setImageUrl(result.imageUrl);
      messageApi.success("库存图片已上传");
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setImageUploading(false);
    }
    return false;
  };

  const save = async () => {
    console.debug("[Y2Inventory] save:start", { editingId, scrollY: window.scrollY });
    setSaving(true);
    try {
      const value = await form.validateFields();
      const normalizedSizes = [...new Set(value.sizes.map((size) => size.trim()).filter(Boolean))];
      const codes = [...new Set([value.productCode ?? "", ...(value.productCodes ?? [])].map((item) => item.trim()).filter(Boolean))];
      const spus = [...new Set([value.spu ?? "", ...(value.spus ?? [])].map((item) => item.trim()).filter(Boolean))];
      if (!codes.length && !spus.length) throw new Error("货号和SPU至少填写一个。");
      await saveY2Inventory({ ...value, productCode: codes[0] ?? null, spu: spus[0] ?? null, productCodes: codes, spus, sizes: normalizedSizes });
      console.debug("[Y2Inventory] save:success-before-reload", { editingId, scrollY: window.scrollY });
      messageApi.success(editingId ? "Y2库存已覆盖更新" : "Y2库存已新增");
      setOpen(false);
      await reload();
      console.debug("[Y2Inventory] save:complete", { editingId, scrollY: window.scrollY });
    } catch (error) {
      if (error instanceof Error) messageApi.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const exportInventory = async () => {
    setExporting(true);
    try {
      const blob = await exportY2Inventory();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `y2-inventory-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      messageApi.success("库存表格已导出");
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  const openLogs = async () => {
    setLogsOpen(true);
    setLogsLoading(true);
    try {
      setLogs(await getY2InventoryChangeLogs());
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setLogsLoading(false);
    }
  };

  const startQuantityEdit = (productId: number, cellId: number, quantity: number) => {
    if (savingQuantityCellIds.current.has(cellId)) return;
    cancelledQuantityCellId.current = null;
    setEditingQuantity({ productId, cellId, quantity, originalQuantity: quantity });
  };

  const cancelQuantityEdit = (cellId?: number) => {
    cancelledQuantityCellId.current = cellId ?? editingQuantity?.cellId ?? null;
    setEditingQuantity(null);
  };

  const commitQuantityEdit = async (edit: EditingQuantity) => {
    if (savingQuantityCellIds.current.has(edit.cellId)) return;
    if (edit.quantity === null || !Number.isInteger(edit.quantity) || edit.quantity < 0) {
      messageApi.error("库存数量必须是非负整数。");
      return;
    }
    if (edit.quantity === edit.originalQuantity) {
      setEditingQuantity(null);
      return;
    }
    savingQuantityCellIds.current.add(edit.cellId);
    try {
      const result = await updateY2InventoryQuantity(edit.cellId, { quantity: edit.quantity });
      const difference = result.quantity - edit.originalQuantity;
      setItems((current) => current.map((item) => {
        if (item.id !== edit.productId) return item;
        return {
          ...item,
          totalQuantity: item.totalQuantity + difference,
          colors: item.colors.map((color) => ({
            ...color,
            totalQuantity: color.cells.some((cell) => cell.id === edit.cellId)
              ? color.totalQuantity + difference
              : color.totalQuantity,
            cells: color.cells.map((cell) => cell.id === edit.cellId
              ? { ...cell, quantity: result.quantity }
              : cell),
          })),
        };
      }));
      setSummary((current) => ({ ...current, totalQuantity: current.totalQuantity + difference }));
      setEditingQuantity(null);
      messageApi.success("库存数量已更新");
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      savingQuantityCellIds.current.delete(edit.cellId);
    }
  };

  const colorForm = (field: { name: number; key: number }, actions: { remove: (name: number) => void }) => (
    <Card key={field.key} size="small" title={`颜色行 ${field.name + 1}`} extra={<Button danger type="text" icon={<DeleteOutlined />} onClick={() => actions.remove(field.name)}>删除</Button>}>
      <Space align="start" wrap>
        <Form.Item name={[field.name, "color"]} label="颜色（可选）"><Input style={{ width: 150 }} placeholder="已绑SKC可不填" /></Form.Item>
        <Form.Item name={[field.name, "skcRowId"]} label="兼容主SKC"><Select allowClear showSearch optionFilterProp="label" style={{ width: 280 }} options={(bindingOptions?.skcs ?? []).map((skc) => ({ value: skc.rowId, label: `${skc.label} · ${skc.code ?? skc.id ?? "-"}` }))} /></Form.Item>
        <Button onClick={() => applyAutomaticSku(field.name)}>自动识别主SKU</Button>
        <Button onClick={() => applyAutomaticSpuSpecs(field.name)}>生成全部SPU绑定</Button>
      </Space>
      <Form.List name={[field.name, "spuSpecs"]}>
        {(specFields, specActions) => <Space direction="vertical" style={{ width: "100%" }}>
          {specFields.map((spec) => <Card key={spec.key} type="inner" size="small" title={<Form.Item name={[spec.name, "spu"]} noStyle><Select showSearch optionFilterProp="label" style={{ width: 220 }} placeholder="选择SPU" options={[...(spus ?? []), ...(bindingOptions?.availableSpus ?? []), spu ?? ""].filter(Boolean).map((value) => ({ value, label: value }))} /></Form.Item>} extra={<Button danger type="text" icon={<DeleteOutlined />} onClick={() => specActions.remove(spec.name)} />}>
            <Form.Item noStyle shouldUpdate={(prev, next) => prev.colors?.[field.name]?.spuSpecs?.[spec.name]?.spu !== next.colors?.[field.name]?.spuSpecs?.[spec.name]?.spu}>
              {() => {
                const selectedSpu = form.getFieldValue(["colors", field.name, "spuSpecs", spec.name, "spu"]);
                const option = bindingOptions?.spuOptions?.find((item) => normalize(item.spu) === normalize(selectedSpu ?? ""));
                const skcs = option?.skcs ?? (normalize(selectedSpu ?? "") === normalize(bindingOptions?.spu ?? "") ? bindingOptions?.skcs ?? [] : []);
                const selectedSkcRowId = form.getFieldValue(["colors", field.name, "spuSpecs", spec.name, "skcRowId"]);
                const selectedSkc = skcs.find((item) => item.rowId === selectedSkcRowId);
                return <><Form.Item name={[spec.name, "skcRowId"]} label="SKC"><Select allowClear showSearch optionFilterProp="label" style={{ width: 360 }} options={skcs.map((skc) => ({ value: skc.rowId, label: `${skc.label} · ${skc.code ?? skc.id ?? "-"}` }))} /></Form.Item>
                  <Form.List name={[spec.name, "cells"]}>
                    {(skuFields) => <Table rowKey="key" pagination={false} size="small" dataSource={skuFields} columns={[
                      { title: "尺码", render: (_value, cell) => <Form.Item name={[cell.name, "size"]} noStyle><Input readOnly /></Form.Item> },
                      { title: "SKU", render: (_value, cell) => <Form.Item name={[cell.name, "skuRowId"]} noStyle><Select allowClear showSearch optionFilterProp="label" style={{ width: 320 }} placeholder="选择SKU" options={(selectedSkc?.skus ?? []).map((sku) => ({ value: sku.rowId, label: `${sku.label} · ${sku.code ?? sku.id ?? "-"}` }))} /></Form.Item> },
                    ]} />}
                  </Form.List></>;
              }}
            </Form.Item>
          </Card>)}
          <Button type="dashed" onClick={() => specActions.add({ spu: spus[0] ?? spu ?? "", skcRowId: null, cells: sizes.map((size: string) => ({ size, skuRowId: null })) })}>添加SPU绑定</Button>
        </Space>}
      </Form.List>
      <Form.List name={[field.name, "cells"]}>{(cellFields) => <Table rowKey="key" pagination={false} bordered dataSource={cellFields} columns={[{ title: "尺码", width: 120, render: (_value, cell) => <Form.Item name={[cell.name, "size"]} noStyle><Input readOnly /></Form.Item> }, { title: "库存数量", width: 160, render: (_value, cell) => <Form.Item name={[cell.name, "quantity"]} rules={[{ required: true }]} style={{ marginBottom: 0 }}><InputNumber min={0} precision={0} /></Form.Item> }]} />}</Form.List>
    </Card>
  );

  return <div>{contextHolder}
    <div className="page-heading y2-page-heading"><div><Title level={2}>Y2库存</Title><Text type="secondary">按款式维护共享颜色×尺码库存；货号和SPU至少填写一个，多个入口共享同一库存池。</Text></div><Space wrap className="page-actions"><Input.Search value={search} onChange={(event) => setSearch(event.target.value)} onSearch={() => void reload()} allowClear placeholder="搜索货号或SPU" style={{ width: 260 }} /><Space size={8}><Text>显示SPU信息</Text><Switch checked={showSpu} onChange={setShowSpu} /></Space><Button onClick={() => void openLogs()}>最近7天变动</Button><Button loading={exporting} onClick={() => void exportInventory()}>导出Excel</Button><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增库存</Button></Space></div>
    <Row gutter={[12, 12]} className="section-row y2-summary-row"><Col xs={12} sm={8}><Card><Statistic title="Y2库存总量" value={summary.totalQuantity} suffix="件" /></Card></Col><Col xs={12} sm={8}><Card><Statistic title="全部匹配产品" value={summary.matchedCount} /></Card></Col><Col xs={24} sm={8}><Card><Statistic title="待处理产品" value={summary.issueCount} /></Card></Col></Row>
    <Card bordered={false} className="section-row inventory-table-card">
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        {items.map((item) => (
          <Card
            key={item.id}
            size="small"
            className="inventory-matrix-card"
            title={
              <Space wrap size={[12, 6]}>
                {inventoryImage(item)}
                <Space direction="vertical" size={0}>
                  <Text strong>{item.productCodes?.length ? item.productCodes.join(" / ") : "未填写货号"}</Text>
                  {showSpu && <Text type="secondary">SPU：{item.spus?.length ? item.spus.join(" / ") : "未填写"}</Text>}
                </Space>
                {statusTag(item)}
              </Space>
            }
            extra={<Space wrap><Text strong className={item.totalQuantity > 0 ? "positive" : "muted"}>总库存 {item.totalQuantity} 件</Text><Button size="small" type="primary" ghost onClick={() => void openEdit(item.id)}>编辑/绑定</Button><Popconfirm title="确认删除该Y2库存？" onConfirm={async () => { await deleteY2Inventory(item.id); await reload(); }}><Button size="small" danger>删除</Button></Popconfirm></Space>}
          >
            <Table<Y2InventoryListItem["colors"][number]>
              className="business-data-table inventory-matrix-table"
              rowKey="id"
              size="middle"
              bordered
              pagination={false}
              dataSource={item.colors}
              scroll={{ x: Math.max(620, 220 + item.sizes.length * 110) }}
              locale={{ emptyText: "暂无颜色记录，请点击编辑/绑定添加" }}
              columns={[
                { title: "颜色", dataIndex: "color", key: "color", fixed: "left", width: 180, render: (value: string) => <Text strong>{value || "未命名颜色"}</Text> },
                ...item.sizes.map((size) => ({
                  title: size,
                  key: size,
                  width: 110,
                  align: "center" as const,
                  render: (_value: unknown, color: Y2InventoryListItem["colors"][number]) => inventoryCell(color, size, (cell) => {
                    const isEditing = editingQuantity?.productId === item.id && editingQuantity.cellId === cell.id;
                    if (isEditing) {
                      return <InputNumber
                        className="inventory-quantity-editor"
                        min={0}
                        precision={0}
                        autoFocus
                        value={editingQuantity.quantity}
                        disabled={savingQuantityCellIds.current.has(cell.id)}
                        onChange={(value) => setEditingQuantity((current) => current?.cellId === cell.id ? { ...current, quantity: value } : current)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void commitQuantityEdit({ ...editingQuantity });
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            cancelQuantityEdit(cell.id);
                          }
                        }}
                        onBlur={() => {
                          if (cancelledQuantityCellId.current === cell.id) {
                            cancelledQuantityCellId.current = null;
                            return;
                          }
                          void commitQuantityEdit({ ...editingQuantity });
                        }}
                      />;
                    }
                    return <Text
                      strong
                      className={cell.quantity > 0 ? "positive inventory-quantity-cell" : "muted inventory-quantity-cell"}
                      onDoubleClick={() => startQuantityEdit(item.id, cell.id, cell.quantity)}
                    >{cell.quantity}</Text>;
                  }),
                })),
                { title: "颜色合计", key: "total", fixed: "right" as const, width: 120, align: "right" as const, render: (_value: unknown, color: Y2InventoryListItem["colors"][number]) => <Text strong>{color.totalQuantity} 件</Text> },
              ]}
            />
            {item.note && <Text type="secondary" className="inventory-matrix-note">备注：{item.note}</Text>}
          </Card>
        ))}
        {!loading && items.length === 0 && <div className="inventory-empty">暂无库存记录</div>}
        {items.length > 0 && <div className="inventory-pagination"><Text type="secondary">共 {items.length} 条库存</Text></div>}
      </Space>
    </Card>
    <Modal title={editingId ? "编辑Y2库存" : "新增Y2库存"} open={open} onCancel={() => setOpen(false)} onOk={() => void save()} confirmLoading={saving} width={1200} okText="覆盖保存"><Form form={form} layout="vertical"><Space align="start" wrap><Form.List name="productCodes">{(fields, actions) => <Space direction="vertical"><Text>关联货号</Text>{fields.map((field) => <Space key={field.key}><Form.Item name={field.name} noStyle><Input placeholder="货号" style={{ width: 220 }} /></Form.Item><Button danger type="text" onClick={() => actions.remove(field.name)}>删除</Button></Space>)}<Button type="dashed" onClick={() => actions.add("")}>添加货号</Button></Space>}</Form.List><Form.List name="spus">{(fields, actions) => <Space direction="vertical"><Text>关联SPU（匹配依据）</Text>{fields.map((field) => <Space key={field.key}><Form.Item name={field.name} noStyle><Input placeholder="SPU" style={{ width: 220 }} /></Form.Item><Button danger type="text" onClick={() => actions.remove(field.name)}>删除</Button></Space>)}<Button type="dashed" onClick={() => actions.add("")}>添加SPU</Button></Space>}</Form.List><Button disabled={!spus.some((value: string) => value?.trim())} onClick={() => void loadBindings()}>加载并自动匹配规格</Button><Text type="secondary">必须填写至少一个SPU；库存匹配只按SPU。</Text><Form.Item name="imageAssetId" hidden><Input /></Form.Item><Space direction="vertical"><Text>库存图片</Text><Space>{imageUrl ? <Image src={imageUrl} width={88} height={88} style={{ objectFit: "cover" }} /> : <div className="image-placeholder large" />}<Upload accept="image/*" maxCount={1} showUploadList={false} beforeUpload={(file) => void uploadImage(file as File)}><Button loading={imageUploading} icon={<UploadOutlined />}>上传/替换图片</Button></Upload>{imageUrl && <Button onClick={() => { setImageUrl(null); form.setFieldValue("imageAssetId", null); }}>移除</Button>}</Space></Space></Space><Form.Item name="note" label="备注（产品级）" rules={[{ max: 5000 }]}><Input.TextArea rows={3} placeholder="可填写库存来源、位置、款式说明等" /></Form.Item><Form.Item name="sizes" label="尺码列" rules={[{ required: true }]}><Select mode="tags" tokenSeparators={[",", "，", " "]} onChange={(value) => syncCells(value)} placeholder="输入尺码后回车" /></Form.Item><Form.List name="colors">{(fields, actions) => <Space direction="vertical" style={{ width: "100%" }} size="middle">{fields.map((field) => <Card key={field.key} size="small" title={`颜色行 ${field.name + 1}`} extra={<Button danger type="text" icon={<DeleteOutlined />} onClick={() => actions.remove(field.name)}>删除</Button>}><Space align="start" wrap><Form.Item name={[field.name, "color"]} label="颜色（可选）" rules={[{ validator: async (_rule, value: string | undefined) => { const skcRowId = form.getFieldValue(["colors", field.name, "skcRowId"]); if (!value?.trim() && !skcRowId) throw new Error("颜色和SKC绑定至少填写一项"); } }]}><Input style={{ width: 150 }} placeholder="已绑SKC可不填" /></Form.Item><Form.Item name={[field.name, "skcRowId"]} label="主SPU的SKC绑定"><Select allowClear showSearch optionFilterProp="label" style={{ width: 280 }} placeholder="与颜色至少填写一项" options={(bindingOptions?.skcs ?? []).map((skc) => ({ value: skc.rowId, label: `${skc.label} · ${skc.code ?? skc.id ?? "-"}` }))} /></Form.Item><Button onClick={() => applyAutomaticSku(field.name)}>自动识别SKU</Button></Space><Form.List name={[field.name, "cells"]}>{(cellFields) => <Table rowKey="key" pagination={false} bordered dataSource={cellFields} columns={[{ title: "尺码", width: 120, render: (_value, cell) => <Form.Item name={[cell.name, "size"]} noStyle><Input readOnly /></Form.Item> }, { title: "库存数量", width: 160, render: (_value, cell) => <Form.Item name={[cell.name, "quantity"]} rules={[{ required: true }]} style={{ marginBottom: 0 }}><InputNumber min={0} precision={0} /></Form.Item> }, { title: "主SPU的SKU绑定", render: (_value, cell) => { const skcRowId = form.getFieldValue(["colors", field.name, "skcRowId"]); const skc = bindingOptions?.skcs.find((item) => item.rowId === skcRowId); return <Form.Item name={[cell.name, "skuRowId"]} style={{ marginBottom: 0 }}><Select allowClear showSearch optionFilterProp="label" style={{ width: 300 }} placeholder="自动匹配或手工选择" options={(skc?.skus ?? []).map((sku) => ({ value: sku.rowId, label: `${sku.label} · ${sku.code ?? sku.id ?? "-"}` }))} /></Form.Item>; } }]} />}</Form.List></Card>)}<Button type="dashed" icon={<PlusOutlined />} onClick={() => actions.add({ color: "", cells: sizes.map((size: string) => ({ size, quantity: 0 })) })}>添加颜色行</Button></Space>}</Form.List></Form></Modal>
    <Modal title="Y2库存最近7天变动" open={logsOpen} onCancel={() => setLogsOpen(false)} footer={null} width={900}><Table<Y2InventoryChangeLog> rowKey="id" loading={logsLoading} dataSource={logs} pagination={{ pageSize: 20 }} columns={[{ title: "时间", dataIndex: "changedAt", render: (value: string) => localDateTime(value) }, { title: "货号", dataIndex: "productCode" }, { title: "操作", dataIndex: "action", render: (value: Y2InventoryChangeLog["action"]) => ({ create: "新增", update: "更新", delete: "删除" })[value] }, { title: "库存变化", render: (_value, log) => `${log.beforeTotalQuantity ?? "-"} → ${log.afterTotalQuantity ?? "-"}` }, { title: "操作人", dataIndex: "changedByUsername" }]} /></Modal>
  </div>;
}
