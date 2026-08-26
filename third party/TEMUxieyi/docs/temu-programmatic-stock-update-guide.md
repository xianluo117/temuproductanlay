# Temu 程序化修改库存编写指南

## 1. 文档目标

本文说明如何使用 Python、CloakBrowser 和 CDP，程序化修改 Temu 指定商品、颜色、尺码和仓库的库存。

适用范围：

- 根据 Product ID 查询完整库存。
- 根据 SKC、颜色和尺码定位 SKU。
- 修改一个或多个 SKU 的仓库库存。
- 保留商品原有仓库与站点路由。
- 在写入前执行仓库预检。
- 写入后重新查询并验证结果。
- 支持审计、幂等、并发控制和异常恢复。

本方案不操作页面输入框和按钮。浏览器只负责登录状态、Cookie、`mallid` 和动态 `Anti-Content`，库存数据通过协议接口读写。

---

## 2. 已验证结论

### 2.1 已验证接口

| 功能               | 方法 | 接口                                                                          |
| ------------------ | ---- | ----------------------------------------------------------------------------- |
| 查询库存与仓库路由 | POST | `/darwin-mms/api/kiana/ghost/btg/sales/stock/queryBtgProductRouteStock`       |
| 查询库存编辑能力   | POST | `/darwin-mms/api/kiana/ghost/btg/sales/stock/queryMmsBtgProductStockBaseInfo` |
| 仓库绑定预检       | POST | `/darwin-mms/api/kiana/ghost/btg/sales/stock/preCheckWarehouseInfo`           |
| 写入库存和路由     | POST | `/darwin-mms/api/kiana/ghost/btg/sales/stock/updateMmsProductRoute`           |

### 2.2 成功响应

接口业务成功条件：

```text
HTTP 状态 == 200
&& success == true
&& errorCode == 1000000
```

典型写入响应：

```json
{
  "result": {},
  "success": true,
  "errorCode": 1000000,
  "errorMsg": null
}
```

### 2.3 核心约束

库存写入接口不是局部补丁接口。

写入时必须提交该 Product 下全部自发货 SKU 的全部仓库库存项。只提交目标 SKU 时，接口可能返回：

```json
{
  "success": false,
  "errorCode": 2000070,
  "errorMsg": "库存设置需传入全部自发货模式SKU"
}
```

正确流程是：

```text
查询完整库存
→ 在内存中复制完整库存矩阵
→ 只修改目标项
→ 全量提交
→ 重新查询验证
```

---

## 3. 推荐工程结构

```text
temu-stock-service/
├── app/
│   ├── browser/
│   │   ├── factory.py
│   │   ├── cdp_client.py
│   │   ├── profile_manager.py
│   │   └── session_health.py
│   ├── temu/
│   │   ├── page_client.py
│   │   ├── endpoints.py
│   │   ├── errors.py
│   │   └── response_validator.py
│   ├── stock/
│   │   ├── models.py
│   │   ├── query_service.py
│   │   ├── sku_matcher.py
│   │   ├── precheck_service.py
│   │   ├── payload_builder.py
│   │   ├── update_service.py
│   │   ├── verify_service.py
│   │   └── orchestration_service.py
│   ├── accounts/
│   │   ├── account_model.py
│   │   ├── account_repository.py
│   │   └── account_locks.py
│   ├── audit/
│   │   ├── audit_model.py
│   │   └── audit_repository.py
│   └── config/
│       └── settings.py
├── scripts/
│   ├── login_account.py
│   ├── query_stock.py
│   └── update_stock.py
├── docs/
│   └── temu-programmatic-stock-update-guide.md
├── requirements.txt
└── README.md
```

模块职责：

- `page_client.py`：在页面上下文中执行统一 POST 请求。
- `query_service.py`：查询商品完整库存和路由。
- `sku_matcher.py`：根据 SKC、颜色、尺码定位唯一 SKU。
- `precheck_service.py`：执行仓库绑定预检。
- `payload_builder.py`：构造全量写入请求。
- `update_service.py`：提交库存写入。
- `verify_service.py`：写入后重新查询并核验。
- `orchestration_service.py`：编排完整事务流程。
- `account_locks.py`：阻止同账号、同 Product 并发写入。
- `audit_repository.py`：保存修改前后数据和接口结果。

