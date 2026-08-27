# Temu 生命周期查询方案

## 1. 实施范围

生命周期模块只获取 Temu 生命周期主列表中“已发布到站点”的商品，项目业务名称为“已上架”。

固定请求接口：

```text
POST /api/kiana/mms/robin/searchForSemiSupplier
```

固定筛选参数：

```json
{
  "pageSize": 50,
  "pageNum": 1,
  "secondarySelectStatusList": [12],
  "supplierTodoTypeList": []
}
```

`[12]` 已通过真实页面单次点击“已发布到站点”验证。历史 `[9]` 仅作为未验证样例保留，不得用于已上架同步，也不得在筛选失效时退化为无筛选全量查询。

## 2. 数据层级

```text
SPU
└── SKC
    └── SKU
```

- SPU：生命周期主商品标识。
- SKC：颜色、款式等子商品属性；保存 `productPropertyList` 或同类属性原始 JSON。
- SKU：尺码、规格等具体属性；保存 `productPropertyList` 或同类属性原始 JSON。
- 完整平台货号：保存生命周期返回的原始 SKC/SKU 货号，用于内部绑定和详情追溯。
- 展示及匹配货号：清理空白后取前两个 `-` 分段，例如 `DY-189-green` 转为 `DY-189`、`Z38-Y22-junlv` 转为 `Z38-Y22`。
- 匹配顺序：优先匹配 SKC 货号，SKU 货号作为兜底依据；手工产品主档货号原样保存，不因生命周期同步被截断。

## 3. 价格口径

- 最低供应价：供应商侧采购成本价，也就是商品列表中的“核价价”。SKU 层优先读取站点供应价对象 `siteSupplierPriceList[].supplierPriceValue`，该字段以分为单位；SKC/SPU 层取下属有效 SKU 供应价的最小值。
- 供应价兼容直接字段 `lowestSupplierPrice`、`supplierPriceValue`、`supplierPrice`，以及 `siteSupplierPriceList` 中的同类字段；嵌套列表收集全部有效值后取最小值，并按接口单位转换为元。
- 限流价格：匹配范围内明确生命周期调价建议的最低值。列表接口读取 `siteSupplierPriceList[].suggestActivitySupplierPrice`（对应“日常申报价调整为”）和 `siteSupplierPriceList[].targetSupplyPrice`（对应活动申报价/目标供应价），并兼容 `suggestedPrice`、`trafficLimitPrice`、`limitPrice` 及其明确调价列表。
- 同一对象内的日常调价和活动目标价均作为限流候选，统一按分转元后取最小值；SKC/SPU 层再取下属有效 SKU 限流价的最小值。
- 限流价格不得使用供应价、当前申报价、声明价或产品管理货值兜底；没有明确值时保存为空并显示 `-`。
- 没有有效价格时保存为空，不使用 `0` 代替缺失值。
- SPU 汇总值仅用于查询和产品管理详情展示，不覆盖产品主档中的货值、成本及定价字段。
- 历史数据库字段 `lowest_review_price` 暂时保留以兼容已有数据库，对外统一映射为 `lowestSupplierPrice`。

## 4. 同步流程

1. 管理员在店铺档案页点击“同步生命周期”。
2. 服务端检查店铺浏览器会话状态，并创建生命周期同步批次。
3. Worker 在生命周期页面上下文中执行页面内 `fetch()`。
4. 每页请求必须携带 `secondarySelectStatusList: [12]`。
5. 读取 `result.dataList` 和 `result.total`，按 50 条分页串行请求。
6. 保存脱敏请求体和完整原始响应。
7. 写入同步批次、SPU、SKC、SKU 当前表，完整平台货号继续保留。
8. 批次完成后，以 `admin` 管理员身份幂等创建缺失的产品管理主档，并创建 SPU、SKC、SKU 绑定。
9. 自动建档货号取生命周期货号前两个分段；货值从第一段末尾数字解析，序列号从第二段数字解析，默认重量为 `0.3 KG`。
10. 产品管理页面不展示旧内部 ID；数据库旧列仅保留兼容。自动创建记录标记来源为 `lifecycle`，手工记录标记为 `manual`。
11. 总成本、推荐售价和利率门槛值由产品管理现有定价函数根据货值和当前设置实时计算；最低供应价不得替代货值。
12. 本轮不修正历史产品主档货号，只保证后续生命周期自动建档使用截断货号；手工主档及人工字段不覆盖。
12. 选择流量主图优先、生命周期主图兜底的 SPU 图片 URL；优先复用现有本地图片或已完成下载任务，相同 SPU 和 URL 不重复入队。
13. 同步失败不执行自动建档；后处理失败将批次标记为 `partial` 并保留生命周期当前数据。

## 5. 数据库表

- `temu_lifecycle_sync_batches`：同步批次、分页统计、状态和错误。
- `temu_lifecycle_raw_responses`：按批次及页码保存请求体、HTTP 状态和原始响应。
- `temu_lifecycle_spu_current`：店铺级 SPU 当前数据、主图 URL 及汇总价格。
- `temu_lifecycle_skc_current`：SPU 下的 SKC、货号、颜色/款式属性和价格。
- `temu_lifecycle_sku_current`：SKC 下的 SKU、货号、尺码/规格属性和价格。

