import type {
  ZhihouInventoryPickOption,
  ZhihouOrderMatrixCell,
} from "@temu-analytics/shared";
import { Alert, Checkbox, InputNumber, Modal, Select, Space, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";

const { Text } = Typography;

interface Props {
  cell: ZhihouOrderMatrixCell | null;
  loading: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    targetKey: string;
    inventoryCellId: number;
    quantity: number;
    saveConversion: boolean;
  }) => Promise<void>;
}

function optionLabel(option: ZhihouInventoryPickOption): string {
  const conversion = option.isExact
    ? "同规格"
    : option.isSavedConversion
      ? "已保存改码方案"
      : "改码拿货";
  return `${option.productCode} · ${option.color} · ${option.size} · 库存 ${option.quantity}（${conversion}）`;
}

export function StockPickModal({ cell, loading, onCancel, onSubmit }: Props) {
  const exact = useMemo(
    () => cell?.inventoryPickOptions.find((option) => option.isExact) ?? null,
    [cell],
  );
  const [inventoryCellId, setInventoryCellId] = useState<number | undefined>();
  const [quantity, setQuantity] = useState(0);
  const [saveConversion, setSaveConversion] = useState(false);
  const selected = cell?.inventoryPickOptions.find(
    (option) => option.inventoryCellId === inventoryCellId,
  );

  useEffect(() => {
    if (!cell) return;
    const initial = exact ?? cell.inventoryPickOptions.find((option) => option.isSavedConversion);
    setInventoryCellId(initial?.inventoryCellId);
    setQuantity(Math.min(cell.requiredQuantity - cell.pickedQuantity, initial?.quantity ?? 0));
    setSaveConversion(false);
  }, [cell, exact]);

  const changed = Boolean(selected && !selected.isExact);
  const maxQuantity = Math.min(
    selected?.quantity ?? 0,
    Math.max((cell?.requiredQuantity ?? 0) - (cell?.pickedQuantity ?? 0), 0),
  );

  return (
    <Modal
      title={cell ? `库存配货 · ${cell.color} · 订单目标 ${cell.size}` : "库存配货"}
      open={Boolean(cell)}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="确认已从库存拿出"
      okButtonProps={{ disabled: !inventoryCellId || quantity <= 0 }}
      onOk={() => cell && inventoryCellId
        ? onSubmit({ targetKey: cell.key, inventoryCellId, quantity, saveConversion })
        : undefined}
    >
      {cell && (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Text>订单需求 {cell.requiredQuantity} 件，已登记拿货 {cell.pickedQuantity} 件。</Text>
          <Select
            value={inventoryCellId}
            placeholder="选择实际从Y2拿出的规格"
            style={{ width: "100%" }}
            options={cell.inventoryPickOptions.map((option) => ({
              value: option.inventoryCellId,
              label: optionLabel(option),
            }))}
            onChange={(value) => {
              const option = cell.inventoryPickOptions.find((item) => item.inventoryCellId === value);
              setInventoryCellId(value);
              setQuantity(Math.min(
                cell.requiredQuantity - cell.pickedQuantity,
                option?.quantity ?? 0,
              ));
              setSaveConversion(false);
            }}
          />
          {changed && selected && (
            <Alert
              showIcon
              type="warning"
              message={`改码确认：实际拿 ${selected.size}，改码后用于订单 ${cell.size}`}
              description="订单匹配仍按目标尺码计算；修正库存时扣减实际拿货尺码。"
            />
          )}
          <Space>
            <Text>本次拿货</Text>
            <InputNumber
              min={1}
              max={maxQuantity}
              value={quantity}
              onChange={(value) => setQuantity(value ?? 0)}
            />
            <Text>件</Text>
          </Space>
          {changed && (
            <Checkbox checked={saveConversion} onChange={(event) => setSaveConversion(event.target.checked)}>
              保存为可选改码方案（以后仍需人工确认）
            </Checkbox>
          )}
          {!cell.inventoryPickOptions.length && (
            <Alert showIcon type="info" message="该产品当前没有可用的Y2库存规格。" />
          )}
        </Space>
      )}
    </Modal>
  );
}
