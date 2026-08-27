# 产品管理模块与生命周期解析优化计划

> 文档用途：持久化本次任务的完整规划、已确认决策、实施边界和验收标准，避免后续上下文压缩导致细节丢失。
>
> 当前阶段：全部计划功能、业务文档、构建检查、专项测试和真实数据库验证已完成。
>
> 计划范围：生命周期货号解析、价格口径修正、生命周期自动建档计算、产品管理详情展示、产品管理多关键词搜索、SPU 限流定价、限流 SKC 人工处理清单、用户列显示偏好、相关测试与文档更新。

## 1. 已确认的用户需求

### 1.1 生命周期货号

生命周期中的平台货号可能包含颜色、尺码等后缀，需要截断到第二个连字符之前的内容：

- `DY-189-green` → `DY-189`
- `Z38-Y22-junlv` → `Z38-Y22`

适用范围：

- 生命周期自动建档使用截断后的货号；
- 生命周期与产品管理匹配使用截断后的货号；
- 生命周期相关搜索使用截断后的货号；
- 生命周期原始响应仍完整保存，便于追溯；
- SKC/SKU 内部绑定仍保留平台原始 ID 和完整原始货号，不能因展示货号截断而丢失平台标识；
- 手工输入或编辑的产品管理主档货号不自动截断，必须原样保存。

### 1.2 最低供应价

最低供应价是供应商侧的采购成本价，不是平台售价，也不是限流价格。

最终业务口径：

- SKU 层：读取该 SKU 的供应商价格；
- SKC 层：取该 SKC 下所有 SKU 有效供应价的最小值；
- SPU 层：取该 SPU 下所有匹配 SKU 有效供应价的最小值；
- 产品详情中明确显示为“最低供应价”；
- 供应价不能作为限流价格的兜底值。

当前相关实现：

- [`lifecycleSupplierPrice()`](apps/server/src/temu-shops/traffic-sync-service.ts:324)
- [`storeLifecyclePage()`](apps/server/src/temu-shops/traffic-sync-service.ts:405)
- [`lifecycleMatchForProduct()`](apps/server/src/temu-shops/lifecycle-match-service.ts:121)

当前数据库历史字段 `lowest_review_price` 实际承载供应价语义。为避免破坏现有数据库，本次计划优先在服务端返回类型、详情展示和文档层面改为“最低供应价”；是否新增数据库列或迁移旧列，需要在实施时根据兼容成本决定，不能无迁移直接删除旧字段。

### 1.3 生命周期自动建档计算

生命周期同步完成后自动创建产品管理主档时，必须复用产品管理现有的货号解析和定价计算规则，不能直接写入空货值。

业务规则：

- 自动建档货号仍按生命周期规则取前两段；
- 自动建档货值从自动建档货号的第一段末尾提取数字；
- 自动建档序列号从自动建档货号的第二段提取数字；
- 旧内部产品 ID 数据库列仅保留兼容，不再作为产品管理展示字段；
- 自动建档默认重量继续使用 `0.3 KG`，除非后续有明确的生命周期重量字段和业务口径；
- 产品管理的总成本、推荐售价、利率门槛值等派生数据继续由 [`calculatePricing()`](apps/server/src/product-management/product-management-calculator.ts:31) 根据当前定价设置实时计算；
- 生命周期最低供应价是供应商采购成本分析值，不直接覆盖产品管理货值；
- 生命周期最低供应价没有有效值时，仍可根据货号规则计算货值；
- 货号无法提取货值时，货值保持为空，不能用最低供应价或 `0` 伪造货值；
- 已存在的手工产品主档不得被自动同步覆盖货值、重量、手工定价或其他人工维护字段；
- 自动创建的新主档必须能够在产品管理列表中显示货值、总成本、推荐售价和利率门槛值。

产品管理派生价格计算规则：

- 有效核价基准：优先使用“初次核价最低价”；该值为空时回退使用“核价价”。
- 核价利润率：`(有效核价基准 - 总成本) / 有效核价基准`。
- 建议折扣：根据核价利润率按现有分段规则计算。
- 最终折扣：优先使用人工设置的最终折扣；为空时使用建议折扣。
- 活动价：`有效核价基准 × 最终折扣`。
- 流量价：`活动价 ÷ 0.9`。
- ROAS：`1 / (核价利润率 - 1 + 最终折扣)`；当分母无效或为 `0` 时返回空值。
- 数据库历史 `roas` 字段继续保留兼容，但不再作为计算输入；列表和详情返回实时计算结果。

当前问题：

