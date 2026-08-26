# Temu 上新生命周期数据查询方案

## 1. 方案目标

建立可长期运行的 Temu 上新生命周期数据查询服务，实现以下能力：

- 复用账号已有登录状态，无需每次人工登录。
- 通过 Temu 页面运行环境生成动态请求签名。
- 查询商品、SKC、SKU 的当前生命周期状态和关键时间节点。
- 查询状态聚合、快速筛选数量和待办数量。
- 支持分页、商品 ID 筛选、状态筛选、定时同步和历史变更追踪。
- 支持多账号独立 Profile、独立任务和独立数据存储。
- 登录失效、请求受限、接口变化或数据异常时自动识别并告警。

本方案不抓取页面 DOM。CloakBrowser 仅作为登录态和动态签名容器，业务数据通过协议接口获取。

---

## 2. 已验证结论

### 2.1 页面与接口

已验证页面：

```text
https://agentseller.temu.com/newon/product-select
```

页面标题：

```text
上新生命周期管理
```

已验证接口：

| 功能           | 方法 | 接口                                                 |
| -------------- | ---- | ---------------------------------------------------- |
| 生命周期主列表 | POST | `/api/kiana/mms/robin/searchForSemiSupplier`         |
| 快速筛选数量   | POST | `/api/kiana/mms/robin/querySupplierQuickFilterCount` |
| 待办数量       | POST | `/api/kiana/mms/robin/querySupplierTodoCount`        |

三个接口均已在登录页面上下文中返回：

```json
{
  "success": true,
  "errorCode": 1000000,
  "errorMsg": null,
  "result": {}
}
```

### 2.2 主列表验证结果

最小请求体：

```json
{
  "pageSize": 20,
  "pageNum": 1
}
```

已验证结果：

- HTTP 状态为 `200`。
- `success` 为 `true`。
- `errorCode` 为 `1000000`。
- 返回分页总数、状态聚合和商品列表。
- 商品列表包含 SPU、SKC、SKU、生命周期状态和关键时间。

主响应结构：

```text
result
├── total
├── productIdNoStatusTotal
├── productSkcStatusAggregation[]
└── dataList[]
    ├── SPU / 商品信息
    ├── skcList[]
    │   ├── SKC 状态
    │   ├── statusTime
    │   ├── qcInfo
    │   └── skuList[]
    └── 站点、价格、流量、处罚等扩展信息
```

### 2.3 鉴权与签名约束

接口请求依赖：

- Temu 账号登录 Cookie。
- 店铺标识 `mallid`。
- 当前页面运行环境。
- 动态请求头 `Anti-Content`。
- 浏览器 UA、Client Hints、指纹和会话状态。

生产环境不得只保存 Cookie 后使用普通 HTTP 客户端请求。历史 `Anti-Content` 不适合长期复用，应在已登录 Temu 页面上下文内发起请求，让页面请求层生成有效签名。

---

## 3. 总体架构

```text
任务调度器
    │
    ▼
账号路由与任务锁
    │
    ▼
CloakBrowser 持久化实例
    │
    ├── 独立 Profile
    ├── 登录 Cookie
    ├── mallid
    └── Anti-Content 动态生成
    │
    ▼
页面内协议查询器
    │
    ├── 生命周期主列表
    ├── 状态聚合
    ├── 快速筛选数量
    └── 待办数量
    │
    ▼
响应校验与标准化
    │
    ├── 原始响应归档
    ├── 商品快照
    ├── SKC 快照
    ├── SKU 快照
    └── 生命周期事件
    │
    ▼
PostgreSQL / JSON / 内部 API
```

### 3.1 模块划分

建议项目按职责拆分：

