# 真实 JS 的原版 Android 与 NAS 同参数验证

生成时间：2026-10-16 07:05:08（Asia/Shanghai）

固定三个配置源，代码与规则冻结，业务请求在线。API、key、ext 保留原值；仅覆盖记录的有限参数。原版 APK 未修改，独立同证书 instrumentation 运行在应用 UID。

启动前先初始化官方 ApiConfig 单例及本地默认配置，再创建官方 JsLoader/JsSpider，避免首次网络请求才触发清理当前实例；此步骤未请求订阅或 JAR 加载。

| 状态 | ART | NAS 原参数重放 |
| --- | ---: | ---: |
| nonempty | 25 | 25 |
| empty | 3 | 3 |
| not-implemented | 0 | 0 |
| invalid-json | 0 | 0 |
| network | 0 | 0 |
| failed | 0 | 0 |
| timeout | 0 | 0 |
| not-tested | 2 | 2 |

## 虎牙js

| 步骤 | ART | NAS | 同参数比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-params-same-json |
| home-video | nonempty | nonempty | same-params-live-response-difference |
| category-page1 | nonempty | nonempty | same-params-live-response-difference |
| category-page2 | nonempty | nonempty | same-params-live-response-difference |
| category-filter | nonempty | nonempty | same-params-live-response-difference |
| detail | nonempty | nonempty | same-params-same-json |
| search | nonempty | nonempty | same-params-live-response-difference |
| search-page1 | nonempty | nonempty | same-params-live-response-difference |
| search-detail | nonempty | nonempty | same-params-same-json |
| player | nonempty | nonempty | same-params-same-json |

ART 播放解析：nonempty，parse=1，URL 与输入 ID 相同（透传）。

NAS 播放解析：nonempty，parse=1，URL 与输入 ID 相同（透传）。

## 斗鱼js

| 步骤 | ART | NAS | 同参数比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-params-same-json |
| home-video | nonempty | nonempty | same-params-same-json |
| category-page1 | nonempty | nonempty | same-params-same-json |
| category-page2 | nonempty | nonempty | same-params-live-response-difference |
| category-filter | nonempty | nonempty | same-params-live-response-difference |
| detail | nonempty | nonempty | same-params-same-json |
| search | empty | empty | same-params-same-json |
| search-page1 | empty | empty | same-params-same-json |
| search-detail | not-tested | not-tested | not-tested |
| player | nonempty | nonempty | same-params-same-json |

ART 播放解析：nonempty，parse=1，URL 与输入 ID 相同（透传）。

NAS 播放解析：nonempty，parse=1，URL 与输入 ID 相同（透传）。

## dr_兔小贝

| 步骤 | ART | NAS | 同参数比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-params-same-json |
| home-video | empty | empty | same-params-same-json |
| category-page1 | nonempty | nonempty | same-params-live-response-difference |
| category-page2 | nonempty | nonempty | same-params-live-response-difference |
| category-filter | not-tested | not-tested | not-tested |
| detail | nonempty | nonempty | same-params-same-json |
| search | nonempty | nonempty | same-params-same-json |
| search-page1 | nonempty | nonempty | same-params-same-json |
| search-detail | nonempty | nonempty | same-params-same-json |
| player | nonempty | nonempty | same-params-same-json |

ART 播放解析：nonempty，parse=1，返回 URL 异于输入 ID或未提供。

NAS 播放解析：nonempty，parse=1，返回 URL 异于输入 ID或未提供。

实际同参数重放 28 次；JSON 语义相同 18 次，在线响应不同 10 次，状态不同 0 次。在线差异需要结合时间、网络和上游响应判因，不能单独归为核心缺陷。

播放仅验证 playerContent 返回。parse=1 或 URL 原样透传都不能称为已解析出媒体，更没有验证播放器。空搜索是本次真实观察；缺少真实参数的步骤保持未测试。

初轮因 AOSP/Node 斜线转义的输入哈希差异被采集器拒绝，且直接 loader 的启动上下文不完整；三条原始日志与状态记录保留，不能计为脚本或核心失败。修正后另起完整新一轮，没有改写旧结果。
