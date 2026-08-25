import { useEffect, useState } from 'react';
import { Alert, Card, Col, Empty, Image, Row, Select, Space, Statistic, Table, Typography } from 'antd';
import ReactECharts from 'echarts-for-react';
import type { DashboardResponse, MetricTotals, ProductSummary } from '@temu-analytics/shared';
import { Link } from 'react-router-dom';
import { errorMessage, getDashboard } from '../api/client';

const { Title, Text } = Typography;
const number = new Intl.NumberFormat('zh-CN');
const percent = (value: number | null) => value === null ? '-' : `${(value * 100).toFixed(2)}%`;

function delta(current: number | null, previous: number | null): { text: string; positive: boolean | null } {
  if (current === null || previous === null || previous === 0) return { text: '暂无环比', positive: null };
  const value = (current - previous) / previous;
  return { text: `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`, positive: value >= 0 };
}

function MetricCard({ title, value, previous, rateValue = false }: { title: string; value: number | null; previous: number | null; rateValue?: boolean }) {
  const change = delta(value, previous);
  return <Card className="metric-card" bordered={false}>
    <Statistic title={title} value={rateValue ? percent(value) : number.format(value ?? 0)} />
    <Text className={change.positive === null ? 'muted' : change.positive ? 'positive' : 'negative'}>较上一数据日 {change.text}</Text>
  </Card>;
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [date, setDate] = useState<string>();
  const [error, setError] = useState('');

  useEffect(() => {
    void getDashboard(date).then((result) => {
      setData(result);
      setDate(result.selectedDate ?? undefined);
      setError('');
    }).catch((reason) => setError(errorMessage(reason)));
  }, [date]);

  if (error) return <Alert type="error" message={error} showIcon />;
  if (!data || !data.selectedDate) return <Empty description="尚无数据，请先导入今日 Excel" />;
  const current = data.totals;
  const previous = data.previousTotals ?? ({} as Partial<MetricTotals>);

  const trendOption = {
    tooltip: { trigger: 'axis' }, legend: { data: ['曝光量', '点击量', '订单量'] },
    grid: { left: 56, right: 36, top: 48, bottom: 36 }, xAxis: { type: 'category', data: data.trend.map((item) => item.date.slice(5)) },
    yAxis: [{ type: 'value' }, { type: 'value', splitLine: { show: false } }],
    series: [
      { name: '曝光量', type: 'line', smooth: true, showSymbol: false, areaStyle: { opacity: .08 }, data: data.trend.map((item) => item.impressions) },
      { name: '点击量', type: 'line', smooth: true, showSymbol: false, data: data.trend.map((item) => item.clicks) },
      { name: '订单量', type: 'bar', yAxisIndex: 1, data: data.trend.map((item) => item.orders) },
    ],
  };
  const funnelOption = {
    tooltip: { trigger: 'item', formatter: '{b}: {c}' }, series: [{ type: 'funnel', left: '10%', width: '80%', label: { formatter: '{b}  {c}' },
      data: [{ name: '曝光', value: current.impressions }, { name: '点击', value: current.clicks }, { name: '访客', value: current.visitors }, { name: '加购', value: current.cartUsers }, { name: '下单', value: current.orders }]}],
  };
  const columns = [
    { title: '商品', dataIndex: 'spu', render: (_: string, item: ProductSummary) => <Space>{item.imageUrl ? <Image src={item.imageUrl} width={48} height={48} /> : <div className="image-placeholder" />}<Link to={`/products/${item.spu}`}>{item.spu}</Link></Space> },
    { title: '曝光', dataIndex: 'impressions', sorter: (a: ProductSummary, b: ProductSummary) => a.impressions - b.impressions },
    { title: '点击率', dataIndex: 'clickThroughRate', render: percent },
    { title: '加购', dataIndex: 'cartUsers' }, { title: '订单', dataIndex: 'orders' },
    { title: '曝光订单转化', dataIndex: 'impressionOrderConversionRate', render: percent },
  ];

  return <div>
    <div className="page-heading"><div><Title level={2}>经营总览</Title><Text type="secondary">查看每日流量、转化效率和重点商品表现</Text></div><Select value={date} onChange={setDate} options={data.availableDates.map((value) => ({ value, label: value }))} style={{ width: 160 }} /></div>
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={12} xl={4}><MetricCard title="商品数" value={current.productCount} previous={previous.productCount ?? null} /></Col>
      <Col xs={24} sm={12} xl={4}><MetricCard title="曝光量" value={current.impressions} previous={previous.impressions ?? null} /></Col>
      <Col xs={24} sm={12} xl={4}><MetricCard title="点击量" value={current.clicks} previous={previous.clicks ?? null} /></Col>
      <Col xs={24} sm={12} xl={4}><MetricCard title="加购人数" value={current.cartUsers} previous={previous.cartUsers ?? null} /></Col>
      <Col xs={24} sm={12} xl={4}><MetricCard title="订单量" value={current.orders} previous={previous.orders ?? null} /></Col>
      <Col xs={24} sm={12} xl={4}><MetricCard title="曝光订单转化率" value={current.impressionOrderConversionRate} previous={previous.impressionOrderConversionRate ?? null} rateValue /></Col>
    </Row>
    <Row gutter={[16, 16]} className="section-row"><Col xs={24} xl={16}><Card title="每日趋势" bordered={false}><ReactECharts option={trendOption} style={{ height: 360 }} /></Card></Col><Col xs={24} xl={8}><Card title="转化漏斗" bordered={false}><ReactECharts option={funnelOption} style={{ height: 360 }} /></Card></Col></Row>
    <Card title="订单表现排名" bordered={false} className="section-row"><Table rowKey="spu" columns={columns} dataSource={data.rankings} pagination={{ pageSize: 10 }} scroll={{ x: 760 }} /></Card>
  </div>;
}