```text
temu-lifecycle-query/
├── app/
│   ├── browser/
│   │   ├── factory.py
│   │   ├── profile_manager.py
│   │   ├── cdp_client.py
│   │   └── session_health.py
│   ├── temu/
│   │   ├── api_client.py
│   │   ├── endpoints.py
│   │   ├── request_models.py
│   │   ├── response_models.py
│   │   └── error_codes.py
│   ├── lifecycle/
│   │   ├── query_service.py
│   │   ├── pagination_service.py
│   │   ├── normalization_service.py
│   │   ├── event_service.py
│   │   ├── status_mapping.py
│   │   └── sync_service.py
│   ├── accounts/
│   │   ├── account_model.py
│   │   ├── account_repository.py
│   │   └── account_router.py
│   ├── storage/
│   │   ├── database.py
│   │   ├── raw_repository.py
│   │   ├── product_repository.py
│   │   ├── skc_repository.py
│   │   ├── sku_repository.py
│   │   └── lifecycle_event_repository.py
│   ├── scheduler/
│   │   ├── scheduler.py
│   │   ├── jobs.py
│   │   └── locks.py
│   ├── monitoring/
│   │   ├── logger.py
│   │   ├── metrics.py
│   │   └── alerts.py
│   └── config/
│       ├── settings.py
│       └── account_settings.py
├── scripts/
│   ├── login_account.py
│   ├── check_session.py
│   ├── query_once.py
│   └── backfill_lifecycle.py
├── data/
│   └── exports/
├── docs/
│   └── temu-lifecycle-query-plan.md
├── requirements.txt
└── README.md
```

---

## 4. 浏览器运行方案

### 4.1 Profile 规则

每个 Temu 账号绑定独立且固定的 Profile：

```text
E:\tools\cloackBrower\profiles\temu\<account_key>
```

规则：

- 一个账号不得与其他账号共用 Profile。
- Profile 保存 Cookie、localStorage、IndexedDB 和登录状态。
- Profile 路径创建后保持不变。
- 同一账号保持稳定浏览器版本和指纹参数。
- 同一 Profile 同一时间只能由一个浏览器实例占用。
- CDP 仅监听 `127.0.0.1`。

### 4.2 浏览器职责

浏览器负责：

- 保存并恢复账号登录态。
- 加载 Temu 页面及请求运行环境。
- 自动携带当前域名 Cookie。
- 生成动态 `Anti-Content`。
- 在页面上下文执行协议请求。

浏览器不负责：

- 解析页面表格。
- 点击分页按钮。
- 数据标准化和持久化。
- 生命周期变更判断。
- 多账号调度。

### 4.3 页面初始化

推荐初始化流程：

1. 根据账号配置定位 Profile。
2. 启动或连接 CloakBrowser。
3. 打开生命周期页面。
4. 等待页面核心脚本加载完成。
5. 检查是否跳转至登录页面。
6. 读取并核对 `mallid`。
7. 调用待办数量接口执行轻量健康检查。
8. 健康检查通过后执行主列表同步。

---

## 5. 页面内统一请求

通过 CDP 在当前 Temu 页面上下文执行：

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

请求规则：

- 不手工生成 `Anti-Content`。
- 不复用历史 `Anti-Content`。
- 不在日志中输出 Cookie 或完整签名。
- 每次请求同时校验 HTTP 状态和业务状态。
- 请求超时、解析失败和结构缺失必须保存错误上下文。

成功条件：

```text
httpStatus == 200
&& payload.success == true
&& payload.errorCode == 1000000
```

---

## 6. 生命周期主列表查询

### 6.1 接口

```text
POST /api/kiana/mms/robin/searchForSemiSupplier
```

### 6.2 最小请求

```json
{
  "pageSize": 50,
  "pageNum": 1
}
```

初期建议 `pageSize` 使用 `20` 或 `50`。不应在未验证稳定性前使用过大的分页值。

### 6.3 分页流程

1. 请求第一页。
2. 校验 `result.dataList` 为数组。
3. 读取 `result.total`。
4. 根据 `pageSize` 计算总页数。
5. 串行请求剩余页。
6. 每页保存原始响应。
7. 标准化 SPU、SKC 和 SKU 数据。
8. 校验累计商品数与 `total` 的关系。
9. 完成全部分页后提交本次同步批次。

分页总数计算：

```python
page_count = (total + page_size - 1) // page_size
```

注意：一个 SPU 可以包含多个 SKC，一个 SKC 可以包含多个 SKU。`result.total` 表示主列表记录总数，不应直接与 SKU 行数比较。

### 6.4 ID 查询

按 SPU 查询：

```json
{
  "pageSize": 20,
  "pageNum": 1,
  "productSpuIdList": [8334587398]
}
```

按 SKC 查询：

```json
{
  "pageSize": 20,
  "pageNum": 1,
  "productSkcIdList": [11766716309]
}
```

按 SKU 查询：

```json
{
  "pageSize": 20,
  "pageNum": 1,
  "productSkuIdList": [67981112886]
}
```

前端对 ID 数量存在限制。工程实现应限制：