- [`autoCreateLifecycleProductRecords()`](apps/server/src/temu-shops/lifecycle-auto-service.ts:162) 新增记录时直接写入 `weight_kg = 0.3`、`goods_value = NULL`；
- 手工创建流程会调用 [`parseProductCode()`](apps/server/src/product-management/product-management-calculator.ts:21)，生命周期自动建档流程目前没有复用；
- 因货值为空，后续 [`calculatePricing()`](apps/server/src/product-management/product-management-calculator.ts:31) 无法计算总成本、推荐售价和利率门槛值。

实施要求：

1. 自动建档选择截断后的生命周期货号后，调用统一的货号解析函数；
2. 将解析得到的 `serialNumber` 和 `goodsValue` 写入新产品主档；
3. 保持手工货号原样保存规则不变；
4. 自动同步只填充新建主档，不覆盖已存在主档的人工字段；
5. 为自动建档补充货值、序列号和派生定价测试；
6. 按“初次核价最低价优先、核价价回退”的规则补充利润率、折扣、活动价、流量价和 ROAS 测试；
7. 本轮不修正历史产品主档货号；后续正式使用的新同步记录必须正确写入截断货号和序列号。

历史数据回填边界：

- 自动建档新记录：写入截断后的生命周期货号、解析得到的 `goods_value`、解析得到的 `internal_product_id` 和默认 `weight_kg = 0.3`；
- 已存在且可确认由生命周期自动创建的记录：仅在 `goods_value` 或 `internal_product_id` 为空时补齐对应字段；
- 已存在的手工记录：不得因为生命周期重新同步而修改货号、货值、重量、定价、备注、进货链接或其他人工字段；
- 已有记录的总成本、推荐售价、利率门槛值不单独落库，由产品管理读取时根据补齐后的货值和当前定价设置重新计算；
- SPU 派生字段读取时，初次核价最低价优先作为核价基准，初次核价最低价为空时使用核价价；
- 最终折扣优先使用人工设置值，为空时使用建议折扣；ROAS 按 `1 / (核价利润率 - 1 + 最终折扣)` 实时计算；
- 自动建档无法从货号第一段解析出数字货值时保持 `goods_value = NULL`，不能使用最低供应价替代；
- 回填完成后必须抽样核对主档货值、内部 ID、总成本、推荐售价、核价利润率、活动价、流量价和 ROAS。

### 1.4 限流价格

限流价格必须与最低供应价完全分离。

目标口径：

- 只读取明确表示调价建议或限流价格的字段；
- 生命周期列表真实字段为 `siteSupplierPriceList[].suggestActivitySupplierPrice` 和 `siteSupplierPriceList[].targetSupplyPrice`；
- `suggestActivitySupplierPrice` 对应页面“日常申报价调整为”的调价建议；`targetSupplyPrice` 对应活动申报价/目标供应价，页面如显示“按活动申报价报名活动”，也属于限流候选；
- 兼容顶层及调价列表中的 `suggestedPrice`、`trafficLimitPrice`、`limitPrice` 字段；
- 同一 SKU 的多个限流候选先取最小值，同一 SKC/SPU 的下属有效 SKU 再取最小值；
- 接口金额字段以“分”为单位，统一除以 `100` 后以元返回，例如 `4100` 为 `41.00 元`、`373` 为 `3.73 元`；
- 没有明确限流价格时保存为空并在页面显示 `-`；
- 不读取 `supplierPrice`、`supplierPriceValue`、`lowestSupplierPrice` 作为限流价格；
- 不使用当前申报价、声明价或其他无法确认语义的价格字段作为限流价格。

当前相关实现：

- [`lifecycleSuggestedPrice()`](apps/server/src/temu-shops/lifecycle-parser.ts:114)
- [`storeLifecyclePage()`](apps/server/src/temu-shops/traffic-sync-service.ts:362)
- [`lifecycleMatchForProduct()`](apps/server/src/temu-shops/lifecycle-match-service.ts:174)
- 参考真实调价脚本：[`生命周期获取限流脚本.txt`](third%20party/TEMUxieyi/%E7%94%9F%E5%91%BD%E5%91%A8%E6%9C%9F%E8%8E%B7%E5%8F%96%E9%99%90%E6%B5%81%E8%84%9A本.txt:1130)

### 1.5 产品管理详情展示

产品管理主表隐藏以下两列：

- “生命周期关联”；
- “SKC / SKU绑定”。

这些数据仅作为系统内部数据保留，不从数据库删除。

新增产品详情展示入口，使用详情面板按以下树形结构展示：

```text
SPU
└── SKC
    └── SKU
```

详情至少展示：

