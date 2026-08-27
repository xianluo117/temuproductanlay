# Temu 流量数据查询方案

## 1. 方案目标

建立可长期运行的 Temu 商品流量数据查询服务，实现以下能力：

- 复用账号已有登录状态，无需每次人工登录。
- 通过 Temu 页面运行环境生成动态请求签名。
- 查询店铺流量总览、趋势和商品明细。
- 支持分页、筛选、定时执行、数据清洗及持久化。
- 支持多账号隔离运行。
- 登录失效、接口变更或风控异常时能够自动识别并告警。

本方案不依赖页面按钮和表格抓取。浏览器仅作为登录态与动态签名容器，实际数据通过接口返回。

---

## 2. 已验证结论

### 2.1 可查询接口

当前已验证以下接口可在已登录页面中正常调用：

| 功能         | 方法 | 接口                                         |
| ------------ | ---- | -------------------------------------------- |
| 流量总览     | POST | `/api/flow/analysis/overview`                |
| 流量趋势     | POST | `/api/flow/analysis/trend`                   |
| 商品流量明细 | POST | `/api/flow/analysis/list`                    |
| 爆款商品数量 | POST | `/api/flow/analysis/best-seller-goods-count` |

接口成功响应具有统一结构：

```json
{
  "success": true,
  "errorCode": 1000000,
  "errorMsg": null,
  "result": {}
}
```

### 2.2 鉴权与签名约束

Temu 请求依赖以下状态：

- 账号登录 Cookie。
- 店铺标识 `mallid`。
- 页面运行环境。
- 动态请求头 `Anti-Content`。
- 浏览器 UA、Client Hints、指纹和会话状态。

实测结果：

1. 在已登录 Temu 页面上下文中调用接口，返回 HTTP 200。
2. 将已捕获请求直接在浏览器外重放，返回 HTTP 403，错误码 `40001`。
3. 旧的 `Anti-Content` 不能稳定复用。
4. 页面内请求即使没有显式设置 `Anti-Content`，Temu 请求层也会自动生成有效签名。

因此，生产方案应保留浏览器上下文，不应仅依赖导出的 Cookie。

---

## 3. 总体架构

```text
任务调度器
    │
    ▼
账号路由与并发控制
    │
    ▼
CloakBrowser 持久化实例
    │
    ├── Profile 登录态
    ├── Temu 页面运行环境
    ├── Cookie / mallid
    └── Anti-Content 动态生成
    │
    ▼
页面内协议查询器
    │
    ├── overview
    ├── trend
    ├── list
    └── best-seller-goods-count
    │
    ▼
响应校验与数据标准化
    │
    ├── 原始响应归档
    ├── 总览数据
    ├── 趋势数据
    └── 商品明细
    │
    ▼
数据库 / JSON / CSV / 内部 API
```

### 3.1 模块划分

建议按职责拆分：

```text
temu-traffic-query/
├── app/
│   ├── browser/
│   │   ├── factory.py
│   │   ├── profile_manager.py
│   │   ├── session_health.py
│   │   └── cdp_client.py
│   ├── temu/
│   │   ├── api_client.py
│   │   ├── endpoints.py
│   │   ├── request_models.py
│   │   ├── response_models.py
│   │   └── error_codes.py
│   ├── traffic/
│   │   ├── overview_service.py
│   │   ├── trend_service.py
│   │   ├── goods_service.py
│   │   └── sync_service.py
│   ├── accounts/
│   │   ├── account_model.py
│   │   ├── account_repository.py
│   │   └── account_router.py
│   ├── storage/
│   │   ├── database.py
│   │   ├── raw_repository.py
│   │   ├── overview_repository.py
│   │   ├── trend_repository.py
│   │   └── goods_repository.py
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
│   └── query_once.py
├── data/
│   └── exports/
├── docs/
│   └── temu-traffic-query-plan.md
├── requirements.txt
└── README.md
```

---

## 4. 浏览器运行方案

### 4.1 Profile 规则

每个 Temu 账号必须绑定独立且稳定的 Profile：

```text
E:\tools\cloackBrower\profiles\temu\<account_key>
```

规则：

- 一个账号不得与其他账号共用 Profile。
- Profile 用于保存 Cookie、localStorage、IndexedDB 和登录状态。
- 浏览器二进制缓存目录不得作为 Profile 使用。
- Profile 路径在账号创建后保持不变。
- 同一账号保持稳定指纹参数，避免频繁改变环境。

