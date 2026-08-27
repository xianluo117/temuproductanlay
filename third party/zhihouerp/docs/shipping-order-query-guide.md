# 智猴 ERP 运输中订单查询指南

## 1. 文档定位

本指南用于通过 HTTP 协议查询处于“运输中”状态的订单，重点说明：

- 查询全部运输中订单。
- 按指定订单号查询运输中订单。
- 从响应中提取包裹、运单和运输状态。

本指南是 [`order-protocol.md`](order-protocol.md) 的场景化补充。

两者存在以下重叠内容：

- 使用同一个订单分页接口。
- 使用相同的 `x-access-token` 鉴权方式。
- 使用相同的分页结构和基础筛选参数。
- 返回相同的订单、商品和包裹数据结构。

本指南独立记录的内容：

- “运输中”对应的 `orderStatus` 值。
- 指定订单号对应的 `orderNos` 参数。
- 运输信息相关字段的读取方式。
- 已验证的运输中订单查询示例。

## 2. 验证结论

运输中订单可以脱离页面，通过标准 HTTP 请求直接查询。

已完成实际验证：

- HTTP 状态码：`200`
- 业务状态码：`200`
- 响应消息：`success`
- 指定订单号查询结果：`1` 条
- 返回订单号与查询条件一致
- 请求体为普通 JSON
- 未发现动态签名
- 未发现请求参数加密
- 当前未发现 Cookie 依赖
- 核心鉴权方式：`x-access-token`

## 3. 接口信息

| 项目         | 内容                                                 |
| ------------ | ---------------------------------------------------- |
| 接口用途     | 分页查询订单                                         |
| 请求地址     | `https://api-cn.zhfulfill.com/erp/dealer/order/page` |
| 请求方法     | `POST`                                               |
| Content-Type | `application/json;charset=UTF-8`                     |
| 鉴权请求头   | `x-access-token`                                     |

必要请求头：

```http
Content-Type: application/json;charset=UTF-8
Accept: application/json, text/plain, */*
x-access-token: <有效访问令牌>
```

访问令牌应由协议登录模块获取，具体流程参见 [`login-protocol.md`](login-protocol.md)。

## 4. 查询全部运输中订单

请求体：

```json
{
  "trackingStatus": "ALL",
  "timeField": "CREATE_TIME",
  "customCarrierIds": [],
  "packageStatus": [],
  "otherLogisticsIds": [],
  "orderDataType": "",
  "logisticsChannelIds": [],
  "storeIds": [],
  "virtualShipment": "",
  "isBind": "",
  "isY2": "",
  "countryCodes": [],
  "orderStatus": "SHIPPED",
  "pageNo": 1,
  "pageSize": 50
}
```

关键条件：

```json
{
  "orderStatus": "SHIPPED"
}
```

当前验证表明，页面中的“运输中”订单分类对应 `SHIPPED`。

## 5. 按订单号查询运输中订单

在运输中订单请求体中增加 `orderNos`：

```json
{
  "orderNos": ["<订单号>"],
  "trackingStatus": "ALL",
  "timeField": "CREATE_TIME",
  "customCarrierIds": [],
  "packageStatus": [],
  "otherLogisticsIds": [],
  "orderDataType": "",
  "logisticsChannelIds": [],
  "storeIds": [],
  "virtualShipment": "",
  "isBind": "",
  "isY2": "",
  "countryCodes": [],
  "orderStatus": "SHIPPED",
  "pageNo": 1,
  "pageSize": 50
}
```

### 5.1 参数说明

| 参数                  | 说明                                       | 示例           |
| --------------------- | ------------------------------------------ | -------------- |
| `orderNos`            | 精确查询的订单号数组                       | `["<订单号>"]` |
| `orderStatus`         | 订单状态；运输中为 `SHIPPED`               | `SHIPPED`      |
| `trackingStatus`      | 物流跟踪状态；`ALL` 表示不追加跟踪状态限制 | `ALL`          |
| `pageNo`              | 页码，从 `1` 开始                          | `1`            |
| `pageSize`            | 每页数量                                   | `50`           |
| `storeIds`            | 店铺 ID 数组；空数组表示不限               | `[]`           |
| `countryCodes`        | 国家代码数组；空数组表示不限               | `[]`           |
| `logisticsChannelIds` | 物流渠道 ID 数组；空数组表示不限           | `[]`           |

### 5.2 多订单号查询

`orderNos` 是数组结构，可以构造多订单号请求：

```json
{
  "orderNos": [
    "<订单号一>",
    "<订单号二>"
  ],
  "orderStatus": "SHIPPED",
  "trackingStatus": "ALL",
  "timeField": "CREATE_TIME",
  "pageNo": 1,
  "pageSize": 50
}
```

多订单号查询的数量限制和服务端匹配逻辑尚未单独验证。正式实现应限制单批数量，并在结果中按订单号核对。

## 6. 响应结构

接口返回结构：

```json
{
  "code": 200,
  "data": {
    "totalCount": 1,
    "pageNo": 1,
    "pageSize": 50,
    "data": [],
    "totalPages": 1,
    "hasNext": false
  },
  "message": "success"
}
```

### 6.1 查询成功条件

必须同时检查：

```text
HTTP 状态码 == 200
业务状态码 code == 200
```

指定订单号查询还应检查：

```text
data.totalCount > 0
返回订单的 orderNo 与请求订单号一致
```

不能只根据 HTTP 状态码判断业务查询成功。

## 7. 运输信息提取

订单数据位于：

```text
data.data[]
```

订单下的包裹数据位于：

```text
data.data[].parcels[]
```