---

## 4. 浏览器与登录态

### 4.1 Profile 规则

每个 Temu 账号使用固定且独立的 Profile：

```text
E:\tools\cloackBrower\profiles\temu\<account_key>
```

要求：

- 不同账号不得共享 Profile。
- 同一 Profile 同时只能由一个浏览器实例使用。
- Profile 路径创建后保持不变。
- 保持浏览器版本和指纹参数稳定。
- CDP 仅监听 `127.0.0.1`。

### 4.2 浏览器职责

浏览器负责：

- 保存 Temu 登录状态。
- 自动携带 Cookie。
- 提供 `mallid`。
- 生成动态 `Anti-Content`。
- 在 Temu 页面上下文执行请求。

业务服务负责：

- SKU 匹配。
- 全量库存矩阵构造。
- 修改校验。
- 并发锁。
- 审计记录。
- 写入后验证。

### 4.3 页面要求

请求应在 `agentseller.temu.com` 的已登录页面上下文执行。可以打开：

```text
https://agentseller.temu.com/goods/list
```

不要求停留在库存编辑页面，但页面必须加载 Temu 的请求运行环境。

---

## 5. 页面内统一请求函数

通过 CDP 执行以下 JavaScript：

```javascript
async function temuPost(path, body) {
  const mallid = document.cookie
    .split("; ")
    .find((item) => item.startsWith("mallid="))
    ?.split("=")[1];

  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mallid": mallid || ""
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    payload = { rawText: text };
  }

  return {
    httpStatus: response.status,
    ok: response.ok,
    payload
  };
}
```

规则：

- 不自行生成 `Anti-Content`。
- 不复用历史 `Anti-Content`。
- 不将完整 Cookie 写入日志。
- 不在浏览器外直接重放历史请求。
- 页面函数只负责请求，不负责业务判断。

---

## 6. 第一步：查询完整库存

### 6.1 请求

```text
POST /darwin-mms/api/kiana/ghost/btg/sales/stock/queryBtgProductRouteStock
```

请求体：

```json
{
  "productId": 3407684346
}
```

### 6.2 响应核心结构

```text
result
├── validSiteList[]
├── managedSiteIdList[]
├── routeList[]
│   ├── warehouseId
│   ├── warehouseName
│   └── siteList[]
└── productWarehouseStockList[]
    ├── productSkcId
    ├── productSkuId
    ├── mainSalePropertyList[]
    ├── secondarySalePropertyList[]
    ├── allowZero
    └── warehouseStockList[]
        ├── warehouseInfo
        ├── stockAvailable
        ├── siteList[]
        └── warehouseDisable
```

### 6.3 关键字段

| 字段                        | 用途                         |
| --------------------------- | ---------------------------- |
| `productSkcId`              | 颜色等一级销售属性组合标识   |
| `productSkuId`              | 颜色和尺码组合的最终库存标识 |
| `mainSalePropertyList`      | 通常包含颜色                 |
| `secondarySalePropertyList` | 通常包含尺码                 |
| `warehouseStockList`        | SKU 在各仓库的库存           |
| `stockAvailable`            | 当前可用库存                 |
| `routeList`                 | 当前仓库与站点绑定关系       |
| `warehouseDisable`          | 仓库是否不可用               |

查询结果必须作为本次写事务的基线。不得使用数据库中缓存的旧库存直接构造写入请求。

---

## 7. 第二步：定位目标 SKU

### 7.1 推荐匹配条件

按以下顺序筛选：

1. `productSkcId` 等于用户指定 SKC。
2. `mainSalePropertyList[].specName` 包含指定颜色。
3. `secondarySalePropertyList[].specName` 包含指定尺码。
4. 匹配结果必须只有一条。

示例：

