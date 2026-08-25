import { useEffect, useState } from 'react';
import { Button, Card, Form, InputNumber, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { AnomalyItem, AnomalyThresholds } from '@temu-analytics/shared';
import { getAnomalies, getDashboard, getThresholds, saveThresholds } from '../api/client';

const { Title, Text } = Typography;

export function AnomaliesPage() {
  const [items, setItems] = useState<AnomalyItem[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState<string>();
  const [form] = Form.useForm<AnomalyThresholds>();
  useEffect(() => { void Promise.all([getDashboard(), getThresholds()]).then(([dashboard, thresholds]) => { setDates(dashboard.availableDates); setDate(dashboard.selectedDate ?? undefined); form.setFieldsValue(thresholds); }); }, [form]);
  useEffect(() => { if (date) void getAnomalies(date).then(setItems); }, [date]);
  const save = async (values: AnomalyThresholds) => { await saveThresholds(values); message.success('异常阈值已保存'); if (date) setItems(await getAnomalies(date)); };
  const columns = [
    { title: '级别', dataIndex: 'severity', render: (value: string) => <Tag color={value === 'critical' ? 'red' : value === 'warning' ? 'orange' : 'blue'}>{value === 'critical' ? '严重' : value === 'warning' ? '警告' : '关注'}</Tag> },
    { title: 'SPU', dataIndex: 'spu' }, { title: '日期', dataIndex: 'date' }, { title: '异常', dataIndex: 'title' }, { title: '说明', dataIndex: 'description' },
  ];
  return <div><div className="page-heading"><div><Title level={2}>异常提示</Title><Text type="secondary">基于相邻数据日自动识别流量和转化异常</Text></div><Select value={date} onChange={setDate} options={dates.map((value) => ({ value, label: value }))} style={{ width: 150 }} /></div>
    <Card bordered={false} title="判断阈值"><Form form={form} layout="inline" onFinish={save} className="threshold-form"><Form.Item name="impressionsDrop" label="曝光下降"><InputNumber min={0} max={1} step={0.05} /></Form.Item><Form.Item name="clickThroughRateDrop" label="点击率下降"><InputNumber min={0} max={1} step={0.05} /></Form.Item><Form.Item name="cartRateDrop" label="加购率下降"><InputNumber min={0} max={1} step={0.05} /></Form.Item><Form.Item name="conversionRateDrop" label="支付转化下降"><InputNumber min={0} max={1} step={0.05} /></Form.Item><Form.Item name="consecutiveZeroOrderDays" label="连续无订单天数"><InputNumber min={1} max={30} /></Form.Item><Form.Item name="minimumImpressions" label="最低曝光基数"><InputNumber min={0} /></Form.Item><Form.Item><Button type="primary" htmlType="submit">保存并重算</Button></Form.Item></Form></Card>
    <Card bordered={false} className="section-row" title={<Space>异常清单<Tag color="red">{items.length}</Tag></Space>}><Table rowKey={(item) => `${item.type}-${item.spu}-${item.date}`} columns={columns} dataSource={items} /></Card>
  </div>;
}