- 单次 SPU ID 不超过 `500`。
- 单次 SKC ID 不超过 `500`。
- 单次 SKU ID 不超过 `500`。
- 超出限制时自动分批请求。

### 6.5 状态和业务筛选

已识别的筛选参数：

| 参数                        | 说明               |
| --------------------------- | ------------------ |
| `secondarySelectStatusList` | 生命周期主状态列表 |
| `priceReviewStatusList`     | 核价状态列表       |
| `sampleQcOrderStatusList`   | 样品质检状态列表   |
| `supplierTodoTypeList`      | 供应商待办类型列表 |
| `productSpuIdList`          | SPU ID 列表        |
| `productSkcIdList`          | SKC ID 列表        |
| `productSkuIdList`          | SKU ID 列表        |
| `reSampleTimesBegin`        | 重寄样次数下限     |
| `reSampleTimesEnd`          | 重寄样次数上限     |

状态筛选示例：

```json
{
  "pageSize": 50,
  "pageNum": 1,
  "secondarySelectStatusList": [9]
}
```

状态数字与页面中文文案的映射必须单独维护。未验证的状态值不得根据名称猜测。

### 6.6 重寄样次数筛选

区间筛选：

```json
{
  "pageSize": 50,
  "pageNum": 1,
  "reSampleTimesBegin": 1,
  "reSampleTimesEnd": 3
}
```

仅设置单侧条件时，只发送对应的开始值或结束值，不发送页面表单内部使用的 `reSampleTimes` 对象。

---

## 7. 辅助接口

### 7.1 快速筛选数量

接口：

```text
POST /api/kiana/mms/robin/querySupplierQuickFilterCount
```

请求体：

```json
{}
```

核心响应：

```text
result.countList[]
├── type
└── count
```

用途：

- 展示各快速筛选项数量。
- 同步前执行轻量会话检查。
- 监测特定业务状态是否出现待处理数据。
- 发现数量异常变化时触发主列表增量同步。

### 7.2 待办数量

接口：

```text
POST /api/kiana/mms/robin/querySupplierTodoCount
```

请求体：

```json
{}
```

核心响应：

```text
result
├── total
└── todoStatusAggregationList[]
    ├── selectStatus
    └── count
```

用途：

- 获取全部待办数量。
- 获取各待办状态数量。
- 调度待办商品专项同步。
- 作为账号会话健康检查接口。

### 7.3 调用顺序

推荐每次同步按以下顺序执行：

1. 查询待办数量。
2. 查询快速筛选数量。
3. 查询主列表第一页。
4. 获取总数和状态聚合。
5. 完成主列表分页。
6. 保存状态快照。
7. 与上一批次比较并生成生命周期事件。

---

## 8. 生命周期字段

### 8.1 商品级字段

建议保存：

- `productId`
- `productName`
- `supplierId`
- `supplierName`
- `goodsId`
- `productCreatedAt`
- `productUpdatedAt`
- `activateAt`
- `activateTime`
- `leafCategoryId`
- `leafCategoryName`
- `fullCategoryName`
- `siteName`
- `siteInfoList`
- `goodsInfoStatus`
- `hasSkcSelected`
- `sampleNeeded`
- `removeStatus`
- `isSemiHostedProduct`
- `supplierPrice`
- `supplierPriceCurrencyType`

### 8.2 SKC 级字段

建议保存：

- `skcId`
- `goodsSkcId`
- `selectId`
- `selectStatus`
- `approveStatus`
- `sampleQcOrderStatus`
- `sampleQcType`
- `sampleType`
- `reSampleTimes`
- `latestPriceComparingStatus`
- `firstPurchaseSubmitAt`
- `addedSiteList`
- `goodsSkcStatus`
- `canOnSale`
- `canOffSale`
- `supplierPrice`
- `supplierPriceCurrencyType`
- `extCode`
- `buyerUid`
- `buyerName`
- `statusTime`
- `qcInfo`

### 8.3 SKU 级字段

建议保存：

- `skuId`
- `goodsSkuId`
- `selectStatus`
- `priceReviewStatus`
- `supplierPrice`
- `supplierPriceValue`
- `lowestSupplierPrice`
- `referencePrice`
- `referencePriceValue`
- `referencePriceList`
- `stock`
- `extCode`
- `productPropertyList`
- `addSiteList`
- `siteSupplierPriceList`
- `punishInfoList`