### 4.2 启动参数

建议参数：

- 使用 `launch_persistent_context()`。
- 日常查询使用无头模式。
- 登录或账号异常处理使用可视模式。
- 语言使用 `zh-CN`。
- 时区使用 `Asia/Shanghai`，或与账号常用环境保持一致。
- 指纹种子固定到账号。
- 每个实例分配独立 CDP 端口。

### 4.3 浏览器职责

浏览器只负责：

- 保存登录状态。
- 加载 Temu 页面运行环境。
- 自动携带 Cookie。
- 生成动态 `Anti-Content`。
- 在页面上下文内执行请求。

浏览器不负责：

- 页面表格解析。
- 业务数据清洗。
- 数据库存储。
- 定时任务调度。
- 多账号任务分配。

---

## 5. 查询流程

### 5.1 初始化流程

1. 根据账号配置定位 Profile。
2. 启动或连接对应 CloakBrowser 实例。
3. 打开 `https://agentseller-us.temu.com/main/flux-analysis`。
4. 等待页面核心脚本加载完成。
5. 检查当前 URL 是否被重定向至登录页。
6. 调用轻量接口验证会话状态。
7. 读取 `mallid` 并与账号配置核对。
8. 会话有效后进入查询阶段。

### 5.2 页面内请求方式

通过 CDP 在 Temu 页面上下文执行异步 JavaScript：

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

说明：

- 不手工生成 `Anti-Content`。
- 不复用历史 `Anti-Content`。
- 不将 HttpOnly Cookie复制到页面脚本。
- `fetch()` 会自动携带当前域名 Cookie。
- Temu 前端请求层负责补充动态签名。

### 5.3 总览查询

请求：

```json
{
  "timeDimension": 1
}
```

接口：

```text
POST /api/flow/analysis/overview
```

主要字段：

- `pt`：统计日期。
- `impressionCount`：曝光量。
- `clickCount`：点击量。
- `orderPayOrderNum`：支付订单数。
- `orderPayGoodsNum`：支付商品数。
- `clickImpressionRate`：点击率。
- `clickOrderRatio`：点击支付转化率。
- `orderPayImpressionRate`：曝光支付转化率。
- `*LinkRelative`：环比变化。

### 5.4 趋势查询

请求：

```json
{
  "trendType": 10,
  "timeDimension": 1
}
```

接口：

```text
POST /api/flow/analysis/trend
```

参数说明：

- `timeDimension`：时间范围。
- `trendType`：指标类型。

当前已知商品列表中的指标映射包括：

| 指标           |   值 |
| -------------- | ---: |
| 商品访客数     |    1 |
| 商品浏览数     |    2 |
| 加购人数       |    3 |
| 收藏人数       |    4 |
| 支付商品数     |    5 |
| 支付订单数     |    6 |
| 完成付款用户数 |    7 |
| 曝光量         |   10 |
| 点击量         |   11 |

趋势接口的完整映射应在实施阶段逐项验证，并作为配置维护，不应散落在业务代码中。

### 5.5 商品明细查询

最小请求：

```json
{
  "pageSize": 30,
  "pageNumber": 1,
  "timeDimension": 1
}
```

接口：

```text
POST /api/flow/analysis/list
```

分页流程：

1. 请求第一页。
2. 读取 `result.total`。
3. 根据 `pageSize` 计算总页数。
4. 依次请求剩余页。
5. 使用 `goodsId + pt + siteId` 作为业务幂等键。
6. 每页请求之间加入可配置间隔。

可选筛选参数：

- `sortMode`
- `sortType`
- `flowGrowStatus`
- `maxModeStatus`
- `flowLimitingStatus`
- `flowToDecreaseStatus`
- `bestSellerGoodsStatus`
- `canToGrow`
- 页面查询表单中的商品、站点和类目条件

### 5.6 爆款数量查询

接口：

```text
POST /api/flow/analysis/best-seller-goods-count
```

基础请求体可使用空对象：

```json
{}
```

该接口用于辅助展示或同步任务完整性检查，不作为明细数据来源。

---

## 6. 时间维度处理

当前已确认 `timeDimension = 1` 可查询近一日数据。

其他时间维度不能直接假设，应通过以下步骤验证：

1. 打开页面并切换时间范围。
2. 监听 `overview`、`trend` 和 `list` 请求。
3. 记录时间选项与请求值的对应关系。
4. 将映射写入配置表。
5. 为每个映射执行接口回归测试。