```python
def match_sku(
    product_list: list[dict],
    skc_id: int,
    color: str,
    size: str,
) -> dict:
    matches = []

    for item in product_list:
        if int(item["productSkcId"]) != int(skc_id):
            continue

        colors = {
            prop.get("specName")
            for prop in item.get("mainSalePropertyList", [])
        }
        sizes = {
            prop.get("specName")
            for prop in item.get("secondarySalePropertyList", [])
        }

        if color in colors and size in sizes:
            matches.append(item)

    if len(matches) != 1:
        raise ValueError(
            f"SKU 匹配数量异常: expected=1 actual={len(matches)}"
        )

    return matches[0]
```

### 7.2 为什么不能只使用 SKC

一个 SKC 通常对应同一颜色下的多个尺码。库存实际按 `productSkuId + warehouseId` 修改。

例如：

```text
SKC 66175803267
├── 酒红色 S   → SKU 39694682986
├── 酒红色 M   → SKU 77133642094
├── 酒红色 L   → SKU 87898639691
├── 酒红色 XL  → SKU 77422088205
└── 酒红色 XXL → SKU 79199336071
```

因此，写入前必须取得唯一 `productSkuId`。

---

## 8. 第三步：检查库存编辑能力

### 8.1 请求

```text
POST /darwin-mms/api/kiana/ghost/btg/sales/stock/queryMmsBtgProductStockBaseInfo
```

请求体：

```json
{}
```

### 8.2 关键字段

| 字段                              | 说明                 |
| --------------------------------- | -------------------- |
| `supplierAllowDecreaseStock`      | 是否允许降低库存     |
| `mallDepositNotEnough`            | 店铺保证金是否不足   |
| `maxSkuBindWarehouseCount`        | SKU 最大绑定仓库数   |
| `limitNumberOfStockEditThreshold` | 库存编辑限制阈值     |
| `showStockForbidWriteTip`         | 是否展示禁止写入提示 |
| `stockForbidWriteTip`             | 禁止写入原因         |

当出现以下情况时停止写入：

- 需要降低库存，但 `supplierAllowDecreaseStock` 为 `false`。
- `mallDepositNotEnough` 为 `true` 且页面策略禁止写入。
- `showStockForbidWriteTip` 为 `true`。
- 目标仓库数量超过限制。

---

## 9. 第四步：仓库预检

### 9.1 请求

```text
POST /darwin-mms/api/kiana/ghost/btg/sales/stock/preCheckWarehouseInfo
```

请求体：

```json
{
  "productId": 3407684346,
  "preCheckSkuWarehouseList": [
    {
      "productSkuId": 39694682986,
      "warehouseId": "WH-00517079664773248"
    },
    {
      "productSkuId": 39694682986,
      "warehouseId": "WH-00517136230533248"
    },
    {
      "productSkuId": 39694682986,
      "warehouseId": "WH-07389066117253248"
    }
  ]
}
```

### 9.2 结果处理

通过条件：

```text
result.pass == true
```

已观察到的预检错误：

```text
code = 2000101
```

可能表示 SKU 未绑定合作仓货品。响应中还可能出现：

- `intercept`
- `message`
- `cwProviderCode`
- `cwProductSkuRelateSn`

注意：页面逻辑在部分错误下允许继续提交，即 `pass == false` 但 `intercept == false`。程序化服务应配置两种模式：

- `strict`：只有 `pass == true` 才允许写入。
- `page-compatible`：当 `intercept != true` 时允许继续，但必须记录警告。

默认使用 `strict`。只有确认业务允许时，才启用 `page-compatible`。

---

## 10. 第五步：构造全量写入请求

### 10.1 路由列表

将查询结果中的 `routeList` 转换为：

```json
[
  {
    "warehouseId": "WH-00517079664773248",
    "siteIdList": [100]
  },
  {
    "warehouseId": "WH-00517136230533248",
    "siteIdList": [100]
  }
]
```

如果本次只修改库存、不调整仓库路由：

```text
targetRouteList == currentRouteList
```

不得自行遗漏路由，否则可能产生解绑行为。

### 10.2 全量库存矩阵

遍历所有 `productWarehouseStockList` 及其 `warehouseStockList`，为每一项生成：