### 8.4 生命周期时间字段

`skcList[].statusTime` 已确认包含：

| 字段                        | 说明                   |
| --------------------------- | ---------------------- |
| `createdTime`               | 生命周期记录创建时间   |
| `selectedTime`              | 被选中时间             |
| `samplePostTime`            | 寄样时间               |
| `samplePostingFinishedTime` | 寄样流程完成时间       |
| `qcCompletedTime`           | 质检完成时间           |
| `priceVerificationTime`     | 核价时间               |
| `firstPurchaseTime`         | 首单时间               |
| `addedToSiteTime`           | 加站或上站时间         |
| `unPublishedTime`           | 下架或停止发布相关时间 |
| `terminatedTime`            | 生命周期终止时间       |

所有时间戳按毫秒处理，并同时保留：

- 原始毫秒时间戳。
- UTC 时间。
- `Asia/Shanghai` 本地时间。

不得只保存格式化字符串。

---

## 9. 数据模型

### 9.1 同步批次表

表名建议：`temu_lifecycle_sync_batch`

| 字段             | 说明                              |
| ---------------- | --------------------------------- |
| `batch_id`       | 同步批次 ID                       |
| `account_id`     | 内部账号 ID                       |
| `mall_id`        | Temu 店铺 ID                      |
| `started_at`     | 开始时间                          |
| `finished_at`    | 完成时间                          |
| `status`         | running、success、partial、failed |
| `expected_total` | 接口返回总数                      |
| `received_total` | 实际接收 SPU 数量                 |
| `page_size`      | 分页大小                          |
| `page_count`     | 完成页数                          |
| `error_summary`  | 错误摘要                          |

### 9.2 商品快照表

表名建议：`temu_lifecycle_product_snapshot`

唯一键：

```text
batch_id + account_id + product_id
```

业务查询索引：

```text
account_id + product_id + captured_at
```

保存商品基础信息、站点、类目、商品状态和原始响应引用。

### 9.3 SKC 快照表

表名建议：`temu_lifecycle_skc_snapshot`

唯一键：

```text
batch_id + account_id + product_id + skc_id
```

保存：

- 当前 `selectStatus`。
- 质检状态。
- 核价状态。
- 寄样次数。
- 生命周期时间节点。
- 买手信息。
- 价格和站点状态。

### 9.4 SKU 快照表

表名建议：`temu_lifecycle_sku_snapshot`

唯一键：

```text
batch_id + account_id + product_id + skc_id + sku_id
```

保存 SKU 状态、价格、库存、规格、站点和处罚信息。

### 9.5 当前状态表

表名建议：`temu_lifecycle_current_state`

唯一键：

```text
account_id + product_id + skc_id
```

该表只保存每个 SKC 的最新状态，用于快速查询和变更比较：

- 当前生命周期状态。
- 当前质检状态。
- 当前核价状态。
- 当前待办类型。
- 最近状态变化时间。
- 最近同步批次。

### 9.6 生命周期事件表

表名建议：`temu_lifecycle_event`

唯一键：

```text
account_id + product_id + skc_id + event_type + event_time
```

主要字段：

| 字段          | 说明         |
| ------------- | ------------ |
| `event_id`    | 内部事件 ID  |
| `account_id`  | 账号 ID      |
| `product_id`  | SPU ID       |
| `skc_id`      | SKC ID       |
| `sku_id`      | 可选 SKU ID  |
| `event_type`  | 事件类型     |
| `from_status` | 变化前状态   |
| `to_status`   | 变化后状态   |
| `event_time`  | 业务事件时间 |
| `detected_at` | 系统发现时间 |
| `batch_id`    | 来源同步批次 |
| `payload`     | 变化字段摘要 |

事件类型建议：

```text
PRODUCT_DISCOVERED
STATUS_CHANGED
SAMPLE_POSTED
QC_COMPLETED
PRICE_VERIFIED
FIRST_PURCHASED
ADDED_TO_SITE
UNPUBLISHED
TERMINATED
TODO_APPEARED
TODO_CLEARED
```

### 9.7 状态聚合表

表名建议：`temu_lifecycle_status_aggregation`

唯一键：

```text
batch_id + account_id + aggregation_type + status_code
```

保存主列表状态聚合、快速筛选聚合和待办聚合，便于监控数量变化。

### 9.8 原始响应表