建议配置结构：

```python
TIME_DIMENSIONS = {
    "last_1_day": 1,
    # 验证后补充
}
```

禁止在未验证前将界面显示文案直接映射为猜测值。

---

## 7. 数据模型

### 7.1 账号表

建议字段：

| 字段               | 说明                             |
| ------------------ | -------------------------------- |
| `account_id`       | 内部账号 ID                      |
| `account_key`      | Profile 唯一标识                 |
| `profile_path`     | 浏览器 Profile 路径              |
| `mall_id`          | Temu 店铺 ID                     |
| `status`           | active、login_required、disabled |
| `fingerprint_seed` | 固定指纹种子                     |
| `cdp_port`         | 浏览器调试端口                   |
| `last_login_at`    | 最近登录时间                     |
| `last_success_at`  | 最近查询成功时间                 |
| `last_error`       | 最近错误摘要                     |

### 7.2 流量总览表

建议唯一键：

```text
account_id + mall_id + stat_date + time_dimension
```

主要字段：

- 曝光量。
- 点击量。
- 支付订单数。
- 支付商品数。
- 点击率。
- 点击支付转化率。
- 曝光支付转化率。
- 各项环比。
- 原始响应引用。
- 抓取时间。

### 7.3 流量趋势表

建议唯一键：

```text
account_id + mall_id + time_dimension + trend_type + series_key + point_time
```

主要字段：

- 系列名称。
- 指标类型。
- 时间点。
- 指标值。
- 渠道类型。
- 活动标记。
- 抓取时间。

### 7.4 商品流量表

建议唯一键：

```text
account_id + mall_id + goods_id + site_id + stat_date
```

主要字段：

- 商品和产品 ID。
- 商品名称。
- 站点。
- 类目层级。
- 主图地址。
- 访客数、浏览数、加购数和收藏数。
- 曝光量、点击量和点击率。
- 支付商品数和支付订单数。
- 搜索渠道指标。
- 推荐渠道指标。
- 流量增长、限流和爆款状态。
- 环比指标。
- 原始响应引用。
- 抓取时间。

### 7.5 原始响应表

所有接口响应建议保留原始 JSON：

| 字段            | 说明        |
| --------------- | ----------- |
| `request_id`    | 内部请求 ID |
| `account_id`    | 账号 ID     |
| `endpoint`      | 接口路径    |
| `request_body`  | 请求体      |
| `http_status`   | HTTP 状态码 |
| `error_code`    | Temu 错误码 |
| `response_body` | 原始响应    |
| `requested_at`  | 请求时间    |
| `duration_ms`   | 请求耗时    |

原始响应用于排查字段变化和重新处理历史数据。

---

## 8. 多账号运行

### 8.1 隔离原则

- 一个账号一个 Profile。
- 一个账号一个浏览器上下文。
- 一个账号同一时间只允许一个写任务。
- 不同账号可配置有限并发。
- Cookie、Profile、CDP 端口和任务日志均按账号隔离。

### 8.2 并发控制

建议：

- 单账号接口请求串行执行。
- 单账号分页请求并发数默认设为 1。
- 多账号并发数从 2 开始，根据稳定性逐步调整。
- 每次请求间隔 300 至 1000 毫秒，并增加少量随机抖动。
- 遇到 403、429 或风控错误立即停止该账号任务，不连续重试。

### 8.3 账号调度状态

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

---

## 9. 会话健康检查

### 9.1 检查项

每次任务开始前检查：

- 浏览器进程是否存活。
- CDP 是否可连接。
- Temu 页面是否存在。
- 页面是否被重定向到登录页。
- `mallid` 是否存在。
- 当前 `mallid` 是否匹配账号配置。
- 轻量接口是否返回 HTTP 200。
- 响应中的 `success` 是否为 `true`。
- `errorCode` 是否为 `1000000`。

### 9.2 登录失效判定

满足以下任一条件时标记 `LOGIN_REQUIRED`：

- 跳转至认证页面。
- `seller_temp` 不存在或失效。
- 用户信息接口返回未登录。
- 流量接口持续返回鉴权失败。
- 当前店铺 ID 与账号配置不一致。

登录失效后：

1. 停止该账号所有查询任务。
2. 保留 Profile，不自动删除 Cookie。
3. 启动可视浏览器供人工重新登录。
4. 登录完成后重新执行健康检查。
5. 检查通过后恢复调度。

---