- SPU 编号；
- SPU 最低供应价；
- SPU 限流价格；
- SKC 编号和完整货号；
- SKC 颜色、款式属性；
- SKC 最低供应价；
- SKC 限流价格；
- SKU 编号和完整货号；
- SKU 尺码、规格属性；
- SKU 最低供应价；
- SKU 限流价格；
- 产品管理主档中的绑定关系和必要的匹配状态。

详情数据只展示当前产品记录关联或匹配到的生命周期分支，避免把整个店铺的生命周期数据返回给单条产品详情。

### 1.6 搜索

产品管理页新增四个搜索条件：

- SPU 精确搜索；
- SKC 精确搜索；
- SKU 精确搜索；
- 货号模糊搜索。

关键词规则已经确认：

- 每个搜索框支持以空格分隔多个关键词；
- 同一搜索字段内，多个关键词采用“任意命中”；
- 不同搜索字段之间采用“同时满足”；
- 空搜索字段不参与过滤；
- SPU、SKC、SKU 按标准化后的精确值匹配；
- 货号按模糊匹配；
- 生命周期货号匹配使用截断后的前两段货号；
- 手工主档货号原值不修改，但搜索匹配时同时支持其截断形式；
- 搜索必须继续遵守当前“我的数据 / 全店数据”作用域和店铺隔离。

示例：

- SPU 输入 `7074816364 8000000000`：命中任一 SPU；
- SKC 输入 `DY-189 Z38-Y22`：命中任一 SKC；
- 货号输入 `DY-189 green`：货号包含 `DY-189` 或 `green` 即命中；
- 同时填写 SPU 和 SKU 时：SPU 条件必须满足，SKU 条件也必须满足。

### 1.7 本轮产品管理列表与限流优化

产品主档字段：

- 产品管理主表和详情不再展示“内部 ID”；旧数据库列仅保留兼容。
- 新增持久化字段 `serial_number`，序列号取第一个 `-` 后、第二个 `-` 前分段中的数字。例如 `Z26-Y37-white` 为 `37`，`HB28-GY59` 为 `59`。
- 生命周期自动建档使用截断后的货号并写入序列号；手工新增或编辑时保留完整货号，同时根据完整货号解析并保存序列号。
- `source_type = manual | lifecycle` 继续作为系统内部来源标记。
- 本轮不修正或回填既有历史产品主档货号，只保证后续生命周期同步和自动建档应用正确截断规则。

SPU 限流定价：

- SPU 限流价格取该店铺、该 SPU 下全部 SKC 自身限流价和全部 SKU 限流价的有效最小值，不局限于当前产品货号匹配到的 SKC 分支。
- 以 SPU 最低限流价格作为独立核价基准，计算限流利润率、限流建议折扣、限流最终折扣、限流活动价、限流流量价和限流 ROAS。
- 限流最终折扣仍优先使用人工最终折扣，为空时使用根据限流利润率计算出的建议折扣。
- 限流 ROAS 使用 `1 / (限流利润率 - 1 + 限流最终折扣)`；分母无效或为 `0` 时返回空值。
- 限流派生结果只在 SPU 层显示，不给 SKC/SKU 增加派生定价字段，也不覆盖正常核价数据。

限流 SKC 人工处理清单：

- 产品管理操作区提供“限流 SKC”按钮，仅当当前 SPU 存在有效限流价格时显示。
- 按钮按需查询并展示该 SPU 下所有存在有效限流价格的 SKC，以及下属 SKU、完整货号、截断展示货号、属性和各自限流价格。
- 清单仅供 Temu 运营人员人工判断处理方式，不自动执行调价或活动操作。
- 只读用户也可查看详情和限流 SKC；编辑和删除仍受原权限约束。

列表常态显示设置：

- 用户可选择产品管理列表常态显示的业务列；操作列固定显示，内部 ID 不属于可选列。
- 偏好使用 `user_settings` 保存，键为 `product_management_columns`。
- 偏好按用户隔离，同一用户在所有店铺共用一套设置。
- 默认显示全部受支持业务列，用户可恢复全部显示。

## 2. 当前实现基线

### 2.1 生命周期数据链路

当前生命周期数据由浏览器 Worker 查询并由服务端分层入库：

- Worker 查询已发布到站点的数据，筛选固定为 `secondarySelectStatusList: [12]`；
- 原始响应保存到 `temu_lifecycle_raw_responses`；
- SPU 当前快照保存到 `temu_lifecycle_spu_current`；
- SKC 当前快照保存到 `temu_lifecycle_skc_current`；
- SKU 当前快照保存到 `temu_lifecycle_sku_current`；
- 产品管理主档位于 `product_management_records`；
- SPU 链接位于 `product_management_spu_links`；
- SKC/SKU 绑定位于 `product_management_bindings`。

