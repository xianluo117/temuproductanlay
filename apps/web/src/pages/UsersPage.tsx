import { useEffect, useState } from 'react';
import type { UserAccount } from '@temu-analytics/shared';
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Typography, message } from 'antd';
import { errorMessage, getUsers, resetUserPassword, updateUser } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const { Title, Text } = Typography;

export function UsersPage() {
  const { session } = useAuth();
  const [items, setItems] = useState<UserAccount[]>([]);
  const [resetting, setResetting] = useState<UserAccount | null>(null);
  const [form] = Form.useForm<{ newPassword: string }>();
  const [messageApi, contextHolder] = message.useMessage();
  const reload = async () => setItems(await getUsers());
  useEffect(() => { if (session?.user.role === 'admin') void reload(); }, [session?.user.role]);

  if (session?.user.role !== 'admin') return <Text>无权访问用户管理。</Text>;

  const patch = async (user: UserAccount, value: { role?: 'admin' | 'user'; enabled?: boolean }) => {
    try { await updateUser(user.id, value); await reload(); }
    catch (error) { messageApi.error(errorMessage(error)); }
  };

  const submitReset = async () => {
    if (!resetting) return;
    try {
      const values = await form.validateFields();
      await resetUserPassword(resetting.id, values);
      messageApi.success('密码已重置，该用户下次登录必须修改密码');
      setResetting(null);
      form.resetFields();
    } catch (error) {
      if (error instanceof Error) messageApi.error(errorMessage(error));
    }
  };

  return <div>{contextHolder}<div className="page-heading"><div><Title level={2}>用户管理</Title><Text type="secondary">管理角色、账号状态和密码重置</Text></div></div>
    <Table rowKey="id" dataSource={items} columns={[
      { title: '用户名', dataIndex: 'username' },
      { title: '角色', render: (_, record: UserAccount) => <Select value={record.role} style={{ width: 120 }} options={[{ value: 'admin', label: '管理员' }, { value: 'user', label: '普通用户' }]} onChange={(role) => void patch(record, { role })} /> },
      { title: '启用', render: (_, record: UserAccount) => <Popconfirm title={record.enabled ? '确认停用该账号？' : '确认启用该账号？'} onConfirm={() => void patch(record, { enabled: !record.enabled })}><Switch checked={record.enabled} /></Popconfirm> },
      { title: '首次改密', render: (_, record: UserAccount) => record.mustChangePassword ? '是' : '否' },
      { title: '操作', render: (_, record: UserAccount) => <Space><Button onClick={() => { setResetting(record); form.resetFields(); }}>重置密码</Button></Space> },
    ]} />
    <Modal title={`重置 ${resetting?.username ?? ''} 的密码`} open={Boolean(resetting)} onCancel={() => setResetting(null)} onOk={() => void submitReset()} okText="确认重置">
      <Form form={form} layout="vertical"><Form.Item name="newPassword" label="新密码" rules={[{ required: true }, { min: 8 }, { max: 128 }]}><Input.Password /></Form.Item></Form>
    </Modal>
  </div>;
}