表名建议：`temu_raw_response`

保存：

- 请求接口。
- 请求体。
- HTTP 状态。
- Temu 错误码。
- 原始响应 JSON。
- 请求耗时。
- 账号和批次 ID。
- 请求时间。

原始响应建议压缩存储并设置保留周期。生命周期事件和标准化快照长期保留。

---

## 10. 生命周期事件生成

### 10.1 生成方式

Temu 接口返回的是当前状态和部分业务时间，不一定直接返回完整事件流。因此系统需要同时使用两种方式生成事件：

1. 根据 `statusTime` 中已出现的业务时间生成确定事件。
2. 将本批次当前状态与上一批次状态比较，生成状态变化事件。

### 10.2 时间字段事件

当以下字段首次从空值变为有效时间时生成事件：

| 字段                    | 事件                        |
| ----------------------- | --------------------------- |
| `selectedTime`          | `STATUS_CHANGED` 或选品事件 |
| `samplePostTime`        | `SAMPLE_POSTED`             |
| `qcCompletedTime`       | `QC_COMPLETED`              |
| `priceVerificationTime` | `PRICE_VERIFIED`            |
| `firstPurchaseTime`     | `FIRST_PURCHASED`           |
| `addedToSiteTime`       | `ADDED_TO_SITE`             |
| `unPublishedTime`       | `UNPUBLISHED`               |
| `terminatedTime`        | `TERMINATED`                |

### 10.3 状态变化事件

比较字段：

- `selectStatus`
- `sampleQcOrderStatus`
- `latestPriceComparingStatus`
- `goodsSkcStatus`
- `priceReviewStatus`
- 待办状态

仅在新旧值不同时写入事件。重复同步不得生成重复事件。

### 10.4 事件幂等

建议使用以下幂等摘要：

```text
SHA256(account_id + product_id + skc_id + event_type + event_time + to_status)
```

没有明确业务时间的状态变化，使用当前同步发现时间，并结合来源批次和前后状态去重。

---

## 11. 同步策略

### 11.1 全量同步

用途：

- 初次接入账号。
- 每日基线同步。
- 数据修复。
- 接口或状态映射变更后重新处理。

流程：

1. 查询辅助接口。
2. 查询主列表全部分页。
3. 保存原始响应。
4. 保存商品、SKC、SKU 快照。
5. 更新当前状态表。
6. 生成生命周期事件。
7. 校验同步完整性。

推荐频率：每日一次。

### 11.2 增量同步

由于当前接口未确认支持可靠的更新时间游标，增量同步采用状态筛选和重点对象查询：

- 查询待办状态商品。
- 查询快速筛选数量发生变化的分类。
- 查询近期处于关键生命周期阶段的商品。
- 查询内部业务指定的 SPU、SKC 或 SKU。
- 定期执行一次全量同步修正遗漏。

推荐频率：每 `15` 至 `30` 分钟。

### 11.3 重点商品同步

对以下商品提高查询频率：

- 新发现商品。
- 等待寄样或质检商品。
- 等待核价商品。
- 已出现待办商品。
- 最近 24 小时发生状态变化的商品。

重点商品可每 `5` 至 `10` 分钟按 ID 分批查询。

### 11.4 请求频率

建议：

- 单账号请求串行。
- 分页请求间隔 `300` 至 `1000` 毫秒。
- 增加少量随机抖动。
- 多账号任务错峰。
- HTTP `403` 或 `429` 时立即停止该账号当前任务。
- 不进行高并发全量分页。

---

## 12. 完整性校验

每个成功批次必须校验：

- 第一页和后续页均为业务成功。
- `result.total` 存在且为非负整数。
- `result.dataList` 为数组。
- 累计 SPU 数量符合分页预期。
- 同一批次不存在重复 `productId`，或重复原因已记录。
- 每个 SKC 可关联到所属商品。
- 每个 SKU 可关联到所属 SKC。
- 关键状态字段类型符合预期。
- 时间戳为合理的毫秒值。
- `mallid` 与账号配置一致。

以下情况将批次标记为 `partial`：

- 部分页请求失败。
- 累计数量明显小于 `total`。
- 响应结构变化导致部分字段无法解析。
- 同步期间登录状态失效。

`partial` 批次可以保存原始响应，但不得覆盖完整的当前状态基线。

---

## 13. 会话健康检查

每次任务开始前检查：

