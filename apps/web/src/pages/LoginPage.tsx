import { useState } from 'react';
import { Button, Card, Form, Input, Segmented, Typography, message } from 'antd';
import { Navigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const { Title, Text } = Typography;
interface Credentials { username: string; password: string }

export function LoginPage() {
  const { session, login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  if (session) return <Navigate to="/" replace />;

  const submit = async (values: Credentials) => {
    setLoading(true);
    try {
      if (mode === 'login') await login(values.username, values.password);
      else await register(values.username, values.password);
    } catch (error) {
      messageApi.error(errorMessage(error));
    } finally { setLoading(false); }
  };

  return <div className="auth-page">{contextHolder}<Card className="auth-card" bordered={false}>
    <Title level={2}>Temu 数据分析</Title>
    <Text type="secondary">登录后访问您的独立商品数据</Text>
    <Segmented block value={mode} onChange={setMode} options={[{ label: '登录', value: 'login' }, { label: '自主注册', value: 'register' }]} />
    <Form layout="vertical" onFinish={(values) => void submit(values as Credentials)}>
      <Form.Item name="username" label="用户名" rules={[{ required: true }, { min: 3 }, { max: 32 }]}><Input autoComplete="username" /></Form.Item>
      <Form.Item name="password" label="密码" rules={[{ required: true }, { min: 8 }, { max: 128 }]}><Input.Password autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></Form.Item>
      <Button block type="primary" htmlType="submit" loading={loading}>{mode === 'login' ? '登录' : '注册并登录'}</Button>
    </Form>
    {mode === 'login' && <Text type="secondary" className="default-admin-tip">默认管理员：admin / password</Text>}
  </Card></div>;
}