主要文件：

- [`traffic-sync-service.ts`](apps/server/src/temu-shops/traffic-sync-service.ts)
- [`lifecycle-auto-service.ts`](apps/server/src/temu-shops/lifecycle-auto-service.ts)
- [`lifecycle-match-service.ts`](apps/server/src/temu-shops/lifecycle-match-service.ts)
- [`product-management-service.ts`](apps/server/src/product-management/product-management-service.ts)
- [`ProductManagementPage.tsx`](apps/web/src/pages/ProductManagementPage.tsx)
- [`client.ts`](apps/web/src/api/client.ts)
- [`api.ts`](apps/server/src/routes/api.ts)
- [`index.ts`](packages/shared/src/index.ts)

### 2.2 实施前识别的问题

1. [x] 生命周期完整 `extCode` 保留入库，展示、自动建档和匹配统一使用前两个分段。
2. [x] 自动建档应用统一截断规则，并解析货值和内部产品 ID。
3. [x] 生命周期匹配可稳定比较手工主档原货号和生命周期截断货号。
4. [x] `siteSupplierPriceList` 收集全部有效供应价后取最小值。
5. [x] 数据库列 `lowest_review_price` 继续兼容，对外统一映射为 `lowestSupplierPrice`。
6. [x] 产品管理主表隐藏“生命周期关联”和“SKC / SKU绑定”，详情改用树形面板。
7. [x] 产品管理增加 SPU、SKC、SKU、货号搜索条件。
8. [x] 产品管理接口接收搜索参数，并在权限范围内执行参数化服务端过滤。
9. [ ] [`lifecycleMatchForProduct()`](apps/server/src/temu-shops/lifecycle-match-service.ts:174) 仍可能对产品列表形成 N+1 查询；本次保证功能正确，后续单独做批量匹配性能优化。
10. [x] 共享类型已提供 SPU → SKC → SKU 树形详情数据契约。

## 3. 目标数据模型与兼容策略

### 3.1 货号字段分工

| 数据用途 | 使用值 | 是否截断 |
|---|---|---:|
| 生命周期原始响应 | 原始 `extCode` | 否 |
| 生命周期内部平台绑定 | 原始 SKC/SKU ID，必要时保留完整 `extCode` | 否 |
| 生命周期展示货号 | 截断后的货号 | 是 |
| 生命周期自动建档货号 | 截断后的货号 | 是 |
| 生命周期与产品管理匹配 | 截断后的货号 | 是 |
| 手工产品管理主档保存 | 用户输入原值 | 否 |
| 产品管理货号搜索 | 主档原值和其截断形式均参与 | 比较时是 |

建议新增可复用的货号工具函数，例如：

- `truncateLifecycleProductCode(value)`：取前两段，清理空白和空段；
- `normalizeProductCode(value)`：去空白并转大写；
- `lifecycleProductCodeKey(value)`：先截断，再标准化。

工具函数应放在服务端可复用位置，避免 [`traffic-sync-service.ts`](apps/server/src/temu-shops/traffic-sync-service.ts) 、[`lifecycle-auto-service.ts`](apps/server/src/temu-shops/lifecycle-auto-service.ts) 和 [`lifecycle-match-service.ts`](apps/server/src/temu-shops/lifecycle-match-service.ts) 各自复制不同规则。

### 3.2 价格字段分工

建议对外详情类型明确拆分：

- `lowestSupplierPrice`：最低供应价；
- `trafficLimitPrice`：限流价格。

对于历史 `lowest_review_price`：

- 短期保持数据库兼容；
- 读取时映射为 `lowestSupplierPrice`；
- 写入时继续写入兼容列，除非增加迁移列并完成历史回填；
- 页面、共享类型、文档不得继续使用“最低核价”描述该字段。

如实施阶段决定增加新列，必须同时完成：

1. 数据库迁移；
2. 历史数据回填；
3. 新旧字段读取兼容；
4. 新字段写入；
5. 回填后真实数据库校验。

## 4. 实施阶段与任务清单

### 阶段 A：共享类型设计

目标：让前后端拥有稳定的详情数据契约。

修改 [`packages/shared/src/index.ts`](packages/shared/src/index.ts:431)：

1. 保留现有产品管理基础类型的兼容性。
2. 将生命周期匹配结果扩展为可承载 SPU → SKC → SKU 层级详情。
3. 新增或调整以下概念字段：
   - SPU 详情；
   - SKC 详情；
   - SKU 详情；
   - 完整货号和展示货号；
   - SKC 属性；
   - SKU 属性；
   - `lowestSupplierPrice`；
   - `trafficLimitPrice`。
