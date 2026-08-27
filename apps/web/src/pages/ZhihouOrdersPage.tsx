import type {
  ZhihouOrderReference,
  ZhihouOrderSummaryResponse,
  ZhihouOrderSummaryRow,
  ZhihouSkuMatchStatus,
} from "@temu-analytics/shared";
import {
  Alert,
  Button,
  Card,
  Col,
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
  const [matchStatus, setMatchStatus] = useState<
    ZhihouSkuMatchStatus | undefined
  >();
  const [loading, setLoading] = useState(false);
  const [orderRow, setOrderRow] = useState<ZhihouOrderSummaryRow | null>(null);
  const [orders, setOrders] = useState<ZhihouOrderReference[]>([]);
  const [orderLoading, setOrderLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await getZhihouOrderSummary({
          search: search.trim() || undefined,
          matchStatus,
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

  const showOrders = async (row: ZhihouOrderSummaryRow) => {
    setOrderRow(row);
    setOrders([]);
    setOrderLoading(true);
    try {
      setOrders((await getZhihouOrderReferences(row.key)).orders);
    } catch (error) {
      messageApi.error(errorMessage(error));
      setOrderRow(null);
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
            仅展示最近一次成功同步的 PENDING 新订单，并按上级 SPU、颜色、尺码汇总采购数量。
          </Text>
        </div>
        <Button loading={loading} onClick={() => void reload()}>
          刷新页面数据
        </Button>
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
          description={`${data.latestSync.pageCount} 页，${data.latestSync.orderCount} 个新订单，${data.latestSync.itemCount} 条商品明细。智猴字段 spu 已按实际 SKU 处理。`}
          style={{ marginBottom: 16 }}
        />
      )}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="需要购买" value={data?.totalRequiredQuantity ?? 0} suffix="件" /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="已匹配汇总" value={data?.matchedRowCount ?? 0} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="未匹配汇总" value={data?.unmatchedRowCount ?? 0} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="冲突汇总" value={data?.conflictRowCount ?? 0} /></Card>
        </Col>
      </Row>
      <Card>
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
            options={Object.entries(matchLabels).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </Space>
        <Table
          rowKey="key"
          loading={loading}
          dataSource={data?.rows ?? []}
          scroll={{ x: 1420 }}
          pagination={{ pageSize: 50, showSizeChanger: true }}
          columns={[
            {
              title: "颜色图片",
              dataIndex: "imageUrl",
              width: 100,
              fixed: "left",
              render: (value: string | null) =>
                value ? (
                  <Image src={value} width={64} height={64} style={{ objectFit: "cover" }} />
                ) : (
                  <Text type="secondary">无图片</Text>
                ),
            },
            {
              title: "上级 SPU",
              dataIndex: "parentSpu",
              width: 180,
              fixed: "left",
              render: (value: string | null) => value ?? <Text type="danger">未匹配</Text>,
            },
            {
              title: "智猴 SKU",
              dataIndex: "zhihouSkus",
              width: 220,
              render: (values: string[]) => (
                <Space wrap>{values.map((value) => <Tag key={value}>{value}</Tag>)}</Space>
              ),
            },
            { title: "颜色", dataIndex: "color", width: 130, render: (value: string | null) => value ?? "-" },
            { title: "尺码", dataIndex: "size", width: 120, render: (value: string | null) => value ?? "-" },
            {
              title: "需要购买",
              dataIndex: "requiredQuantity",
              width: 120,
              sorter: (left, right) => left.requiredQuantity - right.requiredQuantity,
              render: (value: number) => <Text strong>{value} 件</Text>,
            },
            {
              title: "货源链接",
              dataIndex: "purchaseLinks",
              width: 220,
              render: (links: string[]) =>
                links.length ? (
                  <Space direction="vertical" size={2}>
                    {links.map((link, index) => (
                      <Link key={link} href={link} target="_blank" rel="noreferrer">
                        货源链接 {index + 1}
                      </Link>
                    ))}
                  </Space>
                ) : (
                  "-"
                ),
            },
            {
              title: "匹配状态",
              dataIndex: "matchStatus",
              width: 130,
              render: (value: ZhihouSkuMatchStatus) => (
                <Tag color={matchColors[value]}>{matchLabels[value]}</Tag>
              ),
            },
            {
              title: "匹配说明",
              dataIndex: "matchMessage",
              width: 260,
              ellipsis: { showTitle: false },
              render: (value: string | null) => (
                <Text title={value ?? undefined} type={value ? "secondary" : undefined}>
                  {value ?? "-"}
                </Text>
              ),
            },
            {
              title: "关联订单",
              dataIndex: "orderCount",
              width: 130,
              fixed: "right",
              render: (value: number, row: ZhihouOrderSummaryRow) => (
                <Button type="link" onClick={() => void showOrders(row)}>
                  {value} 个订单
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        title={`${orderRow?.parentSpu ?? orderRow?.zhihouSkus.join(", ") ?? ""} · 关联订单`}
        open={Boolean(orderRow)}
        onCancel={() => setOrderRow(null)}
        footer={null}
        width={820}
      >
        <Table
          rowKey="orderNo"
          loading={orderLoading}
          dataSource={orders}
          pagination={false}
          columns={[
            { title: "订单号", dataIndex: "orderNo" },
            { title: "本汇总件数", dataIndex: "quantity", width: 120 },
            { title: "店铺", dataIndex: "storeName", width: 150, render: (value: string | null) => value ?? "-" },
            { title: "国家", dataIndex: "countryCode", width: 90, render: (value: string | null) => value ?? "-" },
            { title: "提交时间", dataIndex: "submittedAt", width: 190, render: dateTime },
          ]}
        />
      </Modal>
    </div>
  );
}
