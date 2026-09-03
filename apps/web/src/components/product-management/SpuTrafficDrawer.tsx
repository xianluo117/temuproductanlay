import { useMemo } from "react";
import { Card, Descriptions, Drawer, Empty, Image, Space, Statistic, Table, Tag, Typography } from "antd";
import type { ProductDetailResponse } from "@temu-analytics/shared";

const { Text } = Typography;
const number = new Intl.NumberFormat("zh-CN");
const percent = (value: number | null) => value === null ? "-" : `${(value * 100).toFixed(2)}%`;

export interface SpuTrafficDrawerProps {
  open: boolean;
  loading: boolean;
  data: ProductDetailResponse | null;
  onClose: () => void;
}

export function SpuTrafficDrawer({ open, loading, data, onClose }: SpuTrafficDrawerProps) {
  const history = useMemo(() => data ? data.history.slice(-7).reverse() : [], [data]);
  const latest = history[0];
  const columns = [
    { title: "日期", dataIndex: "date", width: 120 },
    { title: "曝光", dataIndex: "impressions", render: (value: number) => number.format(value) },
    { title: "点击", dataIndex: "clicks", render: (value: number) => number.format(value) },
    { title: "点击率", dataIndex: "clickThroughRate", render: percent },
    { title: "访客", dataIndex: "visitors", render: (value: number) => number.format(value) },
    { title: "加购", dataIndex: "cartUsers", render: (value: number) => number.format(value) },
    { title: "订单", dataIndex: "orders", render: (value: number) => <Tag color={value > 0 ? "green" : "default"}>{number.format(value)}</Tag> },
    { title: "支付买家", dataIndex: "detailPaidBuyers", render: (value: number) => number.format(value) },
    { title: "商详支付转化", dataIndex: "detailPaymentConversionRate", render: percent },
    { title: "点击订单转化", dataIndex: "clickOrderConversionRate", render: percent },
    { title: "曝光订单转化", dataIndex: "impressionOrderConversionRate", render: percent },
  ];

  return (
    <Drawer title={data ? `流量数据 · SPU ${data.spu}` : "流量数据"} open={open} onClose={onClose} width={900} loading={loading}>
      {!loading && !data ? <Empty description="暂无SPU流量数据" /> : data && (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Space align="start">
            {data.imageUrl ? <Image src={data.imageUrl} width={88} height={88} style={{ objectFit: "cover" }} /> : <div className="image-placeholder large" />}
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="SPU">{data.spu}</Descriptions.Item>
              <Descriptions.Item label="加入站点">{data.firstListedAt ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="显示范围">最近有数据的 {history.length} 天（最多7天）</Descriptions.Item>
            </Descriptions>
          </Space>
          {latest && <Space wrap>
            <Card size="small"><Statistic title="曝光量" value={latest.impressions} /></Card>
            <Card size="small"><Statistic title="点击量" value={latest.clicks} /></Card>
            <Card size="small"><Statistic title="访客量" value={latest.visitors} /></Card>
            <Card size="small"><Statistic title="订单量" value={latest.orders} /></Card>
          </Space>}
          <Table rowKey="date" size="small" bordered pagination={false} columns={columns} dataSource={history} scroll={{ x: 900 }} locale={{ emptyText: "暂无逐日流量数据" }} />
          <Text type="secondary">数据按日期倒序展示，仅显示该 SPU 最近有数据的最多 7 天。</Text>
        </Space>
      )}
    </Drawer>
  );
}
