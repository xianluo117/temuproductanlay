import type {
  ZhihouOrderMatrixCell,
  ZhihouOrderMatrixColorRow,
  ZhihouOrderReference,
  ZhihouOrderSummaryResponse,
  ZhihouSkuMatchStatus,
  ZhihouStockPickDashboard as ZhihouStockPickDashboardData,
} from "@temu-analytics/shared";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adjustZhihouStockInventory,
  createZhihouBatchStockPick,
  createZhihouStockPick,
  deleteZhihouStockPick,
  errorMessage,
  getZhihouOrderReferences,
  getZhihouOrderSummary,
  getZhihouStockPicks,
  matchZhihouStockPicks,
  previewZhihouBatchStockPick,
  updateProductManagementPurchaseLinks,
} from "../api/client";
import { OrderSpecificationImage } from "../components/orders/OrderSpecificationImage";
import { StockPickDashboard } from "../components/orders/StockPickDashboard";
import { StockPickModal } from "../components/orders/StockPickModal";
import { normalizeOrderSize, orderSizes } from "../components/orders/order-size-columns";
import { localDateTime } from "../utils/date-time";

const { Title, Text, Link } = Typography;

const matchLabels: Record<ZhihouSkuMatchStatus, string> = {
  matched: "已匹配",
  unmatched: "未匹配",
  conflict: "匹配冲突",
};
const matchColors: Record<ZhihouSkuMatchStatus, string> = {
  matched: "success",
  unmatched: "warning",
  conflict: "error",
};

function dateTime(value: string | null): string {
  return localDateTime(value);
}