```json
{
  "productSkuId": 39694682986,
  "warehouseId": "WH-00517079664773248",
  "targetStockAvailable": 200,
  "currentStockAvailable": 100
}
```

规则：

- 目标 SKU 和目标仓库使用用户指定的新库存。
- 其他 SKU 和仓库的目标库存保持当前值。
- `currentStockAvailable` 始终使用本次实时查询值。
- 不提交查询结果中不存在的 SKU 或仓库。
- 不遗漏任何自发货 SKU 的仓库项。

### 10.3 Python 构造函数

```python
from collections.abc import Mapping


def build_stock_change_list(
    product_list: list[dict],
    target_sku_id: int,
    target_stocks: Mapping[str, int],
) -> list[dict]:
    changes: list[dict] = []
    matched_warehouses: set[str] = set()

    for sku in product_list:
        product_sku_id = int(sku["productSkuId"])

        for stock in sku.get("warehouseStockList", []):
            warehouse = stock.get("warehouseInfo") or {}
            warehouse_id = warehouse.get("warehouseId")

            if not warehouse_id:
                continue

            current_stock = int(stock["stockAvailable"])
            target_stock = current_stock

            if product_sku_id == int(target_sku_id):
                if warehouse_id in target_stocks:
                    target_stock = int(target_stocks[warehouse_id])
                    matched_warehouses.add(warehouse_id)

            changes.append(
                {
                    "productSkuId": product_sku_id,
                    "warehouseId": warehouse_id,
                    "targetStockAvailable": target_stock,
                    "currentStockAvailable": current_stock,
                }
            )

    missing = set(target_stocks) - matched_warehouses
    if missing:
        raise ValueError(f"目标仓库不存在: {sorted(missing)}")

    return changes
```

### 10.4 库存数值校验

写入前至少校验：

```python
def validate_stock(value: int, allow_zero: bool) -> int:
    if isinstance(value, bool):
        raise ValueError("库存不能是布尔值")

    value = int(value)

    if value < 0:
        raise ValueError("库存不能小于 0")

    if value == 0 and not allow_zero:
        raise ValueError("该 SKU 不允许设置为 0")

    return value
```

还应设置内部最大值，防止参数单位或输入错误。最大值应配置，不应硬编码到业务流程。

---

## 11. 第六步：写入库存

### 11.1 请求

```text
POST /darwin-mms/api/kiana/ghost/btg/sales/stock/updateMmsProductRoute
```

完整请求结构：

```json
{
  "targetRouteList": [
    {
      "warehouseId": "WH-00517079664773248",
      "siteIdList": [100]
    }
  ],
  "currentRouteList": [
    {
      "warehouseId": "WH-00517079664773248",
      "siteIdList": [100]
    }
  ],
  "skuStockChangeList": [
    {
      "productSkuId": 39694682986,
      "warehouseId": "WH-00517079664773248",
      "targetStockAvailable": 200,
      "currentStockAvailable": 100
    }
  ],
  "productId": 3407684346,
  "source": 0
}
```

实际请求中的 `skuStockChangeList` 必须包含完整库存矩阵，示例只展示单项结构。

### 11.2 写入判断

只有同时满足以下条件，才标记写入接口成功：

```text
HTTP 200
&& ok == true
&& payload.success == true
&& payload.errorCode == 1000000
```

写入接口成功不代表最终库存已确认。必须执行后续查询验证。

---

## 12. 第七步：写入后验证

再次调用库存查询接口，并按 `productSkuId + warehouseId` 检查最终值。

示例：

```python
def verify_target_stocks(
    product_list: list[dict],
    target_sku_id: int,
    expected: Mapping[str, int],
) -> None:
    actual: dict[str, int] = {}

    for sku in product_list:
        if int(sku["productSkuId"]) != int(target_sku_id):
            continue

        for stock in sku.get("warehouseStockList", []):
            warehouse_id = stock.get("warehouseInfo", {}).get("warehouseId")
            if warehouse_id:
                actual[warehouse_id] = int(stock["stockAvailable"])

    mismatches = {
        warehouse_id: {
            "expected": int(expected_stock),
            "actual": actual.get(warehouse_id),
        }
        for warehouse_id, expected_stock in expected.items()
        if actual.get(warehouse_id) != int(expected_stock)
    }

    if mismatches:
        raise RuntimeError(f"库存写入验证失败: {mismatches}")
```

