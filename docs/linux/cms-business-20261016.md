# JSON／XML CMS接口源 NAS 业务验收

生成时间：2026-10-16 08:52:58（Asia/Shanghai）

镜像：sha256:e8680fa72a2e8db9b9db8518ec970508946a16f8f30081a95f08f89d31e0429c。四份原配置；分类、搜索、详情和解析返回通过正式订阅会话调用。断网重放固定实际响应，并保留空值和HTTP/解析失败。

播放仅验证元数据；没有下载媒体。两种搜索签名在CMS协议中共享不分页搜索，不计作搜索第二页。

## primary-original-first-category

| 源 | 类型 | 非空 | 空 | HTTP失败 | 响应解析失败 | 未测试 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 电影天堂 | JSON | 7 | 2 | 0 | 0 | 1 |
| 非凡 | JSON | 7 | 2 | 0 | 0 | 1 |
| 索尼 | XML | 4 | 2 | 2 | 0 | 2 |
| 茅台采集 | XML | 5 | 1 | 0 | 2 | 2 |

断网重放完整 4/4，工具输入记录不足 0/4。完整重放的状态、参数和实际返回字节均相同；补测不覆盖原首分类结果。

### 电影天堂

| 步骤 | 结果 |
| --- | --- |
| home | nonempty |
| home-video | nonempty |
| category-page1 | empty |
| category-page2 | empty |
| category-filter | not-tested |
| detail | nonempty |
| search | nonempty |
| search-page1 | nonempty |
| search-detail | nonempty |
| player | nonempty |

### 非凡

| 步骤 | 结果 |
| --- | --- |
| home | nonempty |
| home-video | nonempty |
| category-page1 | empty |
| category-page2 | empty |
| category-filter | not-tested |
| detail | nonempty |
| search | nonempty |
| search-page1 | nonempty |
| search-detail | nonempty |
| player | nonempty |

### 索尼

| 步骤 | 结果 |
| --- | --- |
| home | nonempty |
| home-video | nonempty |
| category-page1 | empty |
| category-page2 | empty |
| category-filter | not-tested |
| detail | nonempty |
| search | network (CMS_HTTP_403) |
| search-page1 | network (CMS_HTTP_403) |
| search-detail | not-tested |
| player | nonempty |

### 茅台采集

| 步骤 | 结果 |
| --- | --- |
| home | nonempty |
| home-video | nonempty |
| category-page1 | nonempty |
| category-page2 | empty |
| category-filter | not-tested |
| detail | nonempty |
| search | invalid-response (CMS_INVALID_BODY) |
| search-page1 | invalid-response (CMS_INVALID_BODY) |
| search-detail | not-tested |
| player | nonempty |

## supplemental-category-from-real-recommendation

| 源 | 类型 | 非空 | 空 | HTTP失败 | 响应解析失败 | 未测试 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 电影天堂 | JSON | 9 | 0 | 0 | 0 | 1 |
| 非凡 | JSON | 9 | 0 | 0 | 0 | 1 |
| 索尼 | XML | 3 | 0 | 3 | 0 | 4 |
| 茅台采集 | XML | 6 | 0 | 0 | 2 | 2 |

断网重放完整 3/4，工具输入记录不足 1/4。完整重放的状态、参数和实际返回字节均相同；补测不覆盖原首分类结果。

索尼：在线在取得响应前发生网络失败，没有可冻结响应字节，现有按响应顺序的重放工具产生请求错配。该重放单列为工具输入不足，不计CMS源失败，也不计通过。

### 电影天堂

| 步骤 | 结果 |
| --- | --- |
| home | nonempty |
| home-video | nonempty |
| category-page1 | nonempty |
| category-page2 | nonempty |
| category-filter | not-tested |
| detail | nonempty |
| search | nonempty |
| search-page1 | nonempty |
| search-detail | nonempty |
| player | nonempty |

### 非凡

| 步骤 | 结果 |
| --- | --- |
| home | nonempty |
| home-video | nonempty |
| category-page1 | nonempty |
| category-page2 | nonempty |
| category-filter | not-tested |
| detail | nonempty |
| search | nonempty |
| search-page1 | nonempty |
| search-detail | nonempty |
| player | nonempty |

### 索尼

| 步骤 | 结果 |
| --- | --- |
| home | network |
| home-video | nonempty |
| category-page1 | not-tested |
| category-page2 | not-tested |
| category-filter | not-tested |
| detail | nonempty |
| search | network (CMS_HTTP_403) |
| search-page1 | network (CMS_HTTP_403) |
| search-detail | not-tested |
| player | nonempty |

### 茅台采集

| 步骤 | 结果 |
| --- | --- |
| home | nonempty |
| home-video | nonempty |
| category-page1 | nonempty |
| category-page2 | nonempty |
| category-filter | not-tested |
| detail | nonempty |
| search | invalid-response (CMS_INVALID_BODY) |
| search-page1 | invalid-response (CMS_INVALID_BODY) |
| search-detail | not-tested |
| player | nonempty |

## 验证边界

- Live errors and empty parent categories are retained; supplemental category IDs come from actual recommendation rows and the original class list.
- XML external entities/DOCTYPE/XInclude are disabled; general XStream equivalence and Android UI/cache async behavior remain unverified.
- Node HTTP transport does not implement Android hosts/proxy/DOH/cookie/client state.
- Local loopback /file/ ext has no implicitly bound NAS storage root.
- JAR compatibility remains paused; old full-JAR matrix belongs to the retained base image, not this new CMS image.

固定源码的JSON模型方法保持原实现；XML采用JDK DOM适配并拒绝外部实体，尚无实际ART同输入业务对照。不能据此宣称所有CMS源兼容或原版安卓完全等价。
