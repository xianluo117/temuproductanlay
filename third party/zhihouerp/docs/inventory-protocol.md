# 智猴 ERP 库存协议请求方案

## 1. 结论

智猴 ERP 商品库存可以通过 HTTP 协议直接查询，无需持续操作浏览器页面。

已完成实际验证：

- 使用原生 HTTP 请求绕过 ERP 页面组件。
- 接口正常返回未加密 JSON。
- 服务端接受每页 `100` 条的查询参数。
- 当前库存总数为 `133` 条，按每页 `100` 条分为 `2` 页。
- 第一页返回 `100` 条，第二页返回 `33` 条。

推荐采用以下架构：

> CloakBrowser 负责登录和令牌续期，HTTP 客户端负责库存分页查询。

## 2. 接口信息

### 2.1 基本信息

| 项目         | 内容                                                             |
| ------------ | ---------------------------------------------------------------- |
| 接口用途     | 分页查询商品库存                                                 |
| 请求地址     | `https://api-cn.zhfulfill.com/erp/dealer/warehouse/product/page` |
| 请求方法     | `POST`                                                           |
| Content-Type | `application/json;charset=UTF-8`                                 |
| 响应格式     | JSON                                                             |
| 核心鉴权     | `x-access-token` 请求头                                          |

### 2.2 已确认的协议特征

| 项目           | 结果       |
| -------------- | ---------- |
| 请求体加密     | 未发现     |
| 动态签名       | 未发现     |
| 时间戳签名     | 未发现     |
| Cookie 依赖    | 当前未发现 |
| 页面组件依赖   | 无         |
| WebSocket 依赖 | 无         |
| 浏览器指纹依赖 | 当前未发现 |

## 3. 鉴权方案

### 3.1 请求头

```http
Accept: application/json, text/plain, */*
Content-Type: application/json;charset=UTF-8
x-access-token: <有效访问令牌>
```

### 3.2 浏览器令牌位置

登录成功后，当前访问令牌保存在浏览器 `localStorage`：

```text
hp_erp_token
```

协议程序可以在已登录的 CloakBrowser 会话中读取该值，然后注入 HTTP 客户端。

访问令牌属于敏感数据：

- 不得写入代码仓库。
- 不得写入普通日志。
- 不得放入文档或截图。
- 应通过运行时参数、环境变量或安全凭据存储传递。
- 日志如需标识令牌，只保留首尾各 `4` 位。

## 4. 请求参数

### 4.1 每页 100 条

已验证请求体：

```json
{
  "beginCreateTime": "",
  "endCreateTime": "",
  "pageSize": 100,
  "pageNo": 1
}
```

第二页请求：

```json
{
  "beginCreateTime": "",
  "endCreateTime": "",
  "pageSize": 100,
  "pageNo": 2
}
```

### 4.2 参数说明

| 参数              | 类型   | 说明                           |
| ----------------- | ------ | ------------------------------ |
| `beginCreateTime` | 字符串 | 创建时间起点；空字符串表示不限 |
| `endCreateTime`   | 字符串 | 创建时间终点；空字符串表示不限 |
| `pageSize`        | 整数   | 每页记录数；已验证 `100` 可用  |
| `pageNo`          | 整数   | 页码，从 `1` 开始              |

时间参数的具体格式和边界语义尚未验证。使用增量查询前，需要通过页面设置时间范围并重新监听参数。

## 5. 响应结构

接口响应结构：

```json
{
  "code": 200,
  "data": {
    "records": [],
    "total": 133,
    "size": 100,
    "current": 1,
    "pages": 2
  },
  "message": "success"
}
```

### 5.1 分页字段

| 字段           | 说明                         |
| -------------- | ---------------------------- |
| `code`         | 业务状态码；成功时为 `200`   |
| `message`      | 业务消息；成功时为 `success` |
| `data.records` | 当前页库存记录数组           |
| `data.total`   | 符合条件的库存总数           |
| `data.size`    | 服务端实际使用的分页大小     |
| `data.current` | 当前页码                     |
| `data.pages`   | 总页数                       |