4. 明确匹配类型仍为 `skc`、`sku`、`none`。
5. 让详情结构只返回当前匹配分支，控制响应体大小。
6. 构建共享包，确保 [`packages/shared/dist/index.d.ts`](packages/shared/dist/index.d.ts) 同步更新。

### 阶段 B：生命周期解析和入库

修改 [`apps/server/src/temu-shops/traffic-sync-service.ts`](apps/server/src/temu-shops/traffic-sync-service.ts:288)：

1. 抽取统一生命周期货号截断函数。
2. 对 SPU 的 `product_code` 处理应用生命周期截断规则。
3. 对 SKC/SKU 的展示或匹配货号应用截断规则，同时保留完整原始值或平台 ID。
4. 修正嵌套供应价列表解析：收集全部有效值后取最小值，而不是返回第一个值。
5. 保证直接供应价字段和嵌套供应价字段都只参与最低供应价计算。
6. 明确限流价格解析函数只读取调价/限流字段。
7. 处理空值、非数字、负数、带货币符号和字符串数字。
8. 确认 SPU、SKC、SKU 汇总价格的最小值计算不把供应价和限流价格混用。
9. 保持原始请求和响应归档逻辑不变。
10. 用当前数据库已保存的真实生命周期响应重新处理批次，确认历史数据得到正确回填。

### 阶段 C：自动建档和匹配

修改 [`apps/server/src/temu-shops/lifecycle-auto-service.ts`](apps/server/src/temu-shops/lifecycle-auto-service.ts:79)：

1. 自动建档选择第一条稳定排序的生命周期货号。
2. 自动建档货号使用截断后的前两段值。
3. 查找已有产品主档时同时比较：
   - 手工主档原始货号标准化值；
   - 手工主档截断后的生命周期比较值。
4. 未修改手工主档原值，避免破坏人工维护数据。
5. 保持 `admin` 作为自动创建者。
6. 保持产品主档、SPU 链接、SKC/SKU 绑定幂等。
7. 保持图片复用逻辑，不因本次货号优化重复创建图片任务。

修改 [`apps/server/src/temu-shops/lifecycle-match-service.ts`](apps/server/src/temu-shops/lifecycle-match-service.ts:121)：

1. 匹配目标先生成手工货号的标准化原值和截断值。
2. 生命周期 SKC/SKU 使用截断后的比较键。
3. 保持 SKC 优先、SKU 兜底。
4. 返回层级详情而不只返回字符串数组。
5. 精确搜索和单条产品匹配共用相同的货号标准化规则。
6. 最低供应价从所有匹配 SKU 价格中取最小值。
7. 限流价格从所有匹配层级的明确限流值中取最小值，永不使用供应价兜底。
8. 对没有匹配结果、多个 SPU、空属性和空价格保持稳定返回。

### 阶段 D：服务端产品管理搜索

修改 [`apps/server/src/product-management/product-management-service.ts`](apps/server/src/product-management/product-management-service.ts:223) 和 [`apps/server/src/routes/api.ts`](apps/server/src/routes/api.ts:241)：

1. 为产品管理列表增加可选搜索参数：
   - `spu`；
   - `skc`；
   - `sku`；
   - `productCode`。
2. 在路由层解析并限制参数长度，避免异常超长查询。
3. 按空白字符拆分关键词，过滤空值。
4. 每个字段内部使用 OR：任一关键词命中即可。
5. 不同字段之间使用 AND：所有已填写字段都必须命中。
6. SPU 使用精确匹配。
7. SKC 使用精确匹配。
8. SKU 使用精确匹配。
9. 货号使用模糊匹配。
10. 货号模糊匹配覆盖产品管理主档货号以及生命周期关联货号。
11. 所有 SQL 使用参数绑定，禁止拼接用户输入。
12. 过滤必须在当前店铺和当前作用域条件之后执行，不能绕过权限。
13. 评估使用 EXISTS、临时匹配集合或一次性聚合查询，避免每条记录重复扫描全部生命周期数据。
14. 保持创建、更新、删除接口的手工货号原样保存逻辑不变。

建议服务端内部查询语义：

```text
scope condition
AND (SPU keyword 1 OR SPU keyword 2 ...)
AND (SKC keyword 1 OR SKC keyword 2 ...)
AND (SKU keyword 1 OR SKU keyword 2 ...)
AND (product code keyword 1 LIKE ... OR product code keyword 2 LIKE ...)
```

未填写的条件不生成对应 SQL 子句。

### 阶段 E：前端产品管理页面

修改 [`apps/web/src/pages/ProductManagementPage.tsx`](apps/web/src/pages/ProductManagementPage.tsx:122)：