所有表均通过 `shop_profile_id` 隔离店铺数据。

## 6. 产品管理关联

产品管理使用货号匹配生命周期数据：

1. 比较前去除货号空白并转大写。
2. 生命周期 SKC/SKU 货号取前两个 `-` 分段作为比较键。
3. 手工主档货号原值不修改；匹配时同时支持其标准化原值和生命周期截断比较值。
4. 先匹配 SKC 货号，没有 SKC 匹配时再匹配 SKU 货号。
5. 多个 SPU 命中时保留多 SPU 信息，不强行覆盖产品管理中的手工 SPU。
6. 没有匹配时返回稳定的未匹配结果。

产品管理主表继续保持现有记录结构，但隐藏“生命周期关联”和“SKC / SKU绑定”两列，并移除内部 ID 展示，改为显示持久化序列号。详情入口按 `SPU → SKC → SKU` 树形展示当前产品匹配分支，包括完整平台货号、截断展示货号、属性、最低供应价和限流价格。

SPU 限流定价：

- SPU 限流价格取该店铺、该 SPU 下全部 SKC 自身限流价和全部 SKU 限流价的有效最小值。
- 基于该最低限流价格计算限流利润率、限流建议折扣、限流最终折扣、限流活动价、限流流量价和限流 ROAS。
- 派生字段只在 SPU 层展示；SKC/SKU 继续正常展示原始限流价和属性。
- “限流 SKC”入口按需列出全部有效限流 SKC 及其 SKU，仅供运营人员人工判断。

产品管理列表显示偏好按用户保存在 `user_settings`，同一用户跨店铺共用；操作列固定显示。

产品管理列表支持以下服务端搜索：

- SPU、SKC、SKU 精确搜索；
- 货号模糊搜索，覆盖产品主档原货号、主档截断值及生命周期完整/截断货号；
- 每个输入框支持空格分隔多个关键词，同字段内使用 OR，不同字段之间使用 AND；
- 搜索继续受当前店铺、`mine`/`shop` 作用域和用户权限约束。

## 7. 接口

```text
POST /api/admin/temu-shops/:id/lifecycle/sync
GET  /api/admin/temu-shops/:id/lifecycle/sync/latest
POST /api/temu/lifecycle/sync
GET  /api/temu/lifecycle/latest
GET  /api/temu/lifecycle
GET  /api/product-management
GET  /api/product-management/columns
PUT  /api/product-management/columns
GET  /api/product-management/:id/traffic-limit-skcs?spu=...
```

店铺档案接口仅管理员可访问；产品管理和生命周期查询接口继续按当前登录用户的店铺权限隔离。

`GET /api/product-management` 在现有产品记录基础上返回 `lifecycleMatch`，并接受可选的 `spu`、`skc`、`sku`、`productCode` 查询参数。关键词由服务端按空白拆分，所有 SQL 条件使用参数绑定。

## 8. 验收标准

- 店铺档案页可以手动触发生命周期同步，并显示同步状态和 SPU/SKC/SKU 统计。
- 同步请求固定使用 `[12]`，后续分页不能遗漏。
- HTTP 和业务状态均成功后才保存有效批次。
- 店铺之间不能读取或覆盖生命周期数据。
- 生命周期完整平台货号和原始响应保留；自动建档及匹配货号按前两个分段处理。
- 批次完成后缺失产品管理主档由 `admin` 创建，重复同步不重复创建。
- 自动记录写入来源、货值、序列号和默认重量；页面不展示内部 ID，派生定价可正常计算。
- 已有手工产品管理主档的货号、重量、货值、备注、采购链接和人工定价不被覆盖。
- 本轮不修正历史产品主档货号；后续生命周期自动记录按截断货号写入货值和序列号。
- 自动创建记录包含生命周期 SPU 链接和完整 SKC/SKU 绑定。
- SKC 货号匹配优先于 SKU 货号匹配。
- 最低供应价取有效核价价最小值；限流价格读取 `suggestActivitySupplierPrice` / `targetSupplyPrice` 等明确调价字段，按分转元并取最小值，不使用供应价兜底。
- 流量主图优先、生命周期主图兜底；已有本地图片和相同 URL 任务可复用，不能重复下载。
- 产品管理主表隐藏内部关联列和内部 ID，详情按 SPU → SKC → SKU 展示匹配分支和价格缺失状态。
- SPU 层展示最低限流价格及限流利润率、折扣、活动价、流量价和 ROAS；限流 SKC 清单只用于人工判断。
- 列表显示偏好按用户保存并跨店铺共用。
- SPU/SKC/SKU 精确搜索及货号模糊搜索符合字段内 OR、字段间 AND，并保持店铺和作用域隔离。
- 同步失败不自动建档；后处理异常记录为 `partial`。
- 共享包、服务端和 Web 类型检查通过。
- 服务端 9 个测试文件、34 项测试全部通过。
