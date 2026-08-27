import type { ProductManagementRecord } from "@temu-analytics/shared";
import { Card, Collapse, Descriptions, Empty, Modal, Space, Tag, Typography } from "antd";

const { Text } = Typography;

function money(value: number | null): string {
  return value === null ? "-" : value.toFixed(2);
}

function percent(value: number | null): string {
  return value === null ? "-" : `${(value * 100).toFixed(1)}%`;
}

function attributeText(attributes: string[]): string {
  return attributes.length ? attributes.join("；") : "-";
}

export interface ProductLifecycleDetailModalProps {
  record: ProductManagementRecord | null;
  onClose: () => void;
}

export function ProductLifecycleDetailModal({
  record,
  onClose,
}: ProductLifecycleDetailModalProps) {
  const match = record?.lifecycleMatch;
  return (
    <Modal
      title={record ? `产品详情 · ${record.productCode}` : "产品详情"}
      open={Boolean(record)}
      onCancel={onClose}
      footer={null}
      width={1050}
      destroyOnHidden
    >
      {record && (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Descriptions size="small" bordered column={3}>
            <Descriptions.Item label="主档货号">
              {record.productCode}
            </Descriptions.Item>
            <Descriptions.Item label="货值">
              {money(record.goodsValue)}
            </Descriptions.Item>
            <Descriptions.Item label="总成本">
              {money(record.totalCost)}
            </Descriptions.Item>
            <Descriptions.Item label="序列号">
              {record.serialNumber ?? "-"}
            </Descriptions.Item>
            <Descriptions.Item label="推荐售价">
              {money(record.recommendedPrice)}
            </Descriptions.Item>
            <Descriptions.Item label="利率门槛值">
              {money(record.profitThresholdPrice)}
            </Descriptions.Item>
          </Descriptions>

          {!match || match.matchType === "none" || !match.details.length ? (
            <Empty description="未匹配到生命周期 SPU / SKC / SKU 数据" />
          ) : (
            <>
              <Space wrap>
                <Tag color={match.matchType === "skc" ? "blue" : "purple"}>
                  {match.matchType === "skc" ? "SKC 货号匹配" : "SKU 货号匹配"}
                </Tag>
                <Text>最低供应价：{money(match.lowestSupplierPrice)}</Text>
                <Text>限流价格：{money(match.trafficLimitPrice)}</Text>
              </Space>
              {record.spuLinks.map((link) => (
                <Descriptions
                  key={link.id}
                  size="small"
                  bordered
                  column={4}
                  title={`SPU ${link.spu ?? "待补充"} · 限流定价`}
                >
                  <Descriptions.Item label="最低限流价格">
                    {money(link.trafficLimitPrice)}
                  </Descriptions.Item>
                  <Descriptions.Item label="限流利润率">
                    {percent(link.trafficLimitProfitMargin)}
                  </Descriptions.Item>
                  <Descriptions.Item label="限流建议折扣">
                    {percent(link.trafficLimitSuggestedActivityDiscount)}
                  </Descriptions.Item>
                  <Descriptions.Item label="限流最终折扣">
                    {percent(link.trafficLimitFinalActivityDiscount)}
                  </Descriptions.Item>
                  <Descriptions.Item label="限流活动价">
                    {money(link.trafficLimitActivityPrice)}
                  </Descriptions.Item>
                  <Descriptions.Item label="限流流量价">
                    {money(link.trafficLimitTrafficPrice)}
                  </Descriptions.Item>
                  <Descriptions.Item label="限流 ROAS">
                    {link.trafficLimitRoas ?? "-"}
                  </Descriptions.Item>
                </Descriptions>
              ))}
              <Collapse
                items={match.details.map((spu) => ({
                  key: spu.spu,
                  label: (
                    <Space wrap>
                      <Text strong>SPU {spu.spu}</Text>
                      <Text type="secondary">
                        最低供应价 {money(spu.lowestSupplierPrice)}
                      </Text>
                      <Text type="secondary">
                        限流价格 {money(spu.trafficLimitPrice)}
                      </Text>
                    </Space>
                  ),
                  children: (
                    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                      {spu.skcs.map((skc, skcIndex) => (
                        <Card
                          key={`${spu.spu}-${skc.skcId ?? skc.skcCode ?? skcIndex}`}
                          size="small"
                          title={
                            <Space wrap>
                              <Text strong>SKC {skc.skcId ?? "-"}</Text>
                              <Tag>{skc.displayCode ?? "无展示货号"}</Tag>
                            </Space>
                          }
                        >
                          <Descriptions size="small" bordered column={2}>
                            <Descriptions.Item label="完整 SKC 货号">
                              {skc.skcCode ?? "-"}
                            </Descriptions.Item>
                            <Descriptions.Item label="颜色/款式属性">
                              {attributeText(skc.attributes)}
                            </Descriptions.Item>
                            <Descriptions.Item label="最低供应价">
                              {money(skc.lowestSupplierPrice)}
                            </Descriptions.Item>
                            <Descriptions.Item label="限流价格">
                              {money(skc.trafficLimitPrice)}
                            </Descriptions.Item>
                          </Descriptions>
                          <Collapse
                            style={{ marginTop: 12 }}
                            items={skc.skus.map((sku, skuIndex) => ({
                              key: `${skc.skcId ?? skc.skcCode ?? skcIndex}-${sku.skuId ?? sku.skuCode ?? skuIndex}`,
                              label: (
                                <Space wrap>
                                  <Text>SKU {sku.skuId ?? "-"}</Text>
                                  <Tag>{sku.displayCode ?? "无展示货号"}</Tag>
                                  {sku.sizeName && <Tag color="geekblue">{sku.sizeName}</Tag>}
                                </Space>
                              ),
                              children: (
                                <Descriptions size="small" bordered column={2}>
                                  <Descriptions.Item label="完整 SKU 货号">
                                    {sku.skuCode ?? "-"}
                                  </Descriptions.Item>
                                  <Descriptions.Item label="尺码/规格属性">
                                    {attributeText(sku.attributes)}
                                  </Descriptions.Item>
                                  <Descriptions.Item label="最低供应价">
                                    {money(sku.lowestSupplierPrice)}
                                  </Descriptions.Item>
                                  <Descriptions.Item label="限流价格">
                                    {money(sku.trafficLimitPrice)}
                                  </Descriptions.Item>
                                </Descriptions>
                              ),
                            }))}
                          />
                        </Card>
                      ))}
                    </Space>
                  ),
                }))}
              />
            </>
          )}
        </Space>
      )}
    </Modal>
  );
}