1. 增加搜索表单状态：SPU、SKC、SKU、货号。
2. 搜索输入框提示支持空格分隔多个关键词。
3. 增加查询按钮。
4. 增加重置按钮。
5. 切换“我的数据 / 全店数据”时保留搜索条件并重新请求。
6. 页面首次进入时使用现有管理员默认全店、普通用户默认我的数据逻辑。
7. 从表格列中移除“生命周期关联”。
8. 从表格列中移除“SKC / SKU绑定”。
9. 增加“详情”按钮。
10. 使用详情面板展示 SPU → SKC → SKU 树形数据。
11. 详情中新增并明确显示“最低供应价”。
12. 限流价格为空时显示 `-`。
13. 详情中展示完整平台货号，主表中的产品管理货号保持原样。
14. 详情中对属性 JSON 做稳定的人类可读格式化，避免 `[object Object]`。
15. 详情面板仅展示当前行产品的生命周期匹配数据。
16. 列表中的核价利润率、建议折扣、最终折扣、活动价、流量价和 ROAS 使用统一实时计算结果。
17. ROAS 输入改为只读提示，不允许人工值覆盖计算结果。
18. 保留编辑、删除、只读权限显示。
19. 调整表格横向滚动宽度，使隐藏两列后的主表更紧凑。

推荐详情组件结构：

```text
Modal 或 Drawer
└── SPU 节点
    ├── SPU 基础信息
    ├── 最低供应价
    ├── 限流价格
    └── SKC 列表
        └── SKC 节点
            ├── SKC 货号
            ├── 颜色/款式属性
            ├── 最低供应价
            ├── 限流价格
            └── SKU 列表
                ├── SKU 货号
                ├── 尺码/规格属性
                ├── 最低供应价
                └── 限流价格
```

### 阶段 F：客户端 API 和共享构建

修改 [`apps/web/src/api/client.ts`](apps/web/src/api/client.ts:139)：

1. 为 `getProductManagementRecords()` 增加可选搜索参数对象。
2. 保持现有调用兼容，或统一调整页面调用点。
3. 对空搜索参数不发送无意义字段。
4. 保持返回值使用共享类型。
5. 检查不存在重复导出或重复函数实现。

### 阶段 G：测试

新增或扩展测试，优先避免依赖线上浏览器和真实 Temu 页面。

建议新增测试文件：

- [`apps/server/src/temu-shops/lifecycle-parser.test.ts`](apps/server/src/temu-shops/lifecycle-parser.test.ts)
- [`apps/server/src/temu-shops/lifecycle-match-service.test.ts`](apps/server/src/temu-shops/lifecycle-match-service.test.ts)
- [`apps/server/src/product-management/product-management-service.test.ts`](apps/server/src/product-management/product-management-service.test.ts)

测试范围：

#### 货号测试

- `DY-189-green` 截断为 `DY-189`；
- `Z38-Y22-junlv` 截断为 `Z38-Y22`；
- 两段货号保持不变；
- 单段货号保持不变；
- 空段、空白和异常货号安全处理；
- 手工主档完整货号保存不被修改；
- 手工完整货号可以匹配生命周期截断货号。

#### 价格测试

- 直接 `lowestSupplierPrice` 正确读取；
- `supplierPriceValue` 和 `supplierPrice` 兼容读取；
- `siteSupplierPriceList` 全部有效价格取最小值；
- 无供应价返回空值；
- 有供应价但无调价建议时限流价格仍为空；
- `suggestedPrice`、`trafficLimitPrice`、`limitPrice` 正确读取；
- 多个 SKU 限流价格取最小值；
- 供应价不会污染限流价格；
- 页面/API 对外显示名称为“最低供应价”；
- 初次核价最低价优先作为核价基准，空值时回退核价价；
- 最终折扣优先、建议折扣回退，活动价、流量价和 ROAS 按统一公式计算。

#### 匹配测试

- SKC 货号匹配优先于 SKU 货号；
- 无 SKC 匹配时使用 SKU 货号兜底；
- 多个空格和大小写标准化正确；
- 返回 SPU → SKC → SKU 层级详情；
- 属性 JSON 能被稳定解析；
- 匹配结果只包含目标产品关联分支。

#### 搜索测试

- SPU 单关键词精确命中；
- SPU 多关键词任意命中；
- SKC 多关键词任意命中；
- SKU 多关键词任意命中；
- 货号多关键词任意模糊命中；
- 不同字段同时填写时使用 AND；
- 空字段不影响结果；
- 当前店铺不能搜到其他店铺数据；
- `mine` 作用域不能搜到他人创建记录；
- `shop` 作用域可按权限查看全店记录；
- 用户输入不会导致 SQL 注入或语句错误。