### 5.2 已验证分页结果

| 查询    | 请求数量 | 实际返回 | 总数 | 总页数 |
| ------- | -------: | -------: | ---: | -----: |
| 第 1 页 |      100 |      100 |  133 |      2 |
| 第 2 页 |      100 |       33 |  133 |      2 |

服务端未将 `pageSize: 100` 降级，返回的 `data.size` 仍为 `100`。

## 6. 库存字段

已确认库存记录包含以下字段：

| 字段                  | 说明                                           |
| --------------------- | ---------------------------------------------- |
| `id`                  | 库存记录 ID                                    |
| `productInventoryId`  | 商品库存关联 ID                                |
| `name`                | 商品名称                                       |
| `mainImageUri`        | 商品主图地址                                   |
| `spu`                 | 商品规格编码；当前数据包含颜色、尺码等规格信息 |
| `quantity`            | 当前可用数量                                   |
| `freezeQuantity`      | 冻结数量                                       |
| `outQuantity`         | 已出库数量                                     |
| `totalQuantity`       | 总数量                                         |
| `badQuantity`         | 次品数量                                       |
| `allotOutQuantity`    | 调拨出库数量                                   |
| `allotInQuantity`     | 调拨入库数量                                   |
| `shareOutQuantity`    | 共享出库数量                                   |
| `shareQuantity`       | 共享库存数量                                   |
| `shareFreezeQuantity` | 共享冻结数量                                   |
| `shareState`          | 共享状态                                       |
| `imageUri`            | 规格图片地址                                   |
| `list`                | 扩展数据；当前响应中可能为空字符串             |

## 7. 库存数量语义

已观察到部分记录存在以下关系：

```text
quantity = 6
outQuantity = 1
totalQuantity = 7
```

因此：

- `totalQuantity` 不能直接作为当前可用库存。
- 当前可用库存应优先使用 `quantity`。
- 是否需要进一步扣除 `freezeQuantity`，应根据 ERP 页面显示值和实际业务规则确认。
- 同步程序应保留所有数量字段，不能只保存一个库存数值。

建议库存模型至少保存：

```text
available_quantity = quantity
frozen_quantity = freezeQuantity
outbound_quantity = outQuantity
total_quantity = totalQuantity
defective_quantity = badQuantity
```

## 8. ID 精度要求

库存 `id` 的数值超过 JavaScript 安全整数范围：

```text
Number.MAX_SAFE_INTEGER = 9007199254740991
```

库存接口中的 ID 示例为 `19` 位数字，不能安全地使用 JavaScript `Number` 保存。

### 8.1 强制要求

- 所有库存 ID 必须作为字符串处理。
- JavaScript/TypeScript 不得将 ID 转换为 `Number`。
- 数据库字段应使用字符串或支持完整精度的整数类型。
- JSON 解析器如果自动将大整数转换为浮点数，应改用大整数安全解析器。
- 去重键必须使用原始字符串 ID。

### 8.2 JavaScript 解析建议

标准 `JSON.parse()` 会先把裸数字解析为 `Number`，可能造成末位变化。可采用以下方式之一：

1. 使用支持大整数的 JSON 解析库。
2. 在解析前将指定的大整数 ID 转为字符串。
3. 由后端语言读取并以字符串模型保存。

如果使用 Python，标准 JSON 解析器可将整数保存为任意精度整数，但写入其他系统时仍建议统一转换为字符串。

## 9. 跨页重复问题

实际连续查询第 `1` 页和第 `2` 页时发现一个完全相同的库存 ID 同时出现在两页：

```text
2079851584824950784
```

验证结果：

- 两页返回条数合计：`133`
- 接口声明总数：`133`
- 按原始字符串 ID 去重后：`132`
- 精度碰撞数量：`0`
- 确认属于接口跨页重复，不是 JavaScript 大整数精度造成的假重复

可能原因：