推荐验证策略：

1. 写入成功后等待 `500` 至 `1500` 毫秒。
2. 第一次查询验证。
3. 若数据未更新，等待 `2` 秒再查询一次。
4. 最多验证三次。
5. 仍不一致时标记 `VERIFY_FAILED`，禁止直接重复写入。

---

## 13. 完整业务编排

### 13.1 输入模型

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class StockTarget:
    warehouse_id: str
    stock: int


@dataclass(frozen=True)
class StockUpdateCommand:
    account_id: str
    product_id: int
    skc_id: int
    color: str
    size: str
    targets: tuple[StockTarget, ...]
    request_key: str
```

`request_key` 用于幂等控制，调用方必须为每个业务修改请求提供唯一值。

### 13.2 编排伪代码

```python
async def update_stock(command: StockUpdateCommand) -> dict:
    async with product_write_lock(
        account_id=command.account_id,
        product_id=command.product_id,
    ):
        if await audit_repository.is_completed(command.request_key):
            return await audit_repository.get_result(command.request_key)

        before = await stock_query_service.query(command.product_id)

        sku = sku_matcher.match(
            product_list=before.product_warehouse_stock_list,
            skc_id=command.skc_id,
            color=command.color,
            size=command.size,
        )

        target_stocks = {
            target.warehouse_id: target.stock
            for target in command.targets
        }

        validate_targets(sku, target_stocks)

        capability = await stock_query_service.query_capability()
        validate_capability(capability, sku, target_stocks)

        precheck = await precheck_service.check(
            product_id=command.product_id,
            product_sku_id=sku.product_sku_id,
            warehouse_ids=target_stocks.keys(),
        )
        validate_precheck(precheck)

        request_body = payload_builder.build(
            product_id=command.product_id,
            query_result=before,
            target_sku_id=sku.product_sku_id,
            target_stocks=target_stocks,
        )

        await audit_repository.save_before(
            command=command,
            query_result=before,
            request_body=request_body,
        )

        update_result = await update_service.submit(request_body)
        validate_update_result(update_result)

        after = await verify_service.query_until_consistent(
            product_id=command.product_id,
            product_sku_id=sku.product_sku_id,
            expected_stocks=target_stocks,
        )

        await audit_repository.save_success(
            command=command,
            update_result=update_result,
            after=after,
        )

        return {
            "status": "SUCCESS",
            "productId": command.product_id,
            "productSkcId": command.skc_id,
            "productSkuId": sku.product_sku_id,
            "stocks": target_stocks,
        }
```

---

## 14. 并发控制

### 14.1 锁粒度

库存写入接口要求提交 Product 的完整库存矩阵，因此锁必须至少使用：

```text
account_id + product_id
```

不能只按 SKU 加锁。两个任务同时修改同一 Product 的不同 SKU，也可能互相覆盖。

### 14.2 正确流程

```text
获取 Product 写锁
→ 查询实时完整库存
→ 构造全量请求
→ 写入
→ 验证
→ 释放锁
```

查询基线必须发生在获取锁之后。

### 14.3 分布式锁

单进程可使用 `asyncio.Lock`。多进程或多主机应使用 Redis 锁或数据库行锁。

锁建议配置：

- 获取超时：`10` 秒。
- 默认租约：`30` 秒。
- 长任务自动续租。
- 释放锁时校验持有者令牌。

---

## 15. 幂等控制

### 15.1 请求幂等键

建议格式：

```text
account_id:product_id:business_order_id
```

数据库中为 `request_key` 建立唯一索引。

### 15.2 状态机

```text
PENDING
  └── RUNNING
        ├── SUCCESS
        ├── UPDATE_FAILED
        ├── VERIFY_FAILED
        └── UNKNOWN