- CloakBrowser 进程是否存活。
- CDP 是否可连接。
- 生命周期页面是否存在。
- 页面是否跳转到登录或验证页面。
- `mallid` 是否存在并匹配账号配置。
- 待办数量接口是否返回 HTTP `200`。
- `success` 是否为 `true`。
- `errorCode` 是否为 `1000000`。

登录失效后：

1. 停止账号全部查询任务。
2. 标记账号为 `LOGIN_REQUIRED`。
3. 保留 Profile，不删除 Cookie。
4. 启动可视浏览器供人工重新登录。
5. 登录完成后重新执行健康检查。
6. 检查通过后恢复任务。

---

## 14. 错误处理

### 14.1 HTTP 错误

| 状态          | 处理方式                           |
| ------------- | ---------------------------------- |
| `200`         | 继续校验业务响应                   |
| `400`         | 记录参数并停止当前接口，不自动重试 |
| `401`         | 标记登录失效                       |
| `403`         | 标记签名或风控异常，停止账号任务   |
| `429`         | 延迟任务，禁止立即重试             |
| `500/502/503` | 指数退避，最多重试两次             |

### 14.2 结构错误

出现以下情况时保存完整原始响应并告警：

- 缺少 `result`。
- 缺少 `dataList`。
- `dataList` 不再是数组。
- 缺少 `total`。
- `skcList` 或 `skuList` 类型变化。
- 关键状态字段改名或类型变化。
- 时间戳由毫秒改为其他格式。

响应模型应采用宽松解析：未知字段保留，非关键字段缺失不立即中断整个批次。

### 14.3 重试规则

- 网络超时：最多重试两次。
- HTTP 5xx：最多重试两次。
- HTTP 403：不连续重试。
- HTTP 429：延迟到下一调度周期。
- 登录失效：不重试业务接口。
- 请求参数错误：不重试。
- 重试间隔建议为 `2` 秒、`5` 秒。

---

## 15. 状态映射管理

### 15.1 管理原则

生命周期状态码应集中配置，禁止散落在页面处理和数据库代码中。

建议结构：

```python
LIFECYCLE_STATUS = {
    # 仅添加已通过页面和接口共同验证的映射
}
```

### 15.2 验证流程

1. 在页面选择单一状态标签。
2. 捕获对应 `secondarySelectStatusList`。
3. 记录状态码、中文文案和页面位置。
4. 使用该状态码调用主列表接口。
5. 核对返回商品与页面结果。
6. 更新状态映射配置。
7. 增加接口回归测试。

### 15.3 未知状态

接口出现未知状态码时：

- 原样保存数值。
- 中文名称使用 `UNKNOWN_<code>`。
- 生成结构变化告警。
- 不阻塞其他已知状态数据入库。

---

## 16. 内部查询 API

建议向内部系统提供：

```text
GET  /internal/temu/accounts/{account_id}/lifecycle/products
GET  /internal/temu/accounts/{account_id}/lifecycle/products/{product_id}
GET  /internal/temu/accounts/{account_id}/lifecycle/skcs/{skc_id}
GET  /internal/temu/accounts/{account_id}/lifecycle/events
GET  /internal/temu/accounts/{account_id}/lifecycle/aggregations
GET  /internal/temu/accounts/{account_id}/lifecycle/todos
POST /internal/temu/accounts/{account_id}/lifecycle/sync
GET  /internal/temu/accounts/{account_id}/session/status
```

查询条件建议支持：

- SPU ID。
- SKC ID。
- SKU ID。
- 生命周期状态。
- 质检状态。
- 核价状态。
- 待办类型。
- 类目。
- 站点。
- 商品创建时间。
- 状态变化时间。
- 是否存在未处理待办。
- 分页和排序。

内部 API 不返回 Cookie、Profile 路径或签名信息。

---

## 17. 多账号运行

隔离规则：

- 一个账号一个 Profile。
- 一个账号一个浏览器上下文。
- 一个账号一个 CDP 端口。
- 一个账号同一时间只允许一个写同步任务。
- Cookie、Profile、日志和数据库记录按账号隔离。
- 单账号故障不得阻塞其他账号。

账号运行状态：

```text
STOPPED
  └── STARTING
        ├── READY
        │     ├── QUERYING
        │     └── IDLE
        ├── LOGIN_REQUIRED
        ├── RISK_BLOCKED
        └── ERROR
```