export function ZhihouOrdersPage() {
  const [data, setData] = useState<ZhihouOrderSummaryResponse | null>(null);
  const [search, setSearch] = useState("");
  const [matchStatus, setMatchStatus] = useState<ZhihouSkuMatchStatus | undefined>();
  const [storeName, setStoreName] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [selectedCell, setSelectedCell] = useState<ZhihouOrderMatrixCell | null>(null);
  const [orders, setOrders] = useState<ZhihouOrderReference[]>([]);
  const [orderLoading, setOrderLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [activeTab, setActiveTab] = useState("new");
  const [pickCell, setPickCell] = useState<ZhihouOrderMatrixCell | null>(null);
  const [pickDashboard, setPickDashboard] = useState<ZhihouStockPickDashboardData | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [batchPickPreview, setBatchPickPreview] = useState<Awaited<ReturnType<typeof previewZhihouBatchStockPick>> | null>(null);
  const [linkMatrix, setLinkMatrix] = useState<ZhihouOrderSummaryResponse["matrices"][number] | null>(null);
  const [linkText, setLinkText] = useState("");

  const saveLinks = async () => {
    if (!linkMatrix?.productManagementRecordId) return;
    setActionLoading(true);
    try {
      const purchaseLinks = linkText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      const savedLinks = await updateProductManagementPurchaseLinks(
        linkMatrix.productManagementRecordId,
        purchaseLinks,
      );
      setData((current) => current ? {
        ...current,
        matrices: current.matrices.map((matrix) => matrix.key === linkMatrix.key ? {
          ...matrix,
          purchaseLinks: savedLinks,
          colorRows: matrix.colorRows.map((row) => ({
            ...row,
            cells: Object.fromEntries(Object.entries(row.cells).map(([size, cell]) => [size, {
              ...cell,
              purchaseLinks: savedLinks,
            }])),
          })),
        } : matrix),
      } : current);
      messageApi.success("进货链接已更新到产品管理主档。");
      setLinkMatrix(null);
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setActionLoading(false);
    }
  };

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await getZhihouOrderSummary({
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(matchStatus ? { matchStatus } : {}),
          ...(storeName ? { storeName } : {}),
        }),
      );
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [matchStatus, messageApi, search, storeName]);

  const reloadPicks = useCallback(async () => {
    try {
      setPickDashboard(await getZhihouStockPicks());
    } catch (error) {
      messageApi.error(errorMessage(error));
    }
  }, [messageApi]);

  useEffect(() => {
    void reload();
    void reloadPicks();
  }, [reload, reloadPicks]);

  const showCell = async (cell: ZhihouOrderMatrixCell) => {
    setSelectedCell(cell);
    setOrders([]);
    setOrderLoading(true);
    try {
      setOrders((await getZhihouOrderReferences(cell.key, storeName)).orders);
    } catch (error) {
      messageApi.error(errorMessage(error));
      setSelectedCell(null);
    } finally {
      setOrderLoading(false);
    }
  };

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setActionLoading(true);
    try {
      await action();
      messageApi.success(success);
      await Promise.all([reload(), reloadPicks()]);
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setActionLoading(false);
    }
  };

  const visibleCells = useMemo(
    () => (data?.matrices ?? []).flatMap((matrix) => matrix.colorRows.flatMap((row) => Object.values(row.cells))),
    [data],
  );

  const openBatchPickPreview = async () => {
    setActionLoading(true);
    try {
      const preview = await previewZhihouBatchStockPick({ targetKeys: visibleCells.map((cell) => cell.key) });
      setBatchPickPreview(preview);
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setActionLoading(false);
    }
  };

  const confirmBatchPick = async () => {
    if (!batchPickPreview) return;
    await runAction(
      () => createZhihouBatchStockPick({ targetKeys: visibleCells.map((cell) => cell.key) }),
      `一键配货完成，已登记 ${batchPickPreview.expectedQuantity} 件。`,
    );
    setBatchPickPreview(null);
  };

  const newOrdersContent = (
    <>
      {!data?.latestSync && (
        <Alert
          showIcon
          type="info"
          message="尚无新订单数据"
          description="请由管理员在智猴账号页面配置账号、测试登录并执行手动同步。"
          style={{ marginBottom: 16 }}
        />
      )}
      {data?.latestSync && (
        <Alert
          showIcon
          type="success"
          message={`最近同步：${dateTime(data.latestSync.completedAt)}`}
          description={`${data.latestSync.pageCount} 页，${data.latestSync.orderCount} 个新订单，${data.latestSync.itemCount} 条商品明细。`}
          style={{ marginBottom: 16 }}
        />
      )}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="剩余待采购" value={(data?.matrices ?? []).reduce((total, matrix) => total + matrix.remainingPurchaseQuantity, 0)} suffix="件" valueStyle={{ color: "#cf1322" }} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="订单需求" value={data?.totalRequiredQuantity ?? 0} suffix="件" /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="已配货" value={(data?.matrices ?? []).reduce((total, matrix) => total + matrix.pickedQuantity, 0)} suffix="件" /></Card></Col>
      </Row>
      <Card loading={loading}>
        <Space wrap style={{ marginBottom: 16 }}>
          <Button type="primary" loading={actionLoading} disabled={!visibleCells.length} onClick={() => void openBatchPickPreview()}>
            一键配货（仅完全匹配）
          </Button>
          <Input.Search
            allowClear
            placeholder="搜索 SPU、智猴 SKU、颜色、尺码或订单号"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onSearch={() => void reload()}
            style={{ width: 380 }}
          />
          <Select
            allowClear
            placeholder="全部匹配状态"
            value={matchStatus}
            onChange={setMatchStatus}
            style={{ width: 180 }}
            options={Object.entries(matchLabels).map(([value, label]) => ({ value, label }))}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="全部店铺"
            value={storeName}
            onChange={setStoreName}
            style={{ width: 220 }}
            options={(data?.storeNames ?? []).map((name) => ({ value: name, label: name }))}
          />
        </Space>
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          {(data?.matrices ?? []).map((matrix) => (
            <Card
              key={matrix.key}
              size="small"
              title={
                <Space wrap size={[8, 4]}>
                  <Text strong>{matrix.parentSpu ? `上级 SPU ${matrix.parentSpu}` : `未匹配 SKU ${matrix.fallbackSku ?? "-"}`}</Text>
                  <Tag color={matchColors[matrix.matchStatus]}>{matchLabels[matrix.matchStatus]}</Tag>
                  <Text type="secondary">货号</Text>
                  {matrix.productCodes.length
                    ? matrix.productCodes.map((code) => <Tag key={code}>{code}</Tag>)
                    : <Text type="secondary">-</Text>}
                  <Text type="secondary">进货链接</Text>
                  {matrix.purchaseLinks.length
                    ? matrix.purchaseLinks.map((link, index) => (
                      <Link key={link} href={link} target="_blank" rel="noreferrer">
                        链接 {index + 1}
                      </Link>
                    ))
                    : <Text type="secondary">-</Text>}
                  <Button size="small" disabled={!matrix.productManagementRecordId} onClick={() => {
                    setLinkMatrix(matrix);
                    setLinkText(matrix.purchaseLinks.join("\n"));
                  }}>编辑链接</Button>
                </Space>
              }
              extra={<Space><Text strong type="danger">剩余待采购 {matrix.remainingPurchaseQuantity} 件</Text><Text>需求 {matrix.requiredQuantity}</Text><Text type="success">已配货 {matrix.pickedQuantity} 件</Text></Space>}
            >
              <Table<ZhihouOrderMatrixColorRow>
                rowKey="key"
                dataSource={matrix.colorRows}
                pagination={false}
                bordered
                size="middle"
                scroll={{ x: Math.max(980, 260 + orderSizes(matrix.sizes).length * 130) }}
                columns={[
                  {
                    title: "颜色",
                    dataIndex: "color",
                    fixed: "left",
                    width: 180,
                    render: (value: string, row) => (
                      <Space>
                        <OrderSpecificationImage urls={row.imageUrls} />
                        <Text strong>{value}</Text>
                      </Space>
                    ),
                  },
                  ...orderSizes(matrix.sizes).map((size) => ({
                    title: size,
                    key: size,
                    width: 130,
                    align: "center" as const,
                    render: (_: unknown, row: ZhihouOrderMatrixColorRow) => {
                      const cell = Object.entries(row.cells).find(([cellSize]) => normalizeOrderSize(cellSize) === size)?.[1];
                      return cell ? (
                        <Space direction="vertical" size={0}>
                          <Text strong type="danger">剩余待采购 {cell.remainingPurchaseQuantity}</Text>
                          <Button type="link" danger={cell.matchStatus === "conflict"} onClick={() => void showCell(cell)}>
                            订单需求 {cell.requiredQuantity}
                          </Button>
                          <Text type="success">已配货 {cell.pickedQuantity} 件</Text>
                          {cell.pickedQuantity > 0 && <Text>已拿货 {cell.pickedQuantity} 件</Text>}
                          <Button size="small" type="primary" disabled={!cell.inventoryPickOptions.length || cell.pickedQuantity >= cell.requiredQuantity} onClick={() => setPickCell(cell)}>
                            库存配货
                          </Button>
                        </Space>
                      ) : <Text type="secondary">-</Text>;
                    },
                  })),
                  {
                    title: "颜色合计",
                    fixed: "right",
                    width: 150,
                    align: "center",
                    render: (_value: unknown, row) => (
                      <Space direction="vertical" size={0}>
                        {orderSizes(matrix.sizes).map((size) => {
                          const cell = Object.entries(row.cells).find(([cellSize]) => normalizeOrderSize(cellSize) === size)?.[1];
                          return cell ? (
                            <Text key={size} strong={cell.remainingPurchaseQuantity > 0} type={cell.remainingPurchaseQuantity > 0 ? "danger" : "secondary"}>
                              {size}：{cell.remainingPurchaseQuantity}件
                            </Text>
                          ) : null;
                        })}
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
          ))}
          {data?.matrices.length === 0 && <Text type="secondary">没有符合条件的订单规格。</Text>}
        </Space>
      </Card>
      <Modal
        title={`${selectedCell?.parentSpu ?? selectedCell?.zhihouSkus.join(", ") ?? ""} · ${selectedCell?.color ?? ""} · ${selectedCell?.size ?? ""}`}
        open={Boolean(selectedCell)}
        onCancel={() => setSelectedCell(null)}
        footer={null}
        width={900}
      >
        {selectedCell && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="智猴 SKU">
                <Space wrap>{selectedCell.zhihouSkus.map((sku) => <Tag key={sku}>{sku}</Tag>)}</Space>
              </Descriptions.Item>
              <Descriptions.Item label="货号">
                {selectedCell.productCodes.length
                  ? <Space wrap>{selectedCell.productCodes.map((code) => <Tag key={code}>{code}</Tag>)}</Space>
                  : "-"}
              </Descriptions.Item>
              <Descriptions.Item label="剩余待采购"><Text strong type="danger">{selectedCell.remainingPurchaseQuantity} 件</Text></Descriptions.Item>
              <Descriptions.Item label="订单需求"><Text strong>{selectedCell.requiredQuantity} 件</Text></Descriptions.Item>
              <Descriptions.Item label="已配货">{selectedCell.pickedQuantity} 件</Descriptions.Item>
              <Descriptions.Item label="已登记拿货">{selectedCell.pickedQuantity} 件</Descriptions.Item>
              <Descriptions.Item label="匹配状态"><Tag color={matchColors[selectedCell.matchStatus]}>{matchLabels[selectedCell.matchStatus]}</Tag></Descriptions.Item>
              <Descriptions.Item label="关联订单">{selectedCell.orderCount} 个</Descriptions.Item>
              <Descriptions.Item label="进货链接" span={2}>
                {selectedCell.purchaseLinks.length ? (
                  <Space wrap>{selectedCell.purchaseLinks.map((link, index) => <Link key={link} href={link} target="_blank" rel="noreferrer">进货链接 {index + 1}</Link>)}</Space>
                ) : "-"}
              </Descriptions.Item>
              <Descriptions.Item label="订单匹配说明" span={2}>{selectedCell.matchMessage ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="库存匹配说明" span={2}>{selectedCell.inventoryMatchMessage ?? "-"}</Descriptions.Item>
            </Descriptions>
            <Table
              rowKey="orderNo"
              loading={orderLoading}
              dataSource={orders}
              pagination={false}
              columns={[
                { title: "订单号", dataIndex: "orderNo" },
                { title: "本规格件数", dataIndex: "quantity", width: 120 },
                { title: "店铺", dataIndex: "storeName", width: 150, render: (value: string | null) => value ?? "-" },
                { title: "国家", dataIndex: "countryCode", width: 90, render: (value: string | null) => value ?? "-" },
                { title: "提交时间", dataIndex: "submittedAt", width: 190, render: dateTime },
              ]}
            />
          </Space>
        )}
      </Modal>
    </>
  );

  return (
    <div>
      {contextHolder}
      <div className="page-heading">
        <div>
          <Title level={2}>订单管理 · 智猴新订单</Title>
          <Text type="secondary">从Y2库存按产品规格拿货，随后按订单提交时间自动匹配；整单配齐后才能复制订单号。</Text>
        </div>
        <Button loading={loading || actionLoading} onClick={() => void Promise.all([reload(), reloadPicks()])}>刷新页面数据</Button>
      </div>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: "new", label: "新订单", children: newOrdersContent },
          {
            key: "picked",
            label: `已配货${pickDashboard?.totalPickedQuantity ? ` (${pickDashboard.totalPickedQuantity})` : ""}`,
            children: <StockPickDashboard
              data={pickDashboard}
              loading={actionLoading}
              onMatch={() => runAction(matchZhihouStockPicks, "已按下单时间完成匹配。")}
              onAdjust={() => runAction(adjustZhihouStockInventory, "库存修正完成。")}
              onDelete={(id) => runAction(() => deleteZhihouStockPick(id), "配货记录已撤销。")}
            />,
          },
        ]}
      />
      <StockPickModal
        cell={pickCell}
        loading={actionLoading}
        onCancel={() => setPickCell(null)}
        onSubmit={async (input) => {
          await runAction(() => createZhihouStockPick(input), "已登记从Y2库存拿货。可继续在当前页面完成其他产品配货。");
          setPickCell(null);
        }}
      />
      <Modal
        title="一键配货确认"
        open={Boolean(batchPickPreview)}
        onCancel={() => setBatchPickPreview(null)}
        confirmLoading={actionLoading}
        onOk={() => void confirmBatchPick()}
        okText="确认配货"
      >
        {batchPickPreview && (
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="当前筛选规格">{batchPickPreview.targetCount} 个</Descriptions.Item>
            <Descriptions.Item label="预计配货">{batchPickPreview.expectedQuantity} 件</Descriptions.Item>
            <Descriptions.Item label="可配规格">{batchPickPreview.pickableTargetCount} 个</Descriptions.Item>
            <Descriptions.Item label="库存不足">{batchPickPreview.insufficientTargetCount} 个</Descriptions.Item>
            <Descriptions.Item label="无完全匹配库存">{batchPickPreview.unavailableTargetCount} 个</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
      <Modal
        title="编辑进货链接"
        open={Boolean(linkMatrix)}
        onCancel={() => setLinkMatrix(null)}
        confirmLoading={actionLoading}
        onOk={() => void saveLinks()}
      >
        <Input.TextArea rows={8} value={linkText} onChange={(event) => setLinkText(event.target.value)} placeholder="每行一个进货链接" />
      </Modal>
    </div>
  );
}