## 10. 错误处理

### 10.1 HTTP 错误

| 状态        | 处理方式                         |
| ----------- | -------------------------------- |
| 200         | 继续校验业务响应                 |
| 400         | 记录请求参数，停止当前接口       |
| 401         | 标记登录失效                     |
| 403         | 标记签名或风控异常，停止账号任务 |
| 429         | 延迟任务，禁止立即密集重试       |
| 500/502/503 | 指数退避重试，限制最大次数       |

### 10.2 业务错误

成功条件：

```text
success == true && errorCode == 1000000
```

其他业务错误必须记录：

- 接口路径。
- 请求体。
- HTTP 状态。
- Temu 错误码。
- 错误消息。
- 当前 URL。
- mallid。
- 账号 ID。

日志中不得输出完整 Cookie 和完整 `Anti-Content`。

### 10.3 重试规则

- 网络超时：最多重试 2 次。
- HTTP 5xx：最多重试 2 次。
- HTTP 403：不自动连续重试。
- 登录失效：不自动重试数据接口。
- 参数错误：不重试。
- 重试使用指数退避，例如 2 秒、5 秒。

---

## 11. 监控与告警

建议监控指标：

- 每账号浏览器存活状态。
- CDP 连接状态。
- 登录有效状态。
- 每接口成功率。
- HTTP 403、429 和 5xx 数量。
- 查询耗时。
- 分页完成率。
- 当日商品数量。
- 最近一次成功同步时间。
- 原始响应字段变化。

告警条件：

- 连续两次同步失败。
- 登录状态失效。
- 出现 HTTP 403。
- 商品总数突然降为 0。
- 商品总数相较历史异常波动。
- 响应结构缺少 `result`。
- 定时任务超过预期时长。

---

## 12. 安全要求

- Profile 目录仅允许服务账号访问。
- 不在日志中输出 Cookie。
- 不在配置文件中保存明文 Cookie。
- 不持久化完整 `Anti-Content`，调试时仅记录哈希或前后少量字符。
- CDP 仅监听 `127.0.0.1`。
- 不将 CDP 端口暴露到公网。
- 内部查询 API 必须增加身份认证和访问控制。
- 数据库账号采用最小权限。
- 导出文件按账号和日期隔离，并设置清理周期。

---

## 13. 部署方案

### 13.1 单机部署

适合账号数量较少的场景：

```text
Windows 主机
├── Python 查询服务
├── CloakBrowser 实例 1
├── CloakBrowser 实例 2
├── 调度器
└── SQLite / PostgreSQL
```

建议：

- 1 至 5 个账号使用单机部署。
- 浏览器实例按任务启动或保持常驻。
- 开发阶段使用 SQLite。
- 正式运行优先使用 PostgreSQL。

### 13.2 服务进程

建议拆分：

- `browser-worker`：管理浏览器实例和页面请求。
- `scheduler`：生成同步任务。
- `query-api`：提供内部查询接口。
- `storage-worker`：批量写入和数据清洗。

初期可在一个 Python 进程内实现，但代码模块必须保持独立，便于后续拆分。

---

## 14. 定时同步策略

推荐默认策略：

| 数据         | 同步频率       |
| ------------ | -------------- |
| 总览数据     | 每 30 分钟     |
| 趋势数据     | 每 1 小时      |
| 商品明细     | 每 1 至 2 小时 |
| 历史日数据   | 每日补偿一次   |
| 会话健康检查 | 每 10 分钟     |

调度规则：

- 避免所有账号同一时刻执行。
- 按账号加入 1 至 5 分钟错峰。
- 明细同步先查询总数，再进行分页。
- 当日数据允许覆盖更新。
- 历史已结算数据使用幂等更新。

---

## 15. 内部查询 API

查询服务可以对内部系统提供统一接口：

```text
GET  /internal/temu/accounts/{account_id}/traffic/overview
GET  /internal/temu/accounts/{account_id}/traffic/trend
GET  /internal/temu/accounts/{account_id}/traffic/goods
POST /internal/temu/accounts/{account_id}/sync
GET  /internal/temu/accounts/{account_id}/session/status
```

内部 API 不直接返回 Cookie、Profile 路径或签名信息。

查询参数建议支持：

- 日期范围。
- 站点。
- 商品 ID。
- 产品 ID。
- 类目。
- 排序字段。
- 分页。
- 流量状态。

---

## 16. 实施阶段

### 阶段一：单账号最小闭环

