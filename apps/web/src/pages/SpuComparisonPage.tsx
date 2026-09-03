import { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Image, Input, Row, Select, Space, Spin, Statistic, Tag, Typography } from 'antd';
import { CrownOutlined, SwapOutlined, TrophyOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { Link } from 'react-router-dom';
import type { ProductSummary, SpuComparisonProduct, SpuComparisonResponse } from '@temu-analytics/shared';
import { errorMessage, getSpuComparison } from '../api/client';

const { Title, Text } = Typography;
const colors = ['#ff6a2a', '#1677ff', '#12b76a', '#7f56d9', '#f79009'];
const number = new Intl.NumberFormat('zh-CN');
const percent = (value: number | null) => value === null ? '-' : `${(value * 100).toFixed(2)}%`;
type ComparableMetric = 'impressions' | 'clicks' | 'clickThroughRate' | 'visitors' | 'cartUsers' | 'orders' | 'detailPaymentConversionRate' | 'clickOrderConversionRate' | 'impressionOrderConversionRate';
type TrendMetric = ComparableMetric;

const metrics: Array<{ key: ComparableMetric; label: string; rate?: boolean }> = [
  { key: 'impressions', label: '曝光量' },
  { key: 'clicks', label: '点击量' },
  { key: 'clickThroughRate', label: '点击率', rate: true },
  { key: 'visitors', label: '访客量' },
  { key: 'cartUsers', label: '购物车用户数' },
  { key: 'orders', label: '订单量' },
  { key: 'detailPaymentConversionRate', label: '商详支付转化率', rate: true },
  { key: 'clickOrderConversionRate', label: '点击订单转化率', rate: true },
  { key: 'impressionOrderConversionRate', label: '曝光订单转化率', rate: true },
];

function metricValue(metric: ProductSummary, key: ComparableMetric): number | null {
  return metric[key];
}

function formatMetric(value: number | null, rate = false): string {
  return rate ? percent(value) : number.format(value ?? 0);
}

function gapFromBest(value: number | null, best: number | null, rate = false): string {
  if (value === null || best === null) return '暂无可比数据';
  if (value === best) return '当前最高';
  if (rate) return `较最高低 ${((best - value) * 100).toFixed(2)} 个百分点`;
  if (best === 0) return '与最高持平';
  return `较最高低 ${(((best - value) / best) * 100).toFixed(1)}%`;
}

function allHistoryDates(products: SpuComparisonProduct[]): string[] {
  return [...new Set(products.flatMap((product) => product.history.map((item) => item.date)))].sort();
}

export function SpuComparisonPage() {
  const [spuInput, setSpuInput] = useState('');
  const [selectedSpus, setSelectedSpus] = useState<string[]>([]);
  const [data, setData] = useState<SpuComparisonResponse | null>(null);
  const [date, setDate] = useState<string>();
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('impressions');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const parseSpus = (value: string): string[] => [...new Set(value.split(/[\s,，]+/).map((spu) => spu.trim()).filter(Boolean))];

  const compare = async (requestedDate?: string) => {
    const spus = parseSpus(spuInput);
    setSelectedSpus(spus);
    if (spus.length < 2 || spus.length > 5) return;
    setLoading(true);
    try {
      const result = await getSpuComparison(spus, requestedDate);
      setData(result);
      setDate(result.selectedDate);
      setError('');
    } catch (reason) {
      setError(errorMessage(reason));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const dates = data?.commonDates ?? [];
  const historyDates = useMemo(() => data ? allHistoryDates(data.products) : [], [data]);
  const selectedMetric = metrics.find((item) => item.key === trendMetric)!;

  const trendOption = data ? {
    color: colors,
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', bottom: 0, data: data.products.map((product) => product.spu) },
    grid: { left: 62, right: 28, top: 36, bottom: 58 },
    xAxis: { type: 'category', boundaryGap: false, data: historyDates.map((item) => item.slice(5)) },
    yAxis: { type: 'value', axisLabel: selectedMetric.rate ? { formatter: (value: number) => `${(value * 100).toFixed(0)}%` } : undefined },
    series: data.products.map((product) => {
      const byDate = new Map(product.history.map((item) => [item.date, item]));
      return {
        name: product.spu,
        type: 'line',
        smooth: true,
        connectNulls: false,
        showSymbol: historyDates.length <= 14,
        lineStyle: { width: 3 },
        data: historyDates.map((historyDate) => byDate.has(historyDate) ? metricValue(byDate.get(historyDate)!, trendMetric) : null),
      };
    }),
  } : {};

  const funnelOption = data ? {
    color: colors,
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', bottom: 0 },
    grid: { left: 62, right: 24, top: 30, bottom: 58 },
    xAxis: { type: 'category', data: ['曝光', '点击', '访客', '加购', '订单'] },
    yAxis: { type: 'value' },
    series: data.products.map((product) => ({
      name: product.spu,
      type: 'bar',
      barMaxWidth: 32,
      data: [product.selected.impressions, product.selected.clicks, product.selected.visitors, product.selected.cartUsers, product.selected.orders],
    })),
  } : {};

  return <div>
    <div className="page-heading"><div><Title level={2}>SPU 对比</Title><Text type="secondary">选择 2-5 个 SPU，对比同日表现与完整历史趋势</Text></div></div>
    <Card bordered={false} className="comparison-control-card">
      <Row gutter={[16, 16]} align="bottom">
        <Col xs={24} xl={15}><Text strong>输入 SPU</Text><Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} allowClear value={spuInput} placeholder="请输入 2-5 个 SPU，使用空格、英文逗号或中文逗号分隔" onChange={(event) => { setSpuInput(event.target.value); setSelectedSpus(parseSpus(event.target.value)); setData(null); setDate(undefined); }} style={{ width: '100%', marginTop: 8 }} /></Col>
        <Col xs={24} sm={12} xl={5}><Text strong>比较日期</Text><Select disabled={!data} value={date} options={dates.map((value) => ({ value, label: value }))} placeholder="默认最新共同日期" onChange={(value) => void compare(value)} style={{ width: '100%', marginTop: 8 }} /></Col>
        <Col xs={24} sm={12} xl={4}><Button type="primary" icon={<SwapOutlined />} block loading={loading} disabled={selectedSpus.length < 2 || selectedSpus.length > 5} onClick={() => void compare()}>开始对比</Button></Col>
      </Row>
      <Text type="secondary" className="comparison-help">支持使用空格、英文逗号或中文逗号分隔多个 SPU；只展示全部 SPU 都有数据的共同日期。</Text>
    </Card>

    {error && <Alert type="error" message={error} showIcon closable onClose={() => setError('')} className="section-row" />}
    {loading && <div className="comparison-loading"><Spin size="large" /></div>}
    {!loading && !data && <Card bordered={false} className="section-row"><Empty description="请输入 2-5 个 SPU 开始对比" /></Card>}
    {!loading && data && <>
      <div className="comparison-section-heading"><div><Title level={4}>产品概览</Title><Text type="secondary">数据日期：{data.selectedDate}</Text></div><Tag color="orange">{data.products.length} 个 SPU</Tag></div>
      <div className="comparison-product-grid">{data.products.map((product, index) => <Card key={product.spu} className="comparison-product-card" styles={{ body: { borderTop: `4px solid ${colors[index]}` } }}>
        <div className="comparison-product-image">{product.imageUrl ? <Image src={product.imageUrl} /> : <div className="product-empty-image">暂无图片</div>}</div>
        <Space direction="vertical" size={4} className="comparison-product-meta"><Space><span className="comparison-color-dot" style={{ background: colors[index] }} /><Link to={`/products/${encodeURIComponent(product.spu)}`}><Text strong>{product.spu}</Text></Link></Space><Text type="secondary">加入站点：{product.firstListedAt ?? '-'}</Text><Text type="secondary">历史数据：{product.history.length} 天</Text></Space>
      </Card>)}</div>

      <div className="comparison-section-heading"><div><Title level={4}>核心指标对比</Title><Text type="secondary">最高值标记为赢家，其他项显示与最高表现的差距</Text></div></div>
      <Row gutter={[16, 16]}>{metrics.map((metric) => {
        const values = data.products.map((product) => metricValue(product.selected, metric.key)).filter((value): value is number => value !== null);
        const best = values.length > 0 ? Math.max(...values) : null;
        return <Col xs={24} lg={12} xxl={8} key={metric.key}><Card bordered={false} title={metric.label} className="comparison-metric-card">
          {data.products.map((product, index) => {
            const value = metricValue(product.selected, metric.key);
            const winner = value !== null && value === best;
            return <div className={`comparison-metric-row ${winner ? 'winner' : ''}`} key={product.spu}>
              <Space><span className="comparison-color-dot" style={{ background: colors[index] }} /><Text ellipsis={{ tooltip: product.spu }} className="comparison-spu-name">{product.spu}</Text>{winner && <Tag color="gold" icon={<CrownOutlined />}>最高</Tag>}</Space>
              <div className="comparison-metric-value"><Statistic value={formatMetric(value, metric.rate)} /><Text type={winner ? 'success' : 'secondary'}>{gapFromBest(value, best, metric.rate)}</Text></div>
            </div>;
          })}
        </Card></Col>;
      })}</Row>

      <Row gutter={[16, 16]} className="section-row"><Col xs={24} xl={10}><Card bordered={false} title={<Space><TrophyOutlined />转化漏斗对比</Space>}><ReactECharts option={funnelOption} style={{ height: 400 }} /></Card></Col><Col xs={24} xl={14}><Card bordered={false} title="历史趋势对比" extra={<Select value={trendMetric} options={metrics.map((item) => ({ value: item.key, label: item.label }))} onChange={setTrendMetric} style={{ width: 190 }} />}><ReactECharts option={trendOption} style={{ height: 400 }} /></Card></Col></Row>
    </>}
  </div>;
}