多账号并发建议从 `2` 开始，根据主机资源和接口稳定性逐步调整。

---

## 18. 监控与告警

### 18.1 监控指标

- 每账号浏览器存活状态。
- CDP 连接状态。
- 登录有效状态。
- 每接口成功率和耗时。
- HTTP `403`、`429` 和 `5xx` 数量。
- 每次批次预期总数和接收总数。
- 分页完成率。
- 商品、SKC、SKU 数量。
- 各生命周期状态数量。
- 待办总数和分类数量。
- 每小时生命周期事件数量。
- 最近一次全量同步成功时间。
- 最近一次增量同步成功时间。
- 未知状态码数量。
- 响应结构变化次数。

### 18.2 告警条件

- 连续两次同步失败。
- 登录失效。
- 出现 HTTP `403`。
- HTTP `429` 持续出现。
- 商品总数突然变为 `0`。
- 商品总数较历史出现异常波动。
- 某状态数量异常暴增或归零。
- 待办数量持续增长。
- 批次为 `partial`。
- 响应缺少关键字段。
- 出现未知生命周期状态码。
- 定时任务超过预期时长。

---

## 19. 安全要求

- Profile 目录仅允许服务账号访问。
- 配置文件不保存明文 Cookie。
- 日志不输出 Cookie。
- 不持久化完整 `Anti-Content`。
- 调试签名时仅记录哈希或前后少量字符。
- CDP 仅监听 `127.0.0.1`。
- 不将浏览器调试端口暴露到公网。
- 内部 API 必须增加身份认证和权限控制。
- 导出文件按账号和日期隔离。
- 原始响应设置访问权限和清理周期。

---

## 20. 部署方案

### 20.1 单机部署

适合 `1` 至 `5` 个账号：

```text
Windows 主机
├── Python 查询服务
├── CloakBrowser 实例
├── 调度器
├── FastAPI 内部接口
└── PostgreSQL / SQLite
```

开发阶段可使用 SQLite，正式长期运行建议使用 PostgreSQL。

### 20.2 服务拆分

建议按以下进程职责拆分：

- `browser-worker`：管理浏览器、Profile 和页面内请求。
- `lifecycle-worker`：分页、标准化和事件生成。
- `scheduler`：生成全量、增量和健康检查任务。
- `query-api`：向内部系统提供查询接口。
- `storage-worker`：批量写入快照、事件和原始响应。

初期可以运行在一个 Python 进程中，但代码模块应保持独立。

### 20.3 推荐技术选型

| 模块         | 推荐方案                           |
| ------------ | ---------------------------------- |
| 编程语言     | Python 3.12                        |
| 浏览器       | CloakBrowser                       |
| 自动化接口   | Playwright / CDP                   |
| HTTP 服务    | FastAPI                            |
| 数据模型     | Pydantic                           |
| ORM          | SQLAlchemy                         |
| 数据库       | PostgreSQL                         |
| 调度         | APScheduler；规模扩大后使用 Celery |
| 缓存和任务锁 | Redis，可按规模引入                |
| 日志         | Python logging 或 structlog        |
| 指标         | Prometheus 格式或内部监控系统      |

---

## 21. 实施阶段

### 阶段一：单账号查询闭环

- [ ] 创建项目目录和配置模块。
- [ ] 实现固定 Profile 启动和 CDP 连接。
- [ ] 实现生命周期页面初始化。
- [ ] 实现页面内统一 POST 请求。
- [ ] 实现待办和快速筛选数量查询。
- [ ] 实现主列表最小请求和分页。
- [ ] 将结果保存为 JSON。
- [ ] 实现登录失效识别。

验收条件：

- 同一账号连续执行 `20` 次查询成功。
- 接口总数与页面显示基本一致。
- 查询过程不操作页面表格和分页按钮。
- 浏览器重启后能够复用登录状态。

### 阶段二：标准化和持久化

- [ ] 建立同步批次表。
- [ ] 建立商品、SKC 和 SKU 快照表。
- [ ] 建立当前状态表。
- [ ] 建立生命周期事件表。
- [ ] 建立状态聚合和原始响应表。
- [ ] 实现分页完整性校验。
- [ ] 实现幂等写入。

验收条件：

- 同一批次重复处理不会产生重复快照和事件。
- 商品、SKC 和 SKU 关联关系正确。
- 原始响应可以重新生成标准化数据。
- `partial` 批次不会覆盖完整当前状态。

