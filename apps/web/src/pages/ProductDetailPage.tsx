import { useEffect, useState } from 'react';
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Image,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import ReactECharts from 'echarts-for-react';
import type { ProductDetailResponse, ProductOperationRecord, ProductSummary } from '@temu-analytics/shared';
import dayjs, { type Dayjs } from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import {
  createProductOperation,
  deleteProductOperation,
  errorMessage,
  getProductDetail,
  getProductOperations,
  updateProductOperation,
} from '../api/client';
import { localDateTime } from '../utils/date-time';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;
const percent = (value: number | null) => value === null ? '-' : `${(value * 100).toFixed(2)}%`;
const metricOptions = [
  { value: 'impressions', label: '曝光量' }, { value: 'clicks', label: '点击量' }, { value: 'visitors', label: '访客量' },
  { value: 'cartUsers', label: '加购人数' }, { value: 'orders', label: '订单量' }, { value: 'searchImpressions', label: '搜索曝光' },
];

interface OperationFormValue {
  operatedAt: Dayjs;
  content: string;
  note?: string;
}


export function ProductDetailPage() {
  const { spu = '' } = useParams();
  const navigate = useNavigate();
  const [messageApi, messageContext] = message.useMessage();
  const [form] = Form.useForm<OperationFormValue>();
  const [data, setData] = useState<ProductDetailResponse | null>(null);
  const [operations, setOperations] = useState<ProductOperationRecord[]>([]);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ProductOperationRecord | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [metrics, setMetrics] = useState<string[]>(['impressions', 'clicks', 'orders']);

  const loadOperations = async () => {
    setOperationsLoading(true);
    try {
      setOperations(await getProductOperations(spu));
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally {
      setOperationsLoading(false);
    }
  };

  useEffect(() => {
    void getProductDetail(spu).then(setData).catch((error: unknown) => messageApi.error(errorMessage(error)));
    void loadOperations();
  }, [spu]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ operatedAt: dayjs(), content: '', note: '' });
    setModalOpen(true);
  };

  const openEdit = (record: ProductOperationRecord) => {
    setEditing(record);
    form.setFieldsValue({ operatedAt: dayjs(record.operatedAt), content: record.content, note: record.note ?? '' });
    setModalOpen(true);
  };

  const saveOperation = async () => {
    try {
      const value = await form.validateFields();
      setSaving(true);
      const input = {
        operatedAt: value.operatedAt.toISOString(),
        content: value.content,
        note: value.note?.trim() || null,
      };
      if (editing) await updateProductOperation(spu, editing.id, input);
      else await createProductOperation(spu, input);
      setModalOpen(false);
      messageApi.success(editing ? '操作记录已更新。' : '操作记录已新增。');
      await loadOperations();
    } catch (error) {
      if (error instanceof Error) messageApi.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const removeOperation = async (record: ProductOperationRecord) => {
    try {
      await deleteProductOperation(spu, record.id);
      messageApi.success('操作记录已删除。');
      await loadOperations();
    } catch (error) {
      messageApi.error(errorMessage(error));
    }
  };

  if (!data) return <>{messageContext}<Empty description="未找到商品数据" /></>;
  const latest = data.history.at(-1)!;
  const previous = data.history.at(-2);
  const compare = (value: number, old?: number) => !old ? '-' : `${((value - old) / old * 100).toFixed(1)}%`;
  const option = { tooltip: { trigger: 'axis' }, legend: {}, grid: { left: 55, right: 30, top: 45, bottom: 35 }, xAxis: { type: 'category', data: data.history.map((item) => item.date.slice(5)) }, yAxis: { type: 'value' }, series: metrics.map((metric) => ({ name: metricOptions.find((item) => item.value === metric)?.label, type: metric === 'orders' ? 'bar' : 'line', smooth: true, data: data.history.map((item) => item[metric as keyof ProductSummary] as number) })) };
  const rateOption = { tooltip: { trigger: 'axis', valueFormatter: (value: number) => `${(value * 100).toFixed(2)}%` }, legend: {}, xAxis: { type: 'category', data: data.history.map((item) => item.date.slice(5)) }, yAxis: { type: 'value', axisLabel: { formatter: (value: number) => `${(value * 100).toFixed(0)}%` } }, series: [
    { name: '点击率', type: 'line', data: data.history.map((item) => item.clickThroughRate) }, { name: '加购率', type: 'line', data: data.history.map((item) => item.cartRate) }, { name: '商详支付转化', type: 'line', data: data.history.map((item) => item.detailPaymentConversionRate) }, { name: '点击订单转化', type: 'line', data: data.history.map((item) => item.clickOrderConversionRate) }, { name: '曝光订单转化', type: 'line', data: data.history.map((item) => item.impressionOrderConversionRate) },
  ] };
  const columns = [
    { title: '日期', dataIndex: 'date' }, { title: '曝光', dataIndex: 'impressions' }, { title: '点击', dataIndex: 'clicks' },
    { title: '点击率', dataIndex: 'clickThroughRate', render: percent }, { title: '访客', dataIndex: 'visitors' },
    { title: '加购', dataIndex: 'cartUsers' }, { title: '订单', dataIndex: 'orders' }, { title: '支付买家', dataIndex: 'detailPaidBuyers' },
    { title: '商详支付转化', dataIndex: 'detailPaymentConversionRate', render: percent }, { title: '点击订单转化', dataIndex: 'clickOrderConversionRate', render: percent },
    { title: '曝光订单转化', dataIndex: 'impressionOrderConversionRate', render: percent },
  ];
  const operationColumns: TableColumnsType<ProductOperationRecord> = [
    { title: '操作时间', dataIndex: 'operatedAt', width: 180, render: (value: string) => localDateTime(value) },
    { title: '操作内容', dataIndex: 'content', render: (value: string) => <Paragraph className="operation-content">{value}</Paragraph> },
    { title: '备注', dataIndex: 'note', render: (value: string | null) => value ? <Paragraph className="operation-note">{value}</Paragraph> : <Text type="secondary">-</Text> },
    {
      title: '记录信息', width: 210, render: (_, record) => <Space direction="vertical" size={0}>
        <Text type="secondary">创建：{localDateTime(record.createdAt)}</Text>
        <Text type="secondary">更新：{localDateTime(record.updatedAt)}</Text>
      </Space>,
    },
    {
      title: '操作', width: 130, fixed: 'right', render: (_, record) => <Space>
        <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
        <Popconfirm
          title="删除操作记录"
          description={`确认删除 ${localDateTime(record.operatedAt)} 的记录？`}
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => removeOperation(record)}
        >
          <Button type="text" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>,
    },
  ];

  return <div>{messageContext}<div className="page-heading"><Space><Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/products')} /><div><Title level={2}>SPU {spu}</Title><Text type="secondary">加入站点：{data.firstListedAt ?? '-'}</Text></div></Space></div>
    <Row gutter={[16, 16]}><Col xs={24} lg={7}><Card bordered={false}>{data.imageUrl ? <Image src={data.imageUrl} width="100%" className="product-hero" /> : <div className="product-empty-image">暂无图片</div>}<Descriptions column={1} size="small" className="product-meta"><Descriptions.Item label="图片来源">{data.imageSource === 'embedded' ? 'Excel 内嵌图片' : data.imageSource === 'remote' ? 'URL 本地缓存' : '无'}</Descriptions.Item><Descriptions.Item label="最新数据日">{latest.date}</Descriptions.Item></Descriptions></Card></Col>
      <Col xs={24} lg={17}><Row gutter={[12, 12]}><Col span={8}><Card bordered={false}><Statistic title="曝光量" value={latest.impressions} suffix={<small>{compare(latest.impressions, previous?.impressions)}</small>} /></Card></Col><Col span={8}><Card bordered={false}><Statistic title="点击量" value={latest.clicks} suffix={<small>{compare(latest.clicks, previous?.clicks)}</small>} /></Card></Col><Col span={8}><Card bordered={false}><Statistic title="订单量" value={latest.orders} suffix={<small>{compare(latest.orders, previous?.orders)}</small>} /></Card></Col></Row><Card bordered={false} className="section-row" title="多指标趋势" extra={<Select mode="multiple" value={metrics} onChange={setMetrics} options={metricOptions} style={{ minWidth: 310 }} />}><ReactECharts option={option} style={{ height: 330 }} /></Card></Col></Row>
    <Card bordered={false} className="section-row" title="操作记录" extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增操作记录</Button>}>
      <Table rowKey="id" columns={operationColumns} dataSource={operations} loading={operationsLoading} pagination={{ pageSize: 8 }} scroll={{ x: 1050 }} locale={{ emptyText: '暂无操作记录' }} />
    </Card>
    <Card bordered={false} className="section-row" title="转化率趋势"><ReactECharts option={rateOption} style={{ height: 300 }} /></Card>
    <Card bordered={false} className="section-row" title="逐日明细"><Table rowKey="date" columns={columns} dataSource={[...data.history].reverse()} scroll={{ x: 1000 }} /></Card>
    <Modal title={editing ? '编辑操作记录' : '新增操作记录'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void saveOperation()} confirmLoading={saving} okText="保存" cancelText="取消" destroyOnHidden>
      <Form form={form} layout="vertical" preserve={false} className="operation-form">
        <Form.Item name="operatedAt" label="操作日期时间" rules={[{ required: true, message: '请选择操作日期时间。' }]}>
          <DatePicker showTime format="YYYY-MM-DD HH:mm:ss" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="content" label="操作内容" rules={[{ required: true, whitespace: true, message: '请输入操作内容。' }, { max: 1000, message: '操作内容不能超过 1000 个字符。' }]}>
          <TextArea rows={4} showCount maxLength={1000} placeholder="填写在 Temu 中对该 SPU 进行的操作" />
        </Form.Item>
        <Form.Item name="note" label="备注" rules={[{ max: 3000, message: '备注不能超过 3000 个字符。' }]}>
          <TextArea rows={4} showCount maxLength={3000} placeholder="选填：补充操作原因、预期效果或后续观察事项" />
        </Form.Item>
      </Form>
    </Modal>
  </div>;
}
