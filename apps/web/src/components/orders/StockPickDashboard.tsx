import type {
  ZhihouAllocatedOrder,
  ZhihouStockPickDashboard,
  ZhihouStockPickItem,
} from "@temu-analytics/shared";
import { Button, Card, Space, Statistic, Table, Tag, Typography, message } from "antd";
import { useMemo, useState } from "react";
import { localDateTime } from "../../utils/date-time";
import { OrderSpecificationImage } from "./OrderSpecificationImage";
import { orderSizes, normalizeOrderSize } from "./order-size-columns";

const { Text } = Typography;

type PickMatrixCell = {
  key: string;
  color: string;
  size: string;
  items: ZhihouStockPickItem[];
};

type PickMatrixRow = {
  key: string;
  color: string;
  cells: Record<string, PickMatrixCell>;
};

type PickMatrix = {
  key: string;
  parentSpu: string;
  productCodes: string[];
  imageUrls: string[];
  sizes: string[];
  rows: PickMatrixRow[];
};

function buildPickMatrices(items: ZhihouStockPickItem[]): PickMatrix[] {
  const groups = new Map<string, ZhihouStockPickItem[]>();
  for (const item of items) {
    const key = item.parentSpu ?? `SKU:${item.targetZhihouSku}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].map(([key, group]) => {
    const sizes = orderSizes(group.map((item) => item.targetSize));
    const colors = [...new Set(group.map((item) => item.targetColor))].sort((left, right) =>
      left.localeCompare(right, "zh-CN"),
    );
    return {
      key,
      parentSpu: group[0]?.parentSpu ?? group[0]?.targetZhihouSku ?? "-",
      productCodes: [...new Set(group.map((item) => item.productCode))].sort(),
      imageUrls: [...new Set(group.flatMap((item) => item.imageUrls))],
      sizes,
      rows: colors.map((color) => ({
        key: `${key}:${color}`,
        color,
        cells: Object.fromEntries(sizes.map((size) => {
          const cellItems = group.filter((item) => item.targetColor === color && item.targetSize === size);
          return [size, { key: `${key}:${color}:${size}`, color, size, items: cellItems }];
        })),
      })),
    };
  });
}

interface Props {
  data: ZhihouStockPickDashboard | null;
  loading: boolean;
  onMatch: () => Promise<void>;
  onAdjust: () => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

export function StockPickDashboard({ data, loading, onMatch, onAdjust, onDelete }: Props) {
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [messageApi, contextHolder] = message.useMessage();
  const completed = useMemo(() => (data?.orders ?? []).filter((order) => order.complete), [data]);
  const orderedOrders = useMemo(
    () => (data?.orders ?? []).map((order, index) => ({ order, index })).sort((left, right) => {
      const productCodeComparison = left.order.productCodes.join("|").localeCompare(right.order.productCodes.join("|"), "zh-CN");
      if (productCodeComparison !== 0) return productCodeComparison;
      return left.index - right.index;
    }).map(({ order }) => order),
    [data],
  );
  const pickMatrices = useMemo(() => buildPickMatrices(data?.picks ?? []), [data]);
  const copyOrders = async () => {
    if (!selectedOrders.length) {
      messageApi.warning("请先选择整单已配齐的订单。");
      return;
    }
    const text = selectedOrders.join("\n");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("clipboard unavailable");
      }
      messageApi.success(`已复制 ${selectedOrders.length} 个订单号。`);
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!copied) throw new Error("copy failed");
        messageApi.success(`已复制 ${selectedOrders.length} 个订单号。`);
      } catch {
        messageApi.error("复制失败，请检查浏览器剪贴板权限后重试。");
      }
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {contextHolder}
      <Space wrap>
        <Card><Statistic title="已拿货" value={data?.totalPickedQuantity ?? 0} suffix="件" /></Card>
        <Card><Statistic title="待匹配订单" value={data?.totalUnmatchedQuantity ?? 0} suffix="件" /></Card>
        <Card><Statistic title="待修正库存" value={data?.totalUnadjustedQuantity ?? 0} suffix="件" /></Card>
        <Card><Statistic title="整单已配齐" value={data?.completedOrderCount ?? 0} suffix="单" /></Card>
      </Space>
      <Space wrap>
        <Button type="primary" loading={loading} onClick={() => void onMatch()}>按下单时间匹配订单</Button>
        <Button loading={loading} onClick={() => void onAdjust()}>修正库存</Button>
        <Button disabled={!selectedOrders.length} onClick={() => void copyOrders()}>
          复制已选订单号（{selectedOrders.length}）
        </Button>
      </Space>
      <Card title="产品配货池">
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          {pickMatrices.map((matrix) => (
            <Card
              key={matrix.key}
              size="small"
              title={<Space wrap><OrderSpecificationImage urls={matrix.imageUrls} /><Text strong>上级 SPU {matrix.parentSpu}</Text>{matrix.productCodes.map((code) => <Tag key={code}>{code}</Tag>)}</Space>}
              extra={<Space><Text>已拿 {matrix.rows.flatMap((row) => Object.values(row.cells)).flatMap((cell) => cell.items).reduce((total, item) => total + item.pickedQuantity, 0)}</Text><Text type="success">已匹配 {matrix.rows.flatMap((row) => Object.values(row.cells)).flatMap((cell) => cell.items).reduce((total, item) => total + item.matchedQuantity, 0)}</Text><Text strong type="danger">待匹配 {matrix.rows.flatMap((row) => Object.values(row.cells)).flatMap((cell) => cell.items).reduce((total, item) => total + item.unmatchedQuantity, 0)}</Text></Space>}
            >
              <Table<PickMatrixRow>
                rowKey="key"
                loading={loading}
                dataSource={matrix.rows}
                pagination={false}
                bordered
                scroll={{ x: Math.max(1280, 180 + matrix.sizes.length * 220) }}
                columns={[
                  {
                    title: "颜色",
                    dataIndex: "color",
                    fixed: "left",
                    width: 260,
                    render: (value: string, row: PickMatrixRow) => (
                      <Space direction="vertical" size={2}>
                        <Text strong>{value}</Text>
                        <Space wrap size={[6, 2]}>
                          {matrix.sizes.map((size) => {
                            const quantity = row.cells[size]?.items.reduce((total, item) => total + item.pickedQuantity, 0) ?? 0;
                            return <Text key={size} type={quantity > 0 ? "success" : "secondary"}>{size}：{quantity}件</Text>;
                          })}
                        </Space>
                      </Space>
                    ),
                  },
                  ...matrix.sizes.map((size) => ({
                    title: size,
                    key: size,
                    width: 220,
                    render: (_: unknown, row: PickMatrixRow) => {
                      const items = Object.entries(row.cells).find(([cellSize]) => normalizeOrderSize(cellSize) === size)?.[1]?.items ?? [];
                      if (!items.length) return <Text type="secondary">-</Text>;
                      return (
                        <Space direction="vertical" size="small" style={{ width: "100%" }}>
                          <Text strong type="danger">待匹配 {items.reduce((total, item) => total + item.unmatchedQuantity, 0)} 件</Text>
                          <Text>已拿 {items.reduce((total, item) => total + item.pickedQuantity, 0)} 件 · 已匹配 {items.reduce((total, item) => total + item.matchedQuantity, 0)} 件</Text>
                          {items.map((item) => (
                            <Space key={item.id} wrap size={[4, 4]}>
                              <Tag>{item.sourceColor} / {item.sourceSize}</Tag>
                              {item.sourceSize !== item.targetSize && <Tag color="orange">{item.sourceSize} 改 {item.targetSize}</Tag>}
                              <Tag color={item.inventoryAdjusted ? "success" : "default"}>{item.inventoryAdjusted ? "库存已修正" : "库存待修正"}</Tag>
                              <Button danger type="link" size="small" onClick={() => void onDelete(item.id)}>撤销</Button>
                            </Space>
                          ))}
                        </Space>
                      );
                    },
                  })),
                ]}
              />
            </Card>
          ))}
          {!pickMatrices.length && <Text type="secondary">当前没有仍关联 ERP 新订单的配货记录。</Text>}
        </Space>
      </Card>
      <Card title="订单匹配结果">
        <Table<ZhihouAllocatedOrder>
          rowKey="orderNo"
          loading={loading}
          dataSource={orderedOrders}
          pagination={false}
          rowSelection={{
            selectedRowKeys: selectedOrders,
            getCheckboxProps: (row) => ({ disabled: !row.complete }),
            onChange: (keys) => setSelectedOrders(keys.map(String)),
          }}
          columns={[
            { title: "订单号", dataIndex: "orderNo" },
            {
              title: "货号",
              dataIndex: "productCodes",
              width: 180,
              render: (codes: string[]) => <Space wrap size={[4, 4]}>{codes.map((code) => <Tag key={code}>{code}</Tag>)}</Space>,
            },
            { title: "提交时间", dataIndex: "submittedAt", render: (value: string | null) => localDateTime(value) },
            { title: "需求", dataIndex: "requiredQuantity", width: 80 },
            { title: "已配", dataIndex: "allocatedQuantity", width: 80 },
            { title: "剩余待采购", render: (_, row) => Math.max(row.requiredQuantity - row.allocatedQuantity, 0), width: 110 },
            { title: "状态", width: 110, render: (_, row) => row.complete ? <Tag color="success">整单已配齐</Tag> : <Tag color="warning">部分配货</Tag> },
            {
              title: "配货明细",
              render: (_, row) => (
                <Space wrap>
                  {row.items.map((item, index) => (
                    <Tag key={`${item.pickItemId}-${index}`}>
                      {item.targetColor} {item.targetSize} × {item.quantity}
                      {item.sourceSize !== item.targetSize ? `（${item.sourceSize}改码）` : ""}
                    </Tag>
                  ))}
                </Space>
              ),
            },
          ]}
        />
        {!completed.length && <Text type="secondary">当前还没有整单配齐、可复制到 ERP 的订单。</Text>}
      </Card>
    </Space>
  );
}
