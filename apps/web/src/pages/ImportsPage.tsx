import { useEffect, useState } from 'react';
import { InboxOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Image, Modal, Progress, Space, Table, Tag, Typography, Upload, message } from 'antd';
import type { ImportBatch, ImportIssue, ImportPreview, ProductSummary } from '@temu-analytics/shared';
import { commitImport, errorMessage, getImports, previewImport } from '../api/client';

const { Title, Text } = Typography;
const { Dragger } = Upload;

export function ImportsPage() {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const reload = async () => setBatches(await getImports());
  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    const active = batches.some((batch) => batch.imageProgress.pending > 0 || batch.imageProgress.processing > 0);
    if (!active) return;
    const timer = window.setInterval(() => void reload(), 2_000);
    return () => window.clearInterval(timer);
  }, [batches]);

  const uploadFile = async (file: File) => {
    setLoading(true);
    try { setPreview(await previewImport(file)); } catch (error) { message.error(errorMessage(error)); }
    finally { setLoading(false); }
    return false;
  };
  const submit = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      const result = await commitImport(preview.token, preview.duplicateDate);
      const background = result.queuedImageCount > 0 ? `，${result.queuedImageCount} 张 URL 图片已进入后台处理` : '';
      message.success(`成功导入 ${result.importedRows} 行数据，同步保存 ${result.imageCount} 张内嵌图片${background}`);
      setPreview(null); void reload();
    } catch (error) { message.error(errorMessage(error)); }
    finally { setLoading(false); }
  };
  const issueColumns = [{ title: '行', dataIndex: 'row', width: 70 }, { title: '字段', dataIndex: 'field', width: 160 }, { title: '级别', dataIndex: 'severity', render: (value: string) => <Tag color={value === 'error' ? 'red' : 'gold'}>{value === 'error' ? '错误' : '提示'}</Tag> }, { title: '说明', dataIndex: 'message' }];
  const sampleColumns = [{ title: '图片', render: (_: unknown, item: ProductSummary) => item.imageUrl ? <Image src={item.imageUrl} width={46} /> : <div className="image-placeholder" /> }, { title: 'SPU', dataIndex: 'spu' }, { title: '曝光', dataIndex: 'impressions' }, { title: '点击', dataIndex: 'clicks' }, { title: '订单', dataIndex: 'orders' }];
  const batchColumns = [{ title: '导入时间', dataIndex: 'importedAt' }, { title: '数据日期', dataIndex: 'dataDate' }, { title: '文件名', dataIndex: 'fileName' }, { title: '行数', dataIndex: 'rowCount' }, { title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={value === 'completed' ? 'green' : 'default'}>{value === 'completed' ? '有效' : '已被覆盖'}</Tag> }, { title: '图片处理', width: 250, render: (_: unknown, batch: ImportBatch) => batch.imageProgress.total === 0 ? <Text type="secondary">无后台任务</Text> : <div><Progress percent={batch.imageProgress.percent} size="small" status={batch.imageProgress.failed > 0 && batch.imageProgress.pending === 0 && batch.imageProgress.processing === 0 ? 'exception' : 'active'} /><Text type="secondary">成功 {batch.imageProgress.completed} / {batch.imageProgress.total}{batch.imageProgress.processing > 0 ? `，处理中 ${batch.imageProgress.processing}` : ''}{batch.imageProgress.failed > 0 ? `，失败 ${batch.imageProgress.failed}` : ''}</Text></div> }, { title: '提示', dataIndex: 'issueCount' }];

  return <div><div className="page-heading"><div><Title level={2}>每日数据导入</Title><Text type="secondary">统计日期从文件名提取；同一日期重复导入时需确认覆盖</Text></div></div>
    <Card bordered={false}><Dragger accept=".xlsx" maxCount={1} showUploadList={false} beforeUpload={uploadFile} disabled={loading}><p className="ant-upload-drag-icon"><InboxOutlined /></p><p className="ant-upload-text">点击或拖入 Temu 商品数据 Excel</p><p className="ant-upload-hint">数据和内嵌图片先导入；URL 图片进入后台队列下载，关闭页面后仍会继续处理</p></Dragger></Card>
    <Card bordered={false} className="section-row" title="导入记录"><Table rowKey="id" columns={batchColumns} dataSource={batches} scroll={{ x: 850 }} /></Card>
    <Modal open={Boolean(preview)} onCancel={() => setPreview(null)} width={920} title="导入预检" footer={<Space><Button onClick={() => setPreview(null)}>取消</Button><Button type="primary" danger={Boolean(preview?.duplicateDate)} loading={loading} disabled={Boolean(preview?.issues.some((item) => item.severity === 'error'))} onClick={submit}>{preview?.duplicateDate ? '确认覆盖并导入' : '确认导入'}</Button></Space>}>
      {preview && <><Descriptions bordered size="small" column={3}><Descriptions.Item label="统计日期">{preview.dataDate}</Descriptions.Item><Descriptions.Item label="有效行数">{preview.validRowCount}</Descriptions.Item><Descriptions.Item label="内嵌图片">{preview.embeddedImageCount}</Descriptions.Item><Descriptions.Item label="URL 图片">{preview.remoteImageCount}</Descriptions.Item><Descriptions.Item label="现有数据">{preview.existingRowCount} 行</Descriptions.Item><Descriptions.Item label="文件">{preview.fileName}</Descriptions.Item></Descriptions>
        {preview.duplicateDate && <Alert className="preview-alert" type="warning" showIcon message={`该日期已有 ${preview.existingRowCount} 行，确认后将被本次数据整体覆盖。`} />}
        {preview.issues.length > 0 && <Table<ImportIssue> className="preview-table" rowKey={(item) => `${item.row}-${item.field}-${item.message}`} size="small" columns={issueColumns} dataSource={preview.issues} pagination={{ pageSize: 5 }} />}
        <Table<ProductSummary> className="preview-table" rowKey="spu" size="small" columns={sampleColumns} dataSource={preview.sample} pagination={false} /></>}
    </Modal>
  </div>;
}