```

如果接口请求超时，不能直接判断写入失败。应先重新查询库存：

- 库存已符合目标：标记 `SUCCESS`。
- 库存仍为旧值：允许重新执行完整流程。
- 部分仓库符合、部分不符合：标记 `UNKNOWN`，停止自动重试并告警。

---

## 16. 错误处理

### 16.1 HTTP 错误

| 状态          | 处理方式                           |
| ------------- | ---------------------------------- |
| `200`         | 继续校验业务响应                   |
| `400`         | 参数错误，不自动重试               |
| `401`         | 标记登录失效                       |
| `403`         | 标记签名或风控异常，停止账号写任务 |
| `429`         | 延迟任务，不立即重试               |
| `500/502/503` | 先查询最终库存，再决定是否重试     |

### 16.2 业务错误

| 错误              | 处理方式                                     |
| ----------------- | -------------------------------------------- |
| `2000070`         | 缺少自发货 SKU，重新查询并构造完整矩阵       |
| 预检 `2000101`    | SKU 未绑定合作仓，根据运行模式停止或警告继续 |
| SKU 匹配为 0 条   | 输入或商品数据不一致，停止                   |
| SKU 匹配超过 1 条 | 属性条件不唯一，停止                         |
| 目标仓库不存在    | 停止，不自动新增路由                         |
| 当前库存变化      | 重新获取锁内基线并重新构造请求               |
| 验证不一致        | 标记 `VERIFY_FAILED`，停止盲目重试           |

### 16.3 重试原则

- 查询超时：最多重试两次。
- 预检超时：最多重试两次。
- 写入超时：先查询最终库存，不直接重写。
- HTTP `403`：不自动连续重试。
- HTTP `429`：延迟到下一调度周期。
- 参数错误：不重试。
- 验证失败：人工或补偿任务处理。

---

## 17. 审计记录

每次库存修改保存：

| 字段              | 说明                |
| ----------------- | ------------------- |
| `request_key`     | 幂等键              |
| `account_id`      | 内部账号 ID         |
| `mall_id`         | Temu 店铺 ID        |
| `product_id`      | Product ID          |
| `product_skc_id`  | SKC ID              |
| `product_sku_id`  | SKU ID              |
| `color`           | 颜色                |
| `size`            | 尺码                |
| `before_stocks`   | 修改前目标 SKU 库存 |
| `target_stocks`   | 目标库存            |
| `after_stocks`    | 验证后的库存        |
| `route_snapshot`  | 仓库和站点路由快照  |
| `precheck_result` | 预检结果            |
| `update_response` | 写入响应            |
| `status`          | 最终任务状态        |
| `started_at`      | 开始时间            |
| `finished_at`     | 完成时间            |
| `operator`        | 调用方或业务操作人  |

日志和审计数据不得保存完整 Cookie 或完整 `Anti-Content`。

---

## 18. 内部 API 设计

### 18.1 查询库存

```text
GET /internal/temu/accounts/{account_id}/products/{product_id}/stocks
```

### 18.2 修改库存

```text
POST /internal/temu/accounts/{account_id}/products/{product_id}/stocks
```

请求示例：

```json
{
  "requestKey": "erp-order-20260825-001",
  "skcId": 66175803267,
  "color": "酒红色",
  "size": "S",
  "targets": [
    {
      "warehouseId": "WH-00517079664773248",
      "stock": 200
    },
    {
      "warehouseId": "WH-00517136230533248",
      "stock": 300
    },
    {
      "warehouseId": "WH-07389066117253248",
      "stock": 150
    }
  ]
}
```

响应示例：

```json
{
  "status": "SUCCESS",
  "productId": 3407684346,
  "productSkcId": 66175803267,
  "productSkuId": 39694682986,
  "stocks": {
    "WH-00517079664773248": 200,
    "WH-00517136230533248": 300,
    "WH-07389066117253248": 150
  }
}
```

内部接口必须验证账号权限和 Product 所属店铺，禁止调用方直接传入 Cookie、`mallid` 或签名。

---

## 19. 测试要求

### 19.1 单元测试

至少覆盖：

- 根据 SKC、颜色和尺码匹配唯一 SKU。
- 匹配不到 SKU。
- 匹配到多个 SKU。
- 目标仓库不存在。
- 库存为负数。
- 不允许设置零库存。
- 全量矩阵保持非目标项不变。
- 目标项正确替换。
- 路由转换正确。
- 写入响应业务失败。
- 验证结果不一致。

### 19.2 集成测试

测试流程：

1. 使用测试账号和固定 Product。
2. 查询并保存初始库存。
3. 修改一个 SKU 的一个仓库。
4. 验证库存。
5. 修改同一 SKU 的三个仓库。
6. 验证库存。
7. 恢复初始库存。
8. 再次验证。

### 19.3 并发测试

对同一 Product 同时发起两个修改任务，确认：

- 第二个任务等待 Product 锁。
- 第二个任务在获得锁后重新查询库存。
- 不出现非目标 SKU 库存回滚。
- 审计记录顺序正确。

### 19.4 故障测试

模拟：

- CDP 断开。
- 登录失效。
- 写入接口超时。
- HTTP `403`。
- HTTP `429`。
- 写入成功但响应丢失。
- 验证接口短暂返回旧值。

---

## 20. 验收条件

程序化库存服务上线前必须满足：

- [ ] 能稳定查询 Product 的完整 SKU 和仓库库存。
- [ ] 能根据 SKC、颜色、尺码定位唯一 SKU。
- [ ] 能保留完整仓库与站点路由。
- [ ] 能提交全部自发货 SKU 的库存矩阵。
- [ ] 非目标库存项保持不变。
- [ ] 写入后可以查询验证最终结果。
- [ ] 同 Product 并发写入被串行化。
- [ ] 相同幂等键不会重复修改。
- [ ] 写入超时后先查询状态，不盲目重试。
- [ ] 登录失效和 HTTP `403` 能自动停止写任务。
- [ ] 审计记录包含修改前、目标值和修改后库存。
- [ ] 日志不包含 Cookie 和完整签名。
- [ ] 连续执行至少 `20` 次测试修改无非目标库存变化。

---

## 21. 实施顺序

### 阶段一：最小闭环

- [ ] 实现 CloakBrowser 固定 Profile 启动。
- [ ] 实现 CDP 页面连接。
- [ ] 实现统一页面内 POST 请求。
- [ ] 实现库存查询。
- [ ] 实现 SKU 匹配。
- [ ] 实现全量请求构造。
- [ ] 实现库存写入和验证。

### 阶段二：工程安全

- [ ] 增加 Product 级写锁。
- [ ] 增加幂等键。
- [ ] 增加输入校验。
- [ ] 增加预检模式配置。
- [ ] 增加写入超时恢复。
- [ ] 增加完整审计记录。

### 阶段三：服务化

- [ ] 增加 FastAPI 内部接口。
- [ ] 增加账号权限校验。
- [ ] 增加多账号 Profile 管理。
- [ ] 增加任务队列和限流。
- [ ] 增加监控和告警。

### 阶段四：生产验证

- [ ] 执行单仓库存修改测试。
- [ ] 执行多仓库存修改测试。
- [ ] 执行恢复库存测试。
- [ ] 执行并发和故障测试。
- [ ] 连续运行并检查审计数据。

---

## 22. 最终建议

采用以下固定写入模式：

```text
Product 级加锁
→ 查询实时完整库存和路由
→ 精确匹配 SKU
→ 校验编辑能力
→ 执行仓库预检
→ 复制完整库存矩阵
→ 只替换目标项
→ 全量提交
→ 查询验证
→ 保存审计
→ 释放锁
```

关键原则：

1. 不使用缓存库存构造写请求。
2. 不只提交目标 SKU。
3. 不遗漏 Product 下其他自发货 SKU。
4. 不随意修改或遗漏仓库路由。
5. 不按 SKU 加锁，必须按 Product 加锁。
6. 不在写入超时后直接重复提交。
7. 不将接口成功响应等同于最终库存验证成功。
8. 不自行维护 `Anti-Content` 算法。
9. 所有协议请求在已登录浏览器页面上下文中完成。
10. 所有库存变更必须可追踪、可验证、可审计。