#### 页面测试或人工验收

- 主表不再显示“生命周期关联”和“SKC / SKU绑定”；
- 点击详情后能看到层级树；
- 详情能看到最低供应价；
- 限流价格无值显示 `-`；
- 搜索输入框支持空格分隔关键词；
- 派生价格使用初次核价最低价优先、核价价回退；
- ROAS 使用最终折扣，最终折扣为空时使用建议折扣，并按指定公式计算。
- 查询、重置、作用域切换行为正确；
- 普通用户和管理员权限表现不变。

### 阶段 H：文档和真实数据验证

更新：

- [`temu-lifecycle-query-plan.md`](packages/shared/docs/temu-lifecycle-query-plan.md:26)
- [`生命周期数据内容表格规划.md`](packages/shared/docs/生命周期数据内容表格规划.md:1)

文档必须说明：

1. 最低供应价的定义；
2. 限流价格的定义和禁止供应价兜底；
3. 生命周期货号截断规则；
4. 手工产品主档货号不截断；
5. SPU → SKC → SKU 详情展示；
6. 空格多关键词、字段内 OR、字段间 AND；
7. 店铺和作用域隔离。

真实数据验证：

1. 使用已保存的真实生命周期原始响应，不要求用户重新提供数据；
2. 重新处理已有批次，验证货号、供应价、限流价格和主图不被破坏；
3. 检查产品管理自动建档数量是否异常增加；
4. 检查完整手工货号没有被更新或截断；
5. 检查生命周期匹配结果；
6. 检查详情数据中的最低供应价和限流价格；
7. 抽样检查 `DY-189-green`、`Z38-Y22-junlv` 等类似货号；
8. 核对真实列表的 `suggestActivitySupplierPrice`、`targetSupplyPrice` 与页面“日常申报价调整为/按活动申报价报名活动”的对应关系及分转元结果。

## 5. 验证命令

实施完成后按 Windows 当前工作区环境分别执行，避免 CMD 下命令串联参数污染：

```text
npm run build -w @temu-analytics/shared
npm run typecheck -w @temu-analytics/server
npm run typecheck -w @temu-analytics/web
npm run test -w @temu-analytics/server -- --run
python -m py_compile apps/browser-worker/worker.py apps/browser-worker/traffic_query.py
```

如需要真实批次回填，使用现有工具：

```text
npx tsx tools/reprocess-lifecycle-batch.ts
node tools/check-lifecycle-database.mjs
```

验证重点：

- TypeScript 无类型错误；
- Web 无重复函数或共享类型错误；
- 既有测试全部通过；
- 新增生命周期专项测试全部通过；
- Python 文件可编译；
- 数据库批次状态、SPU/SKC/SKU 数量、产品主档和图片任务无异常变化。

## 6. 不在本次范围内的事项

以下内容本次不主动扩展：

- 不修改手工产品主档货号的保存值；
- 不删除生命周期原始响应；
- 不删除完整 SKC/SKU 平台 ID；
- 不重新设计生命周期 Worker 查询接口；
- 不改变已发布到站点筛选 `[12]`；
- 不额外保存生命周期图片明细表；
- 不改变流量图片优先、生命周期图片兜底的图片策略；
- 不把生命周期价格直接写入产品管理主档的成本或售价字段；
- 不在没有真实字段依据时猜测新的限流价格字段；
- 不为了本次搜索功能重构整个产品管理数据库。

## 7. 实施注意事项

1. 先读取最新文件内容再做补丁，避免重复补丁造成重复函数、重复字段或括号错误。
2. 货号工具函数必须只有一个权威实现，服务端各模块复用同一规则。
3. 任何历史数据库字段改名都必须保留迁移兼容，不得只改 TypeScript 类型。
4. 价格字段必须使用 `null` 表示缺失，不能用 `0` 伪造有效价格。
5. 产品管理派生定价必须优先使用初次核价最低价，空值才回退到核价价。
6. 最终折扣优先于建议折扣；ROAS 使用最终折扣并按指定公式计算，旧数据库 `roas` 仅兼容保留。
7. 限流价格解析必须有测试证明不会从供应价字段兜底，并覆盖 `suggestActivitySupplierPrice`、`targetSupplyPrice` 及分转元。
8. 搜索 SQL 必须使用参数化绑定。
9. 产品管理搜索不得绕过 `shop_profile_id` 和 `mine/shop` 作用域条件。
8. 详情数据量较大时优先考虑后端按产品返回匹配分支，避免前端重复加载整个生命周期列表。
9. 产品管理当前存在生命周期匹配潜在 N+1 查询，实施搜索时应尽量通过一次性候选集合或批量匹配降低额外开销。
10. 完成修改后必须重新构建共享包，否则 Web 可能继续读取旧的声明文件。
11. 真实数据库验证只允许使用已保存的响应和现有工具，不能破坏当前有效批次。
12. 如果发现真实响应中仍无法确认限流字段，应保留为空并记录问题，不得用供应价替代；已确认的 `suggestActivitySupplierPrice` 和 `targetSupplyPrice` 必须按限流候选处理。