### 7.1 订单级字段

| 字段             | 说明                                 |
| ---------------- | ------------------------------------ |
| `orderNo`        | 订单号                               |
| `orderStatus`    | 订单状态数值                         |
| `trackingStatus` | 订单物流跟踪状态数值                 |
| `storeId`        | 店铺 ID                              |
| `storeName`      | 店铺名称                             |
| `countryCode`    | 目的国家代码                         |
| `submitTime`     | 订单提交时间                         |
| `shippedTime`    | 订单发货时间；部分记录可能为空       |
| `finishTime`     | 当前流程完成时间；含义需结合状态判断 |
| `parcels`        | 包裹数组                             |

### 7.2 包裹级字段

| 字段                        | 说明                             |
| --------------------------- | -------------------------------- |
| `parcelNo`                  | ERP 包裹编号                     |
| `waybillNo`                 | 物流运单号                       |
| `waybillId`                 | 运单标识                         |
| `trackingStatus`            | 包裹物流跟踪状态数值             |
| `packageStatus`             | 包裹状态数值                     |
| `shippedTime`               | 包裹发货时间                     |
| `logisticsName`             | 物流商名称                       |
| `logisticsChannelName`      | 物流渠道名称                     |
| `countryCode`               | 目的国家代码                     |
| `weight`                    | 包裹重量；单位需结合系统配置确认 |
| `erpOrderParcelBoxTracking` | 当前包裹运输跟踪摘要             |
| `parcelItems`               | 包裹内商品数组                   |

### 7.3 当前运输状态说明

运输状态摘要可从以下路径读取：

```text
data.data[].parcels[].erpOrderParcelBoxTracking.note
```

该字段在本次验证中返回了可读的中文运输进度说明。

读取时应兼容以下情况：

- `erpOrderParcelBoxTracking` 为空。
- `note` 为空。
- 一个订单包含多个包裹。
- 不同包裹具有不同运单号和运输进度。

不能只读取第一个包裹后将其状态视为整个订单的唯一状态。

## 8. 推荐调用流程

1. 通过登录协议获取有效访问令牌。
2. 将令牌写入 `x-access-token` 请求头。
3. 设置 `orderStatus` 为 `SHIPPED`。
4. 如需精确查询，将订单号写入 `orderNos` 数组。
5. 调用订单分页接口。
6. 检查 HTTP 状态码和业务状态码。
7. 核对响应订单号。
8. 遍历订单下的全部 `parcels`。
9. 提取运单号、物流渠道、发货时间和运输状态说明。
10. 对订单号和包裹号去重。

## 9. 分页处理

查询全部运输中订单时必须处理分页。

推荐终止条件：

```text
hasNext == false
```

同时保留以下兼容判断：

```text
pageNo * pageSize >= totalCount
```

或者：

```text
当前页返回数量 < pageSize
```

按单个订单号查询时通常只返回一条订单，但仍应读取 `totalCount`，不能假定结果恒定为一条。

## 10. 实现注意事项

### 10.1 状态字段

请求中的字符串状态：

```text
orderStatus = SHIPPED
```

响应中的状态可能是数字枚举：

```text
orderStatus
trackingStatus
packageStatus
executeStatus
allotStatus
```

请求枚举和响应数值枚举不是同一种表示方式。正式程序不得直接按名称推断响应数值含义，应建立经过验证的状态映射表。

### 10.2 大整数

部分包裹、商品、标签和仓库字段可能超过 JavaScript 安全整数范围。

以下字段应优先按字符串保存：

- 包裹 ID
- 商品明细 ID
- 仓库商品 ID
- 标签 ID
- 供应商 ID
- 物流渠道 ID

不得通过 JavaScript `Number` 转换后再持久化这些 ID。

### 10.3 敏感数据

接口响应可能包含：

- 收件人信息
- 联系电话
- 收货地址
- 店铺信息
- 运单号
- 商品信息

程序日志应仅输出查询结果摘要，不得记录完整响应。访问令牌不得写入文档、源代码或普通日志。

## 11. 与通用订单协议的关系

建议保留两个文档：

- [`order-protocol.md`](order-protocol.md)：记录订单接口的通用协议、分页、鉴权和基础模型。
- [`shipping-order-query-guide.md`](shipping-order-query-guide.md)：记录运输中状态和指定订单号查询的具体操作方式。

这样可以避免通用协议文档不断堆积业务场景，同时让运输查询能够作为独立说明直接使用。

实现代码层面不应建立两套 HTTP 客户端。运输中查询应复用通用订单客户端，仅增加查询条件构造和运输信息解析。

推荐模块关系：

```text
orders/
  order-api
  order-query
  shipping-order-query
  shipping-order-parser
```

其中：

- `order-api` 负责发送通用订单请求。
- `order-query` 负责公共查询参数和分页。
- `shipping-order-query` 负责生成 `SHIPPED` 和 `orderNos` 条件。
- `shipping-order-parser` 负责解析包裹和运输状态。

## 12. 当前状态

- [x] 确认运输中订单使用通用订单分页接口
- [x] 确认运输中状态参数为 `SHIPPED`
- [x] 确认指定订单号参数为 `orderNos`
- [x] 确认 `orderNos` 为数组结构
- [x] 使用捕获请求取得目标订单
- [x] 使用协议重放再次取得目标订单
- [x] 确认响应包含包裹、运单和运输状态摘要
- [ ] 验证多订单号单次查询的数量限制
- [ ] 建立响应状态数值映射表
- [ ] 验证独立物流轨迹详情接口
- [ ] 验证按运单号直接查询的接口
