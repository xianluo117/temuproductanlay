import { useEffect, useState } from 'react';
import { CloudDownloadOutlined, DatabaseOutlined, HistoryOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Modal, Space, Table, Tag, Typography, Upload, message } from 'antd';
import {
  createSystemBackup,
  errorMessage,
  getSystemBackups,
  restoreStoredSystemBackup,
  restoreUploadedSystemBackup,
  type BackupInfo,
} from '../api/client';

const { Title, Text } = Typography;
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const typeLabels: Record<BackupInfo['type'], { text: string; color: string }> = {
  automatic: { text: '自动', color: 'blue' }, manual: { text: '手动', color: 'green' }, pre_restore: { text: '恢复前', color: 'orange' },
};

export function SystemBackupsPage() {
  const [items, setItems] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);
  const reload = () => void getSystemBackups().then(setItems).catch((error) => message.error(errorMessage(error)));
  useEffect(reload, []);
  const create = async () => { setLoading(true); try { await createSystemBackup(); message.success('完整系统备份创建完成'); reload(); } catch (error) { message.error(errorMessage(error)); } finally { setLoading(false); } };
  const restore = async () => {
    if (!restoring) return;
    setLoading(true);
    try { await restoreStoredSystemBackup(restoring.fileName); message.success('系统恢复已提交，服务正在重启。'); setTimeout(() => window.location.reload(), 4000); }
    catch (error) { message.error(errorMessage(error)); } finally { setLoading(false); }
  };
  const upload = async (file: File) => {
    Modal.confirm({ title: '恢复完整系统备份？', content: '这会替换全部账号、会话及所有用户业务数据。', okType: 'danger', okText: '确认恢复', onOk: async () => { setLoading(true); try { await restoreUploadedSystemBackup(file); setTimeout(() => window.location.reload(), 4000); } catch (error) { message.error(errorMessage(error)); } finally { setLoading(false); } } });
    return false;
  };
  const columns = [
    { title: '类型', dataIndex: 'type', render: (value: BackupInfo['type']) => <Tag color={typeLabels[value].color}>{typeLabels[value].text}</Tag> },
    { title: '创建时间', dataIndex: 'createdAt', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
    { title: '数据概况', render: (_: unknown, item: BackupInfo) => `${item.metricRowCount} 条指标 / ${item.productCount} 个 SPU / ${item.importBatchCount} 个批次` },
    { title: '大小', dataIndex: 'byteSize', render: size },
    { title: '操作', render: (_: unknown, item: BackupInfo) => <Space><Button icon={<CloudDownloadOutlined />} href={`/api/backups/${encodeURIComponent(item.fileName)}/download`}>下载</Button><Button danger icon={<HistoryOutlined />} onClick={() => setRestoring(item)}>恢复</Button></Space> },
  ];
  return <div><div className="page-heading"><div><Title level={2}>系统备份</Title><Text type="secondary">管理员专用：包含全部账号和全部用户业务数据</Text></div><Space><Upload accept=".zip" showUploadList={false} beforeUpload={upload}><Button icon={<UploadOutlined />}>上传系统备份</Button></Upload><Button type="primary" icon={<DatabaseOutlined />} loading={loading} onClick={create}>创建系统备份</Button></Space></div>
    <Alert type="warning" showIcon message="系统恢复会影响全部用户" description="普通业务恢复请使用“备份管理”；本页仅用于整套应用灾难恢复。" />
    <Card className="section-row" bordered={false}><Table rowKey="fileName" dataSource={items} columns={columns} /></Card>
    <Modal open={Boolean(restoring)} title="确认恢复完整系统" okType="danger" okText="确认恢复" confirmLoading={loading} onOk={() => void restore()} onCancel={() => setRestoring(null)}><Text>恢复后服务会自动重启，当前所有账号和数据将由备份内容替换。</Text></Modal>
  </div>;
}