- [ ] 创建项目目录和配置模块。
- [ ] 实现固定 Profile 启动。
- [ ] 实现 CDP 页面连接。
- [ ] 实现页面内统一 POST 请求函数。
- [ ] 实现总览、趋势和商品明细查询。
- [ ] 将结果输出为 JSON。
- [ ] 实现登录失效识别。

验收条件：

- 已登录账号能够连续执行 20 次查询。
- 总览和明细结果与页面一致。
- 查询过程不操作页面 UI。
- 浏览器重启后可复用登录状态。

### 阶段二：数据持久化

- [ ] 建立账号、原始响应、总览、趋势和商品明细表。
- [ ] 实现数据标准化。
- [ ] 实现幂等写入。
- [ ] 实现分页完整性检查。
- [ ] 实现 JSON 和 CSV 导出。

验收条件：

- 同一统计周期重复同步不会产生重复数据。
- 商品分页总数与接口 `total` 一致。
- 原始响应可用于重新处理。

### 阶段三：调度与监控

- [ ] 增加定时任务。
- [ ] 增加账号级任务锁。
- [ ] 增加重试和退避策略。
- [ ] 增加日志、指标和告警。
- [ ] 增加会话健康检查。

验收条件：

- 服务可持续运行 7 天。
- 登录失效能够在一个检查周期内发现。
- HTTP 403 不会触发密集重试。

### 阶段四：多账号与内部 API

- [ ] 增加多账号 Profile 管理。
- [ ] 增加浏览器实例池。
- [ ] 增加账号路由和限流。
- [ ] 增加内部查询 API。
- [ ] 增加账号级权限控制。

验收条件：

- 账号之间 Cookie、Profile 和数据完全隔离。
- 单账号故障不影响其他账号。
- 多账号任务并发可配置。

---

## 17. 风险与应对

### 17.1 前端接口变化

风险：接口路径、参数或响应字段变化。

应对：

- 保留原始响应。
- 对响应模型进行宽松解析。
- 对关键字段增加结构告警。
- 将接口路径和参数映射集中配置。

### 17.2 Anti-Content 机制变化

风险：Temu 修改签名注入位置或浏览器环境检查。

应对：

- 继续使用真实页面上下文发起请求。
- 不自行维护签名算法。
- 保持浏览器版本和 Profile 稳定。
- 出现 403 时停止任务并进行人工分析。

### 17.3 登录态过期

风险：Cookie 到期、异地验证或安全校验。

应对：

- 定时检查登录状态。
- Profile 长期固定。
- 登录失效后切换可视模式处理。
- 不自动删除 Profile。

### 17.4 请求频率风控

风险：分页和多账号并发触发限制。

应对：

- 单账号串行。
- 请求间隔和随机抖动。
- 多账号错峰。
- 403、429 立即降速或停止。

### 17.5 浏览器资源占用

风险：多账号常驻浏览器占用较多内存。

应对：

- 小规模账号保持常驻。
- 大规模账号采用按需启动和空闲回收。
- 单实例仅保留必要页面。
- 定期检查并重启异常实例。

---

## 18. 推荐技术选型

| 模块         | 推荐方案                           |
| ------------ | ---------------------------------- |
| 编程语言     | Python 3.12                        |
| 浏览器       | CloakBrowser                       |
| 自动化接口   | Playwright / CDP                   |
| HTTP 服务    | FastAPI                            |
| 数据校验     | Pydantic                           |
| 调度         | APScheduler；规模扩大后使用 Celery |
| 数据库       | PostgreSQL                         |
| 缓存与任务锁 | Redis，可按规模引入                |
| ORM          | SQLAlchemy                         |
| 日志         | Python logging 或 structlog        |
| 指标         | Prometheus 格式或内部监控系统      |

---

## 19. 最终建议

采用“浏览器签名容器 + 页面内协议请求 + 本地数据服务”的混合架构：

1. CloakBrowser 保存账号登录态和稳定指纹。
2. Temu 页面环境负责生成动态 `Anti-Content`。
3. Python 服务通过 CDP 调用页面内 `fetch()`。
4. Python 服务完成分页、校验、清洗、存储和调度。
5. 多账号使用独立 Profile 和独立任务锁。
6. 不投入高成本逆向并维护 `Anti-Content` 算法。
7. 不依赖页面 DOM 和表格抓取。

该方案已通过总览、趋势和商品明细接口验证，具备继续工程化实施的基础。