## 8. Code 模式交接顺序

用户批准本计划后，切换到 Code 模式，按以下顺序执行：

1. 读取并确认本计划和所有目标文件的最新内容；
2. 完成共享类型调整；
3. 完成统一货号和价格解析；
4. 完成自动建档和生命周期匹配调整；
5. 完成产品管理服务端搜索；
6. 完成客户端 API 调整；
7. 完成产品管理页面搜索和详情面板；
8. 添加专项测试；
9. 更新生命周期文档；
10. 运行构建、类型检查、测试和 Python 检查；
11. 使用真实生命周期原始响应做数据库回填和验证；
12. 汇总变更文件、验证结果和任何保留的兼容说明。

## 9. 当前决策状态

已确认：

- [x] 手工产品主档货号不自动截断；
- [x] 生命周期自动建档货号按第二个连字符截断；
- [x] 生命周期匹配货号按截断值比较；
- [x] 产品详情新增最低供应价；
- [x] 限流价格与供应价彻底分离；
- [x] 隐藏“生命周期关联”和“SKC / SKU绑定”两列；
- [x] 使用 SPU → SKC → SKU 详情面板树形展示；
- [x] SPU、SKC、SKU、货号均支持空格分隔多个关键词；
- [x] 同一字段内任意命中；
- [x] 不同搜索字段同时满足；
- [x] 继续遵守店铺隔离和我的数据/全店数据作用域；
- [x] 需要保存本计划文档，作为后续上下文压缩后的任务依据。

实施进度：

- [x] 统一货号解析和匹配工具；
- [x] 修正供应价和限流价格解析；
- [x] 扩展共享详情类型；
- [x] 实现生命周期自动建档货值、内部 ID 回填和派生定价验证；
- [x] 实现服务端搜索；
- [x] 实现详情面板；
- [x] 补充专项测试，服务端 9 个测试文件、34 项测试通过；
- [x] 更新业务文档；
- [x] 共享包和服务端正式构建通过，Web 类型检查通过；
- [x] 浏览器 Worker 与生命周期查询 Python 文件编译检查通过；
- [x] 使用店铺 `1`、批次 `3` 的已保存真实响应完成回填，批次保持 `completed`，数据量保持 `133 SPU / 432 SKC / 2111 SKU`；
- [x] 生命周期来源主档共 `129` 条，空货值由 `129` 条降至 `6` 条；剩余货号第一段没有可解析末尾数字，按规则保持空值；
- [x] 唯一手工主档货号、货值、内部产品 ID 和重量保持不变，自动回填未覆盖手工数据；
- [x] 产品主档保持 `130` 条、SPU 链接 `133` 条、SKU 绑定 `2111` 条，无重复货号组和异常增长；
- [x] 真实响应中的 `133 SPU / 432 SKC / 2111 SKU` 均解析出最低供应价；修正后 `734` 条 SKU、`164` 条 SKC、`44` 条 SPU 写入限流价格，均按接口分值除以 `100` 转为元；
- [x] 同一对象内同时存在日常调价和活动目标价时取较小值，未使用供应价字段兜底；
- [x] 真实服务抽样验证 SPU/SKC/SKU 精确搜索、货号模糊搜索、字段内 OR、字段间 AND 和 SPU → SKC → SKU 树形详情均正常；
- [x] 定价计算已统一为初次核价最低价优先、核价价回退，最终折扣优先、建议折扣回退，并按指定公式计算 ROAS；定价专项测试 4 项通过。
- [x] 产品主档新增序列号持久化；生命周期自动建档和手工新增/编辑均写入序列号，页面已移除内部 ID 展示。
- [x] SPU 层按全部 SKC/SKU 有效限流价格取最小值，并实时计算限流利润率、折扣、活动价、流量价和 ROAS。
- [x] 新增限流 SKC 人工处理抽屉，SKC/SKU 保持原生命周期展示，不增加派生定价。
- [x] 新增按用户保存、跨店铺共用的产品管理列表列显示偏好。
- [x] 本轮明确不处理历史产品主档货号修正，只保证后续同步链路正确。