### 阶段三：状态映射和事件生成

- [ ] 验证页面状态文案与状态码映射。
- [ ] 实现 `statusTime` 事件生成。
- [ ] 实现新旧快照比较。
- [ ] 实现待办出现和清除事件。
- [ ] 实现未知状态处理。
- [ ] 增加状态变化回归测试。

验收条件：

- 已验证状态能够显示正确中文名称。
- 状态变化只生成一次事件。
- 时间字段首次出现时生成对应事件。
- 未知状态不会导致同步失败。

### 阶段四：调度和监控

- [ ] 增加全量同步任务。
- [ ] 增加增量和重点商品同步任务。
- [ ] 增加账号级任务锁。
- [ ] 增加重试和退避策略。
- [ ] 增加日志、指标和告警。
- [ ] 增加会话健康检查。

验收条件：

- 服务持续运行 `7` 天。
- 登录失效能够在一个检查周期内发现。
- HTTP `403` 和 `429` 不触发密集重试。
- 全量和增量任务不会并发写同一账号。

### 阶段五：多账号和内部 API

- [ ] 增加多账号 Profile 管理。
- [ ] 增加浏览器实例池。
- [ ] 增加账号路由和并发限制。
- [ ] 增加内部查询 API。
- [ ] 增加账号级数据权限。
- [ ] 增加 JSON 和 CSV 导出。

验收条件：

- 账号间 Cookie、Profile 和数据完全隔离。
- 单账号故障不影响其他账号。
- 内部 API 可按商品、状态和事件时间查询。
- 多账号并发数量可配置。

---

## 22. 风险与应对

### 22.1 接口和字段变化

风险：接口路径、请求参数或响应字段发生变化。

应对：

- 集中维护接口路径。
- 保存原始响应。
- 使用宽松响应模型。
- 对关键字段增加结构监控。
- 建立接口回归测试。

### 22.2 动态签名变化

风险：Temu 修改 `Anti-Content` 生成或注入机制。

应对：

- 始终在真实页面上下文请求。
- 不自行维护签名算法。
- 保持浏览器版本和 Profile 稳定。
- 出现 HTTP `403` 时停止任务并分析。

### 22.3 状态映射变化

风险：状态码新增、复用或页面文案变化。

应对：

- 原样保存状态码。
- 状态映射独立配置。
- 未知状态触发告警但不中断同步。
- 定期通过页面筛选重新验证映射。

### 22.4 当前状态无法还原完整历史

风险：首次接入时只能获得当前状态和接口保留的时间节点，无法还原接口未提供的历史变化。

应对：

- 明确区分业务事件时间和系统发现时间。
- 首次同步保存完整基线。
- 后续通过高频快照生成变化事件。
- 不将推测时间写成确定业务时间。

### 22.5 分页期间数据变化

风险：同步过程中商品状态变化，导致分页记录移动、重复或遗漏。

应对：

- 单账号串行快速完成分页。
- 对 `productId` 去重。
- 保存批次开始和完成时间。
- 每日执行完整基线同步。
- 对重点商品单独按 ID 复查。

### 22.6 请求频率风控

风险：全量分页、多账号并发或高频重点查询触发限制。

应对：

- 单账号串行。
- 请求间隔和随机抖动。
- 多账号错峰。
- 限制每次 ID 批量大小。
- HTTP `403`、`429` 立即停止或降速。

---

## 23. 最终建议

采用“浏览器签名容器 + 页面内协议查询 + 快照与事件双模型”的架构：

1. CloakBrowser 保存账号登录态和稳定指纹。
2. Temu 页面环境负责生成动态 `Anti-Content`。
3. Python 服务通过 CDP 执行页面内 `fetch()`。
4. 主列表接口提供 SPU、SKC、SKU 当前状态和生命周期时间。
5. 辅助接口提供快速筛选和待办数量。
6. 数据层同时保存原始响应、当前快照和生命周期事件。
7. 使用全量同步建立基线，使用重点查询提高关键状态变化发现速度。
8. 多账号使用独立 Profile、独立任务锁和独立数据范围。
9. 不依赖页面 DOM，不维护 `Anti-Content` 算法。
10. 状态码映射必须经过页面与接口共同验证。

当前接口已完成协议查询验证，具备工程化实施生命周期监控、待办跟踪和状态变化分析的基础。