- 接口默认排序不稳定。
- 多条数据具有相同排序值。
- 分页期间库存数据发生变化。
- 服务端使用偏移分页，但没有稳定的唯一排序条件。

### 9.1 客户端保护要求

协议客户端必须：

1. 跨页按原始字符串 `id` 去重。
2. 记录每页原始返回数量和去重后数量。
3. 检测重复 ID 并输出统计日志。
4. 不以“分页返回数量之和”等同于真实唯一记录数量。
5. 对关键同步任务执行第二轮查询并合并结果。
6. 如果第二轮仍不稳定，应继续调查接口是否支持排序字段。

### 9.2 漏项风险

跨页重复通常意味着也可能存在跨页漏项。仅去重能够防止重复写入，但不能证明不存在遗漏。

高一致性场景建议：

1. 连续执行两轮完整分页。
2. 合并两轮结果。
3. 按字符串 ID 去重。
4. 对两轮 ID 集合差异生成告警。
5. 在短时间内进行第三轮补偿查询。

## 10. 协议调用示例

### 10.1 JavaScript

```javascript
async function queryInventoryPage({ token, pageNo, pageSize = 100 }) {
  const response = await fetch(
    "https://api-cn.zhfulfill.com/erp/dealer/warehouse/product/page",
    {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=UTF-8",
        "x-access-token": token
      },
      body: JSON.stringify({
        beginCreateTime: "",
        endCreateTime: "",
        pageSize,
        pageNo
      })
    }
  );

  if (!response.ok) {
    throw new Error(`库存接口 HTTP 错误: ${response.status}`);
  }

  return response.text();
}
```

这里返回原始文本而不是直接执行 `response.json()`，目的是允许上层使用大整数安全 JSON 解析器。

### 10.2 Python

```python
import requests


def query_inventory_page(token: str, page_no: int, page_size: int = 100) -> dict:
    response = requests.post(
        "https://api-cn.zhfulfill.com/erp/dealer/warehouse/product/page",
        headers={
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json;charset=UTF-8",
            "x-access-token": token,
        },
        json={
            "beginCreateTime": "",
            "endCreateTime": "",
            "pageSize": page_size,
            "pageNo": page_no,
        },
        timeout=(10, 30),
    )
    response.raise_for_status()
    return response.json()
```

Python 读取记录后，应执行：

```python
record["id"] = str(record["id"])
```

## 11. 完整分页流程

推荐流程：

1. 获取有效 `x-access-token`。
2. 请求 `pageNo = 1`、`pageSize = 100`。
3. 检查 HTTP 状态码。
4. 检查业务状态码 `code`。
5. 读取 `data.pages` 和 `data.total`。
6. 从第 `2` 页持续请求到 `data.pages`。
7. 将每条库存 ID 转为字符串。
8. 按字符串 ID 合并和去重。
9. 统计跨页重复数量。
10. 将唯一库存记录写入目标存储。
11. 对高一致性任务执行第二轮补偿查询。

### 11.1 分页终止条件

主要条件：

```text
current >= pages
```

辅助保护条件：

```text
records.length == 0
```

还应设置最大页数保护，避免异常响应导致无限循环。

## 12. 异常处理

### 12.1 HTTP 异常

| 状态           | 处理方式                     |
| -------------- | ---------------------------- |
| `401` 或 `403` | 停止分页，刷新或重新获取令牌 |
| `429`          | 按服务端限制退避重试         |
| `5xx`          | 有限次数指数退避重试         |
| 网络超时       | 有限次数重试，并记录页码     |

### 12.2 业务异常

当 HTTP 为 `200` 但业务 `code` 不为 `200` 时：

- 不得按成功响应解析库存。
- 记录脱敏后的业务错误。
- 鉴权相关错误应触发令牌续期。
- 参数错误应立即停止，禁止盲目重试。

## 13. 稳定性与频率

建议：

