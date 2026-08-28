import type {
  ZhihouOrderMatrixCell,
  ZhihouOrderMatrixColorRow,
  ZhihouOrderReference,
  ZhihouOrderSummaryResponse,
  ZhihouSkuMatchStatus,
} from "@temu-analytics/shared";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Image,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  errorMessage,
  getZhihouOrderReferences,
  getZhihouOrderSummary,
} from "../api/client";

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
  return value ? new Date(value).toLocaleString() : "-";
}

export function ZhihouOrdersPage() {
  const [data, setData] = useState<ZhihouOrderSummaryResponse | null>(null);
  const [search, setSearch] = useState("");
  const [matchStatus, setMatchStatus] = useState<ZhihouSkuMatchStatus | undefined>();
  const [loading, setLoading] = useState(false);
  const [selectedCell, setSelectedCell] = useState<ZhihouOrderMatrixCell | null>(null);
  const [orders, setOrders] = useState<ZhihouOrderReference[]>([]);
  const [orderLoading, setOrderLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await getZhihouOrderSummary({
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(matchStatus ? { matchStatus } : {}),
        }),
      );
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [matchStatus, messageApi, search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const showCell = async (cell: ZhihouOrderMatrixCell) => {
    setSelectedCell(cell);
    setOrders([]);
    setOrderLoading(true);
    try {
      setOrders((await getZhihouOrderReferences(cell.key)).orders);
    } catch (error) {
      messageApi.error(errorMessage(error));
      setSelectedCell(null);
    } finally {
      setOrderLoading(false);
    }
  };

  return (
    <div>
      {contextHolder}
      <div className="page-heading">
        <div>
          <Title level={2}>订单管理 · 智猴新订单</Title>
          <Text type="secondary">
            每个上级 SPU 按颜色×尺码矩阵展示采购数量。生命周期规格优先，订单规格用于兜底。
          </Text>
        </div>
        <Button loading={loading} onClick={() => void reload()}>刷新页面数据</Button>
      </div>
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
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="需要购买" value={data?.totalRequiredQuantity ?? 0} suffix="件" /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="已匹配规格" value={data?.matchedRowCount ?? 0} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="未匹配规格" value={data?.unmatchedRowCount ?? 0} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="冲突规格" value={data?.conflictRowCount ?? 0} /></Card></Col>
      </Row>
      <Card loading={loading}>
        <Space wrap style={{ marginBottom: 16 }}>
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
        </Space>
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          {(data?.matrices ?? []).map((matrix) => (
            <Card
              key={matrix.key}
              size="small"
              title={
                <Space wrap>
                  <Text strong>{matrix.parentSpu ? `上级 SPU ${matrix.parentSpu}` : `未匹配 SKU ${matrix.fallbackSku ?? "-"}`}</Text>
                  <Tag color={matchColors[matrix.matchStatus]}>{matchLabels[matrix.matchStatus]}</Tag>
                </Space>
              }
              extra={<Text strong>需要购买 {matrix.requiredQuantity} 件</Text>}
            >
              <Table<ZhihouOrderMatrixColorRow>
                rowKey="key"
                dataSource={matrix.colorRows}
                pagination={false}
                bordered
                size="middle"
                scroll={{ x: Math.max(720, 260 + matrix.sizes.length * 130) }}
                columns={[
                  {
                    title: "颜色",
                    dataIndex: "color",
                    fixed: "left",
                    width: 180,
                    render: (value: string, row) => (
                      <Space>
                        {row.imageUrl ? <Image src={row.imageUrl} width={48} height={48} style={{ objectFit: "cover" }} /> : null}
                        <Text strong>{value}</Text>
                      </Space>
                    ),
                  },
                  ...matrix.sizes.map((size) => ({
                    title: size,
                    key: size,
                    width: 130,
                    align: "center" as const,
                    render: (_: unknown, row: ZhihouOrderMatrixColorRow) => {
                      const cell = row.cells[size];
                      return cell ? (
                        <Button
                          type="link"
                          danger={cell.matchStatus === "conflict"}
                          onClick={() => void showCell(cell)}
                        >
                          <Text strong>{cell.requiredQuantity} 件</Text>
                        </Button>
                      ) : <Text type="secondary">-</Text>;
                    },
                  })),
                  {
                    title: "颜色合计",
                    dataIndex: "requiredQuantity",
                    fixed: "right",
                    width: 120,
                    align: "center",
                    render: (value: number) => <Text strong>{value} 件</Text>,
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
              <Descriptions.Item label="需要购买"><Text strong>{selectedCell.requiredQuantity} 件</Text></Descriptions.Item>
              <Descriptions.Item label="匹配状态"><Tag color={matchColors[selectedCell.matchStatus]}>{matchLabels[selectedCell.matchStatus]}</Tag></Descriptions.Item>
              <Descriptions.Item label="关联订单">{selectedCell.orderCount} 个</Descriptions.Item>
              <Descriptions.Item label="货源链接" span={2}>
                {selectedCell.purchaseLinks.length ? (
                  <Space wrap>{selectedCell.purchaseLinks.map((link, index) => <Link key={link} href={link} target="_blank" rel="noreferrer">货源链接 {index + 1}</Link>)}</Space>
                ) : "-"}
              </Descriptions.Item>
              <Descriptions.Item label="匹配说明" span={2}>{selectedCell.matchMessage ?? "-"}</Descriptions.Item>
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
    </div>
  );
}
