import { useEffect, useState } from 'react';
import { CloudDownloadOutlined, DatabaseOutlined, HistoryOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Modal, Space, Table, Tag, Typography, Upload, message } from 'antd';
import {
  createBackup,
  errorMessage,
  getBackups,
  restoreStoredBackup,
  restoreUploadedBackup,
  type BackupInfo,
} from '../api/client';

const { Title, Text } = Typography;
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const typeLabels: Record<BackupInfo['type'], { text: string; color: string }> = {
  automatic: { text: '自动', color: 'blue' },
  manual: { text: '手动', color: 'green' },
  pre_restore: { text: '恢复前', color: 'orange' },
};

export function BackupsPage() {
  const [items, setItems] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);
  const reload = () => void getBackups().then(setItems).catch((error) => message.error(errorMessage(error)));
  useEffect(reload, []);

  const create = async () => {
    setLoading(true);
    try { await createBackup(); message.success('手动备份创建完成'); reload(); }
    catch (error) { message.error(errorMessage(error)); }
    finally { setLoading(false); }
  };

  const restore = async () => {
    if (!restoring) return;
    setLoading(true);
    try {
      await restoreStoredBackup(restoring.fileName);
      message.success('当前数据账号已恢复完成。');
      setRestoring(null);
      window.location.reload();
    } catch (error) { message.error(errorMessage(error)); }
    finally { setLoading(false); }
  };

  const uploadBackup = async (file: File) => {
    Modal.confirm({
      title: '恢复外部备份文件？',
      icon: <HistoryOutlined />,
      content: '恢复前会自动保存当前数据账号的状态，并只替换该账号的业务数据、关联图片和原始 Excel。',
      okText: '确认恢复',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setLoading(true);
        try {
          await restoreUploadedBackup(file);
          message.success('当前数据账号已恢复完成。');
          window.location.reload();
        } catch (error) { message.error(errorMessage(error)); }
        finally { setLoading(false); }
      },
    });
    return false;
  };

  const columns = [
    { title: '类型', dataIndex: 'type', width: 90, render: (value: BackupInfo['type']) => <Tag color={typeLabels[value].color}>{typeLabels[value].text}</Tag> },
    { title: '创建时间', dataIndex: 'createdAt', width: 190, render: (value: string) => new Date(value).toLocaleString('zh-CN') },
    { title: '数据日期', render: (_: unknown, item: BackupInfo) => item.latestDataDate ? item.earliestDataDate === item.latestDataDate ? item.latestDataDate : `${item.earliestDataDate} 至 ${item.latestDataDate}` : '空数据状态' },
    { title: '数据概况', render: (_: unknown, item: BackupInfo) => `${item.metricRowCount} 条指标 / ${item.productCount} 个 SPU / ${item.importBatchCount} 个批次` },
    { title: '大小', dataIndex: 'byteSize', width: 100, render: size },
    { title: '操作', width: 190, render: (_: unknown, item: BackupInfo) => <Space><Button size="small" icon={<CloudDownloadOutlined />} href={`/api/backups/${encodeURIComponent(item.fileName)}/download`}>下载</Button><Button size="small" danger icon={<HistoryOutlined />} onClick={() => setRestoring(item)}>恢复</Button></Space> },
  ];

  return <div>
    <div className="page-heading"><div><Title level={2}>账号数据备份与恢复</Title><Text type="secondary">仅备份当前数据账号；每次导入前自动备份，自动备份保留最近 3 个自然日</Text></div><Space><Upload accept=".zip" maxCount={1} showUploadList={false} beforeUpload={uploadBackup}><Button icon={<UploadOutlined />} loading={loading}>上传账号备份恢复</Button></Upload><Button type="primary" icon={<DatabaseOutlined />} loading={loading} onClick={create}>创建账号手动备份</Button></Space></div>
    <Alert type="info" showIcon message="错误导入处理" description="若只是同一天数据有误，可重新上传正确文件覆盖；若日期或多天数据导错，可在下方选择导入前的自动备份恢复。恢复前系统会再次创建“恢复前”快照。" />
    <Card bordered={false} className="section-row"><Table rowKey="fileName" columns={columns} dataSource={items} scroll={{ x: 1050 }} /></Card>
    <Modal open={Boolean(restoring)} title="确认恢复到此备份" okText="确认恢复" okType="danger" cancelText="取消" confirmLoading={loading} onOk={restore} onCancel={() => setRestoring(null)}>
      {restoring && <Space direction="vertical" size="middle" style={{ width: '100%' }}><Alert type="warning" showIcon message="恢复会替换当前数据账号的业务数据" description="其他用户账号及其数据不会受到影响。系统会先自动创建当前账号的恢复前快照。" /><Text>备份类型：<Tag color={typeLabels[restoring.type].color}>{typeLabels[restoring.type].text}</Tag></Text><Text>创建时间：{new Date(restoring.createdAt).toLocaleString('zh-CN')}</Text><Text>数据范围：{restoring.latestDataDate ? `${restoring.earliestDataDate} 至 ${restoring.latestDataDate}` : '空数据状态'}</Text><Text>数据概况：{restoring.metricRowCount} 条指标，{restoring.productCount} 个 SPU</Text></Space>}
    </Modal>
  </div>;
}
