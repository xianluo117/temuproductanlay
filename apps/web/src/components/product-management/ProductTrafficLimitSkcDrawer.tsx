import type { ProductManagementTrafficLimitSkc } from "@temu-analytics/shared";
import { Card, Collapse, Descriptions, Drawer, Empty, Space, Tag, Typography } from "antd";

const { Text } = Typography;

function money(value: number | null): string {
  return value === null ? "-" : value.toFixed(2);
}

function attributes(values: string[]): string {
  return values.length ? values.join("；") : "-";
}

export interface ProductTrafficLimitSkcDrawerProps {
  open: boolean;
  productCode: string | null;
  spu: string | null;
  loading: boolean;
  items: ProductManagementTrafficLimitSkc[];
  onClose: () => void;
}

export function ProductTrafficLimitSkcDrawer({
  open,
  productCode,
  spu,
  loading,
  items,
  onClose,
}: ProductTrafficLimitSkcDrawerProps) {
  return (
    <Drawer
      title={`限流 SKC · ${productCode ?? "-"} · SPU ${spu ?? "-"}`}
      open={open}
      loading={loading}
      onClose={onClose}
      width={900}
      destroyOnHidden
    >
      {items.length === 0 ? (
        <Empty description="该 SPU 当前没有有效限流 SKC" />
      ) : (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Text type="secondary">
            以下 SKC 仅供运营人员判断处理方式；限流后的利润率与定价统一在 SPU 层计算。
          </Text>
          {items.map((skc, index) => (
            <Card
              key={`${skc.skcId ?? skc.skcCode ?? index}`}
              size="small"
              title={
                <Space wrap>
                  <Text strong>SKC {skc.skcId ?? "-"}</Text>
                  <Tag>{skc.displayCode ?? "无展示货号"}</Tag>
                  <Tag color="red">限流价 {money(skc.trafficLimitPrice)}</Tag>
                </Space>
              }
            >
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label="完整 SKC 货号">
                  {skc.skcCode ?? "-"}
                </Descriptions.Item>
                <Descriptions.Item label="颜色/款式属性">
                  {attributes(skc.attributes)}
                </Descriptions.Item>
              </Descriptions>
              <Collapse
                style={{ marginTop: 12 }}
                items={skc.skus.map((sku, skuIndex) => ({
                  key: `${skc.skcId ?? skc.skcCode ?? index}-${sku.skuId ?? sku.skuCode ?? skuIndex}`,
                  label: (
                    <Space wrap>
                      <Text>SKU {sku.skuId ?? "-"}</Text>
                      <Tag>{sku.displayCode ?? "无展示货号"}</Tag>
                      {sku.sizeName && <Tag color="geekblue">{sku.sizeName}</Tag>}
                      {sku.trafficLimitPrice !== null && (
                        <Tag color="red">限流价 {money(sku.trafficLimitPrice)}</Tag>
                      )}
                    </Space>
                  ),
                  children: (
                    <Descriptions bordered size="small" column={2}>
                      <Descriptions.Item label="完整 SKU 货号">
                        {sku.skuCode ?? "-"}
                      </Descriptions.Item>
                      <Descriptions.Item label="尺码/规格属性">
                        {attributes(sku.attributes)}
                      </Descriptions.Item>
                    </Descriptions>
                  ),
                }))}
              />
            </Card>
          ))}
        </Space>
      )}
    </Drawer>
  );
}
