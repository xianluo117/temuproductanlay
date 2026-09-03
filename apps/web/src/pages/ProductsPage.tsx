import { useEffect, useMemo, useState } from 'react';
import { CopyOutlined } from '@ant-design/icons';
import { Button, Card, Col, DatePicker, Form, Image, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ProductBatchOperationResult, ProductManagementBySpuResponse, ProductSummary } from '@temu-analytics/shared';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { createProductOperationsBatch, errorMessage, getDashboard, getProductManagementBySpu, getProducts } from '../api/client';
import { ProductManagementSpuDrawer } from '../components/product-management/ProductManagementSpuDrawer';

const { Title, Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;
const percent = (value: number | null) => value === null ? '-' : `${(value * 100).toFixed(2)}%`;
const compareNullable = (left: number | null, right: number | null) => left === null ? right === null ? 0 : -1 : right === null ? 1 : left - right;

function rateTag(value: number | null, healthyRate: number) {
  if (value === null) return <Tag>缺失</Tag>;
  return <Tag color={value >= healthyRate ? 'green' : value > 0 ? 'orange' : 'default'}>{percent(value)}</Tag>;
}

type ProductMetricKey = 'impressions' | 'clicks' | 'visitors';
type PaymentMetricKey = 'orders' | 'detailPaidBuyers' | 'detailPaymentConversionRate' | 'clickOrderConversionRate' | 'impressionOrderConversionRate';
interface FilterState { listedRange: [Dayjs, Dayjs] | null; productMetric: ProductMetricKey; productMin: number | null; productMax: number | null; paymentMetric: PaymentMetricKey; paymentMin: number | null; paymentMax: number | null }
interface BatchFormValue { operatedAt: Dayjs; content: string; note?: string }

const defaultFilters: FilterState = { listedRange: null, productMetric: 'impressions', productMin: null, productMax: null, paymentMetric: 'orders', paymentMin: null, paymentMax: null };
const productMetricOptions = [{ value: 'impressions', label: '曝光量' }, { value: 'clicks', label: '点击量' }, { value: 'visitors', label: '商品访客数' }];
const paymentMetricOptions = [{ value: 'orders', label: '支付件数（订单量）' }, { value: 'detailPaidBuyers', label: '支付买家数' }, { value: 'detailPaymentConversionRate', label: '商详支付转化率' }, { value: 'clickOrderConversionRate', label: '点击订单转化率' }, { value: 'impressionOrderConversionRate', label: '曝光订单转化率' }];

function inRange(value: number | null, minimum: number | null, maximum: number | null): boolean {
  if (value === null) return minimum === null && maximum === null;
  return (minimum === null || value >= minimum) && (maximum === null || value <= maximum);
}

export function ProductsPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productDetailSpu, setProductDetailSpu] = useState<string | null>(null);
  const [productDetailData, setProductDetailData] = useState<ProductManagementBySpuResponse | null>(null);
  const [productDetailLoading, setProductDetailLoading] = useState(false);
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState<string>();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const [draftFilters, setDraftFilters] = useState<FilterState>(defaultFilters);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [selectedSpus, setSelectedSpus] = useState<React.Key[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchResult, setBatchResult] = useState<ProductBatchOperationResult | null>(null);
  const [batchForm] = Form.useForm<BatchFormValue>();
  const [messageApi, messageContext] = message.useMessage();

  useEffect(() => { void getDashboard().then((data) => { setDates(data.availableDates); setDate(data.selectedDate ?? undefined); }); }, []);
  useEffect(() => {
    if (!date) return;
    setLoading(true);
    const timer = setTimeout(() => void getProducts({ date, search, sort: 'orders', order: 'desc' }).then(setProducts).finally(() => setLoading(false)), 250);
    return () => clearTimeout(timer);
  }, [date, search]);

  const filteredProducts = useMemo(() => products.filter((item) => {
    if (filters.listedRange) {
      if (!item.firstListedAt) return false;
      const listedDate = item.firstListedAt.slice(0, 10);
      if (listedDate < filters.listedRange[0].format('YYYY-MM-DD') || listedDate > filters.listedRange[1].format('YYYY-MM-DD')) return false;
    }
    if (!inRange(item[filters.productMetric], filters.productMin, filters.productMax)) return false;
    const paymentValue = item[filters.paymentMetric];
    const rateMetric = filters.paymentMetric === 'detailPaymentConversionRate' || filters.paymentMetric === 'clickOrderConversionRate' || filters.paymentMetric === 'impressionOrderConversionRate';
    const paymentMin = rateMetric && filters.paymentMin !== null ? filters.paymentMin / 100 : filters.paymentMin;
    const paymentMax = rateMetric && filters.paymentMax !== null ? filters.paymentMax / 100 : filters.paymentMax;
    return inRange(paymentValue, paymentMin, paymentMax);
  }), [products, filters]);

  const resetFilters = () => { setDraftFilters(defaultFilters); setFilters(defaultFilters); };
  const openBatch = () => { setBatchResult(null); batchForm.setFieldsValue({ operatedAt: dayjs(), content: '', note: '' }); setBatchOpen(true); };
  const saveBatch = async () => {
    setBatchSaving(true);
    try {
      const values = await batchForm.validateFields();
      const result = await createProductOperationsBatch({ spus: selectedSpus.map(String), operatedAt: values.operatedAt.toISOString(), content: values.content, note: values.note?.trim() || null });
      setBatchResult(result);
      setSelectedSpus((current) => current.filter((spu) => !result.succeededSpus.includes(String(spu))));
      if (result.failures.length === 0) { messageApi.success(`已为 ${result.successCount} 个 SPU 添加操作记录`); setBatchOpen(false); }
      else messageApi.warning(`成功 ${result.successCount} 个，失败 ${result.failures.length} 个`);
    } catch (error) {
      if (error instanceof Error) messageApi.error(errorMessage(error));
    } finally { setBatchSaving(false); }
  };

  const openProductDetail = async (spu: string) => {
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

  const copySelectedSpus = async () => {
    const spus = [...new Set(selectedSpus.map(String).map((spu) => spu.trim()).filter(Boolean))];
    if (!spus.length) return;
    const text = spus.join('\n');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!copied) throw new Error('浏览器不支持自动复制。');
      }
      messageApi.success(`已复制 ${spus.length} 个 SPU`);
    } catch (error) {
      messageApi.error(errorMessage(error));
    }
  };

  const columns = useMemo(() => {
    const columnGroups = ['identity', 'identity', 'identity', 'traffic', 'traffic', 'engagement', 'engagement', 'engagement', 'engagement', 'engagement', 'conversion', 'conversion', 'conversion', 'conversion', 'conversion', 'actions'];
    const baseColumns = [
      { key: 'image', title: '图片', fixed: 'left' as const, width: 86, render: (_: unknown, item: ProductSummary) => item.imageUrl ? <Image src={item.imageUrl} width={58} height={58} /> : <div className="image-placeholder large" /> },
      { key: 'spu', title: 'SPU', dataIndex: 'spu', fixed: 'left' as const, width: 170, render: (value: string) => <Link to={`/products/${value}`}>{value}</Link> },
      { key: 'firstListedAt', title: '加入站点', dataIndex: 'firstListedAt', render: (value: string | null) => value ?? <Tag color="orange">待补充</Tag> },
      { key: 'impressions', title: '曝光', dataIndex: 'impressions', sorter: (a: ProductSummary, b: ProductSummary) => a.impressions - b.impressions },
      { key: 'searchImpressions', title: '搜索曝光', dataIndex: 'searchImpressions', sorter: (a: ProductSummary, b: ProductSummary) => a.searchImpressions - b.searchImpressions },
      { key: 'clicks', title: '点击', dataIndex: 'clicks', sorter: (a: ProductSummary, b: ProductSummary) => a.clicks - b.clicks },
      { key: 'clickThroughRate', title: '点击率', dataIndex: 'clickThroughRate', render: (value: number | null) => rateTag(value, 0.05), sorter: (a: ProductSummary, b: ProductSummary) => compareNullable(a.clickThroughRate, b.clickThroughRate) },
      { key: 'visitors', title: '访客', dataIndex: 'visitors' },
      { key: 'cartUsers', title: '加购', dataIndex: 'cartUsers' },
      { key: 'cartRate', title: '加购率', dataIndex: 'cartRate', render: (value: number | null) => rateTag(value, 0.08) },
      { key: 'orders', title: '订单', dataIndex: 'orders', sorter: (a: ProductSummary, b: ProductSummary) => a.orders - b.orders, render: (value: number) => <Tag color={value > 0 ? 'green' : 'default'}>{value}</Tag> },
      { key: 'detailPaidBuyers', title: '支付买家', dataIndex: 'detailPaidBuyers' },
      { key: 'detailPaymentConversionRate', title: '商详支付转化', dataIndex: 'detailPaymentConversionRate', render: (value: number | null) => rateTag(value, 0.1), sorter: (a: ProductSummary, b: ProductSummary) => compareNullable(a.detailPaymentConversionRate, b.detailPaymentConversionRate) },
      { key: 'clickOrderConversionRate', title: '点击订单转化', dataIndex: 'clickOrderConversionRate', render: (value: number | null) => rateTag(value, 0.01), sorter: (a: ProductSummary, b: ProductSummary) => compareNullable(a.clickOrderConversionRate, b.clickOrderConversionRate) },
      { key: 'impressionOrderConversionRate', title: '曝光订单转化', dataIndex: 'impressionOrderConversionRate', render: (value: number | null) => rateTag(value, 0.01), sorter: (a: ProductSummary, b: ProductSummary) => compareNullable(a.impressionOrderConversionRate, b.impressionOrderConversionRate) },
      { key: 'actions', title: '操作', fixed: 'right' as const, width: 120, render: (_: unknown, item: ProductSummary) => <Button size="small" onClick={() => void openProductDetail(item.spu)}>产品详细</Button> },
    ];
    return baseColumns.map((column, index) => {
      const groupClass = `data-column data-column--${columnGroups[index]}`;
      return { ...column, className: groupClass, onHeaderCell: () => ({ className: groupClass }) };
    });
  }, []);
  const paymentIsRate = draftFilters.paymentMetric === 'detailPaymentConversionRate' || draftFilters.paymentMetric === 'clickOrderConversionRate' || draftFilters.paymentMetric === 'impressionOrderConversionRate';

  return <div>{messageContext}
    <div className="page-heading"><div><Title level={2}>SPU 数据</Title><Text type="secondary">通过图片快速确认商品，并查看指定日期的完整指标</Text></div><Space><Input.Search allowClear placeholder="搜索一个或多个 SPU" onChange={(event) => setSearch(event.target.value)} style={{ width: 260 }} /><Select value={date} onChange={setDate} options={dates.map((value) => ({ value, label: value }))} style={{ width: 150 }} /></Space></div>
    <Text type="secondary">多个 SPU 可使用空格、英文逗号或中文逗号分隔；多项搜索按 SPU 精确匹配。</Text>
    <Card bordered={false} title="数据筛选" className="product-filter-card section-row">
      <Row gutter={[24, 18]} align="middle">
        <Col xs={24} xl={8}><Space direction="vertical" size={6} style={{ width: '100%' }}><Text>首次加入站点日期</Text><RangePicker value={draftFilters.listedRange} onChange={(value) => setDraftFilters((current) => ({ ...current, listedRange: value as [Dayjs, Dayjs] | null }))} style={{ width: '100%' }} /></Space></Col>
        <Col xs={24} xl={8}><Space direction="vertical" size={6} style={{ width: '100%' }}><Text>商品情况</Text><Space.Compact block><Select value={draftFilters.productMetric} options={productMetricOptions} onChange={(value) => setDraftFilters((current) => ({ ...current, productMetric: value }))} style={{ width: 150 }} /><InputNumber min={0} value={draftFilters.productMin} onChange={(value) => setDraftFilters((current) => ({ ...current, productMin: value }))} placeholder="最小值" style={{ width: '50%' }} /><Input disabled value="~" className="range-separator" /><InputNumber min={0} value={draftFilters.productMax} onChange={(value) => setDraftFilters((current) => ({ ...current, productMax: value }))} placeholder="最大值" style={{ width: '50%' }} /></Space.Compact></Space></Col>
        <Col xs={24} xl={8}><Space direction="vertical" size={6} style={{ width: '100%' }}><Text>支付情况</Text><Space.Compact block><Select value={draftFilters.paymentMetric} options={paymentMetricOptions} onChange={(value) => setDraftFilters((current) => ({ ...current, paymentMetric: value }))} style={{ width: 180 }} />{paymentIsRate ? <InputNumber<number> min={0} max={100} suffix="%" value={draftFilters.paymentMin} onChange={(value) => setDraftFilters((current) => ({ ...current, paymentMin: value }))} placeholder="最小值" style={{ width: '50%' }} /> : <InputNumber<number> min={0} value={draftFilters.paymentMin} onChange={(value) => setDraftFilters((current) => ({ ...current, paymentMin: value }))} placeholder="最小值" style={{ width: '50%' }} />}<Input disabled value="~" className="range-separator" />{paymentIsRate ? <InputNumber<number> min={0} max={100} suffix="%" value={draftFilters.paymentMax} onChange={(value) => setDraftFilters((current) => ({ ...current, paymentMax: value }))} placeholder="最大值" style={{ width: '50%' }} /> : <InputNumber<number> min={0} value={draftFilters.paymentMax} onChange={(value) => setDraftFilters((current) => ({ ...current, paymentMax: value }))} placeholder="最大值" style={{ width: '50%' }} />}</Space.Compact></Space></Col>
      </Row>
      <Space className="filter-actions"><Button type="primary" onClick={() => setFilters(draftFilters)}>查询</Button><Button onClick={resetFilters}>重置</Button><Text type="secondary">当前显示 {filteredProducts.length} / {products.length} 个 SPU</Text></Space>
    </Card>
    <Card bordered={false} className="section-row"><Space className="batch-operation-bar"><Text>已选择 {selectedSpus.length} 个 SPU</Text><Button icon={<CopyOutlined />} disabled={selectedSpus.length === 0} onClick={() => void copySelectedSpus()}>复制勾选 SPU</Button><Button type="primary" disabled={selectedSpus.length === 0} onClick={openBatch}>批量添加操作记录</Button><Button disabled={selectedSpus.length === 0} onClick={() => setSelectedSpus([])}>清空选择</Button></Space><Table className="business-data-table spu-data-table" sticky={{ offsetHeader: 64 }} loading={loading} rowKey="spu" rowSelection={{ selectedRowKeys: selectedSpus, preserveSelectedRowKeys: true, onChange: setSelectedSpus }} columns={columns} dataSource={filteredProducts} pagination={{ pageSize, showSizeChanger: true, onShowSizeChange: (_page, nextPageSize) => setPageSize(nextPageSize) }} scroll={{ x: 1650 }} /></Card>
    <ProductManagementSpuDrawer open={Boolean(productDetailSpu)} loading={productDetailLoading} data={productDetailData} onClose={() => setProductDetailSpu(null)} />
    <Modal title="批量添加 SPU 操作记录" open={batchOpen} onCancel={() => setBatchOpen(false)} onOk={() => void saveBatch()} confirmLoading={batchSaving} okText="批量保存" width={680}>
      <Text type="secondary">将为当前选择的 {selectedSpus.length} 个 SPU 添加相同记录。</Text>
      <Form form={batchForm} layout="vertical" className="operation-form"><Form.Item name="operatedAt" label="操作时间" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item><Form.Item name="content" label="操作内容" rules={[{ required: true, whitespace: true }, { max: 1000 }]}><Input.TextArea rows={4} /></Form.Item><Form.Item name="note" label="备注" rules={[{ max: 3000 }]}><Input.TextArea rows={3} /></Form.Item></Form>
      {batchResult && batchResult.failures.length > 0 && <Card size="small" title={`失败 ${batchResult.failures.length} 个 SPU`}><Paragraph className="batch-failure-list">{batchResult.failures.map((item) => `${item.spu}：${item.reason}`).join('\n')}</Paragraph></Card>}
    </Modal>
  </div>;
}