- 连接超时：`10` 秒。
- 响应超时：`30` 秒。
- 单页失败重试：最多 `3` 次。
- 分页间隔：根据实际业务设置 `100` 至 `500` 毫秒。
- 每轮同步记录开始时间、结束时间、页数、返回数、唯一数和重复数。
- 不要并发请求大量分页，避免触发服务端限流或分页数据不一致。

当前总数仅需 `2` 页，不建议并发请求。

## 14. 推荐模块结构

后续实现库存同步时，建议按模块拆分：

```text
src/
  auth/
    token-provider
    browser-token-provider
  client/
    erp-http-client
  inventory/
    inventory-api
    inventory-paginator
    inventory-model
    inventory-deduplicator
    inventory-sync-service
  config/
    settings
  storage/
    inventory-repository
    sync-checkpoint
```

职责说明：

| 模块                     | 职责                             |
| ------------------------ | -------------------------------- |
| `token-provider`         | 提供和刷新访问令牌               |
| `erp-http-client`        | 统一处理请求头、超时、重试和错误 |
| `inventory-api`          | 封装库存接口参数和响应           |
| `inventory-paginator`    | 执行分页并处理终止条件           |
| `inventory-model`        | 定义库存字段及大整数 ID 规则     |
| `inventory-deduplicator` | 按字符串 ID 去重并统计重复项     |
| `inventory-sync-service` | 编排完整同步和补偿查询           |
| `inventory-repository`   | 保存库存快照或更新目标库存       |

## 15. 与订单协议的共用能力

库存接口与订单接口使用相同鉴权方式：

```http
x-access-token: <有效访问令牌>
```

因此可以共用：

- 令牌读取和续期模块。
- HTTP 客户端。
- 超时和重试策略。
- 鉴权失败处理。
- 日志脱敏规则。
- CloakBrowser 登录会话。

库存和订单业务模型、分页响应结构不同，应分别实现业务模块，不要混在同一个文件中。

## 16. 可行性评估

| 项目             | 结果                   |
| ---------------- | ---------------------- |
| 库存协议查询     | 可行，已实测成功       |
| 每页 100 条      | 可行，已实测成功       |
| 脱离页面组件     | 可行，已实测成功       |
| 自动分页         | 可行                   |
| 未加密 JSON 解析 | 可行                   |
| 请求签名         | 未发现                 |
| Cookie 依赖      | 未发现                 |
| 唯一核心依赖     | 有效 `x-access-token`  |
| 大整数 ID        | 必须按字符串处理       |
| 跨页重复         | 已发现，必须去重和补偿 |
| 增量时间查询     | 待验证                 |
| 稳定排序参数     | 待验证                 |

## 17. 后续验证项目

- 验证 `beginCreateTime` 和 `endCreateTime` 的格式。
- 确认时间范围筛选针对创建时间还是库存更新时间。
- 查找是否支持 SPU、商品名称或仓库筛选。
- 查找是否支持明确的排序字段和排序方向。
- 验证接口允许的最大 `pageSize`。
- 验证访问令牌有效期。
- 验证令牌失效时的 HTTP 与业务状态码。
- 确认可用库存是否应扣除冻结库存。
- 验证跨页重复在静态数据状态下是否稳定复现。
- 设计两轮补偿查询和差异告警。

## 18. 当前进度

- [x] 定位库存分页接口
- [x] 确认请求方法和 JSON 请求体
- [x] 确认 `x-access-token` 鉴权
- [x] 确认浏览器令牌存储键
- [x] 确认响应为未加密 JSON
- [x] 使用独立 HTTP 请求验证接口
- [x] 验证 `pageSize: 100`
- [x] 验证第一页返回 `100` 条
- [x] 验证第二页返回 `33` 条
- [x] 确认库存总数和分页结构
- [x] 确认库存主要字段
- [x] 识别大整数 ID 精度风险
- [x] 识别接口跨页重复问题
- [ ] 确认稳定排序参数
- [ ] 确认时间范围参数格式
- [ ] 确认可用库存业务计算规则
- [ ] 实现库存协议客户端
- [ ] 实现两轮补偿查询
