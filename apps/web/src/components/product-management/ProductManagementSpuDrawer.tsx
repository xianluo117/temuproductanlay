import { useMemo } from "react";
import { Button, Card, Collapse, Descriptions, Drawer, Empty, Image, Space, Tag, Typography } from "antd";
import type { ProductManagementBySpuResponse, ProductManagementRecord } from "@temu-analytics/shared";

const { Text, Link } = Typography;
const money = (value: number | null) => value === null ? "-" : value.toFixed(2);
const percent = (value: number | null) => value === null ? "-" : `${(value * 100).toFixed(1)}%`;

export interface ProductManagementSpuDrawerProps {
  open: boolean;
  loading: boolean;
  data: ProductManagementBySpuResponse | null;
  onClose: () => void;
  onEdit?: (record: ProductManagementRecord) => void;
}

export function ProductManagementSpuDrawer({ open, loading, data, onClose, onEdit }: ProductManagementSpuDrawerProps) {
  const records = useMemo(() => data?.records ?? [], [data]);
  return (
    <Drawer title={data ? `产品详细 · SPU ${data.spu}` : "产品详细"} open={open} onClose={onClose} width={900} loading={loading}>
      {!loading && data && records.length === 0 ? <Empty description="该SPU尚未关联产品管理主档" /> : records.length > 0 && (
        <Collapse items={records.map((record) => ({
          key: record.id,
          label: <Space wrap><Text strong>{record.productCode}</Text><Tag>创建人：{record.createdByUsername}</Tag>{record.canEdit && onEdit && <Button size="small" onClick={(event) => { event.stopPropagation(); onEdit(record); }}>编辑</Button>}</Space>,
          children: <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Descriptions size="small" bordered column={{ xs: 1, sm: 2, md: 3 }}>
              <Descriptions.Item label="货号">{record.productCode}</Descriptions.Item>
              <Descriptions.Item label="序列号">{record.serialNumber ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="重量/KG">{record.weightKg}</Descriptions.Item>
              <Descriptions.Item label="货值">{money(record.goodsValue)}</Descriptions.Item>
              <Descriptions.Item label="总成本">{money(record.totalCost)}</Descriptions.Item>
              <Descriptions.Item label="推荐售价">{money(record.recommendedPrice)}</Descriptions.Item>
              <Descriptions.Item label="利率门槛值">{money(record.profitThresholdPrice)}</Descriptions.Item>
              <Descriptions.Item label="Y2库存">{record.y2Inventory ? `${record.y2Inventory.totalQuantity} 件` : "未录入"}</Descriptions.Item>
            </Descriptions>
            {record.spuLinks.filter((link) => link.spu?.trim().toUpperCase() === data?.spu.trim().toUpperCase()).map((link) => (
              <Card key={link.id} size="small" title={`SPU ${link.spu ?? "-"}`}>
                <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }}>
                  <Descriptions.Item label="备注">{link.note ?? "-"}</Descriptions.Item>
                  <Descriptions.Item label="核价价">{money(link.reviewPrice)}</Descriptions.Item>
                  <Descriptions.Item label="核价利润率">{percent(link.reviewProfitMargin)}</Descriptions.Item>
                  <Descriptions.Item label="活动价">{money(link.activityPrice)}</Descriptions.Item>
                  <Descriptions.Item label="流量价">{money(link.trafficPrice)}</Descriptions.Item>
                  <Descriptions.Item label="订单数量">{link.orderCount ?? "-"}</Descriptions.Item>
                  <Descriptions.Item label="绑定数量">{link.bindings.length}</Descriptions.Item>
                </Descriptions>
                {link.bindings.length > 0 && <Space wrap style={{ marginTop: 12 }}>{link.bindings.map((binding) => <Tag key={binding.id}>{binding.skuCode ?? binding.skuId ?? binding.skcCode ?? binding.skcId ?? "未命名绑定"}</Tag>)}</Space>}
              </Card>
            ))}
            {record.purchaseLinks.length > 0 && <Space wrap>{record.purchaseLinks.map((url, index) => <Link key={`${url}-${index}`} href={url} target="_blank">进货链接 {index + 1}</Link>)}</Space>}
            {record.imageUrl && <Image src={record.imageUrl} width={90} height={90} style={{ objectFit: "cover" }} />}
          </Space>,
        }))} />
      )}
    </Drawer>
  );
}
                    
