import { useEffect, useState } from 'react';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import type { GlobalOperationRecord } from '@temu-analytics/shared';
import dayjs, { type Dayjs } from 'dayjs';
import {
  createGlobalOperation,
  deleteGlobalOperation,
  errorMessage,
  getGlobalOperations,
  updateGlobalOperation,
} from '../api/client';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

interface OperationFormValue {
  operatedAt: Dayjs;
  content: string;
  note?: string;
}

function localDateTime(value: string): string {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  return dayjs(normalized).format('YYYY-MM-DD HH:mm:ss');
}

export function GlobalOperationsPage() {
  const [form] = Form.useForm<OperationFormValue>();
  const [items, setItems] = useState<GlobalOperationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GlobalOperationRecord | null>(null);

  const reload = async () => {
    setLoading(true);
    try { setItems(await getGlobalOperations()); }
    catch (error) { message.error(errorMessage(error)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void reload(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ operatedAt: dayjs(), content: '', note: '' });
    setModalOpen(true);
  };

  const openEdit = (record: GlobalOperationRecord) => {
    setEditing(record);
    form.setFieldsValue({ operatedAt: dayjs(record.operatedAt), content: record.content, note: record.note ?? '' });
    setModalOpen(true);
  };

  const save = async () => {
    try {
      const value = await form.validateFields();
      setSaving(true);
      const input = {
        operatedAt: value.operatedAt.toISOString(),
        content: value.content,
        note: value.note?.trim() || null,
      };
      if (editing) await updateGlobalOperation(editing.id, input);
      else await createGlobalOperation(input);
      setModalOpen(false);
      message.success(editing ? '全局操作记录已更新。' : '全局操作记录已新增。');
      await reload();
    } catch (error) {
      if (error instanceof Error) message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (record: GlobalOperationRecord) => {
    try {
      await deleteGlobalOperation(record.id);
      message.success('全局操作记录已删除。');
      await reload();
    } catch (error) { message.error(errorMessage(error)); }
  };

  const columns: TableColumnsType<GlobalOperationRecord> = [
    { title: '操作时间', dataIndex: 'operatedAt', width: 180, render: (value: string) => localDateTime(value) },
    { title: '操作内容', dataIndex: 'content', render: (value: string) => <Paragraph className="operation-content">{value}</Paragraph> },
    { title: '备注', dataIndex: 'note', render: (value: string | null) => value ? <Paragraph className="operation-note">{value}</Paragraph> : <Text type="secondary">-</Text> },
    { title: '记录信息', width: 210, render: (_, record) => <Space direction="vertical" size={0}><Text type="secondary">创建：{localDateTime(record.createdAt)}</Text><Text type="secondary">更新：{localDateTime(record.updatedAt)}</Text></Space> },
    { title: '操作', width: 130, fixed: 'right', render: (_, record) => <Space><Button type="text" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button><Popconfirm title="删除全局操作记录" description={`确认删除 ${localDateTime(record.operatedAt)} 的记录？`} okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => remove(record)}><Button type="text" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm></Space> },
  ];

  return <div>
    <div className="page-heading"><div><Title level={2}>全局操作记录</Title><Text type="secondary">记录会对全部产品产生影响的平台操作、政策变化或经营调整</Text></div><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增全局记录</Button></div>
    <Card bordered={false}><Table rowKey="id" columns={columns} dataSource={items} loading={loading} pagination={{ pageSize: 10 }} scroll={{ x: 1050 }} locale={{ emptyText: '暂无全局操作记录' }} /></Card>
    <Modal title={editing ? '编辑全局操作记录' : '新增全局操作记录'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void save()} confirmLoading={saving} okText="保存" cancelText="取消" destroyOnHidden>
      <Form form={form} layout="vertical" preserve={false} className="operation-form">
        <Form.Item name="operatedAt" label="操作日期时间" rules={[{ required: true, message: '请选择操作日期时间。' }]}><DatePicker showTime format="YYYY-MM-DD HH:mm:ss" style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="content" label="操作内容" rules={[{ required: true, whitespace: true, message: '请输入操作内容。' }, { max: 1000, message: '操作内容不能超过 1000 个字符。' }]}><TextArea rows={4} showCount maxLength={1000} placeholder="填写对全部产品造成影响的操作或事件" /></Form.Item>
        <Form.Item name="note" label="备注" rules={[{ max: 3000, message: '备注不能超过 3000 个字符。' }]}><TextArea rows={4} showCount maxLength={3000} placeholder="选填：影响范围、原因、预期效果或后续观察事项" /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
