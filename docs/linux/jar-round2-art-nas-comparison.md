# 原始角色 ART / NAS 第二轮对照 — 2026-10-15

在第一轮完整同版本基线之后，按冻结的完整签名、实际 ext 和原主包关联选择 25 个 SHA。21 份有可执行的原上下文，形成 23 个 case；另 2 份原主包未取得、2 份只有辅助包无原 CSP，列入未执行。未穷举的其他变体保留在私有计划中，没有改成空 ext。

原版 APK SHA `5fb63e49…`、Android 11 / API30 ARM64，23 个 case 均加载、初始化成功。每次进程冷启动并检查 `pm clear` 成功，执行 UID10166。NAS 同一修复前最终镜像 `f2f6208a…` 逐 case 新建 runtime 和数据目录，复用安卓实际调用参数；23 个输入/结果均完整配对。官方版本 d5f5006 与固定源码 ab11d289 的差异继续单列。

NAS 8 个 case 有加载成功证据、6 个 ready；12 个明确未成功加载（其中 2 个同时有网络错误，原因仍未知），3 个加载未观察到完成。不能把网络错误、超时、缺测等同于引擎不兼容。

ART 共实际调用 61 次方法；两端成对成功 JSON 为 9 次，7 次字节和语义一致、2 次业务响应不同；3 次双方返回无效 JSON，均不计通过；45 次未在 NAS 重放到对应方法，4 次执行/返回状态差异待判因。该选集刻意偏向失败，既不是全部制品比例，也不是业务成功率。

| Case | JAR SHA 前12位 | 原角色 | ART init | NAS load观测 | NAS init | 观测 |
| --- | --- | --- | --- | --- | --- | --- |
| 0-0 | d8517c4cac6e | main | ready | failed | not-reached | init-difference-needs-diagnosis |
| 1-0 | 65be8df8bfa6 | main | ready | failed | not-reached | init-difference-needs-diagnosis |
| 2-0 | 19ca20400ffa | site | ready | failed | unknown | unknown-execution |
| 3-0 | a9dce1158db8 | main | ready | failed | not-reached | init-difference-needs-diagnosis |
| 4-0 | 59ca73d4d127 | site | ready | failed | failed | init-difference-needs-diagnosis |
| 5-0 | 41d3771d1d06 | site | ready | unobserved | unknown | unknown-execution |
| 6-0 | 8adcedbd51c3 | main | ready | loaded | failed | init-difference-needs-diagnosis |
| 7-0 | 2ff484674c51 | main | ready | failed | not-reached | init-difference-needs-diagnosis |
| 8-0 | cf928d087302 | main | ready | failed | not-reached | init-difference-needs-diagnosis |
| 9-0 | ee9ff15d1093 | main | ready | unobserved | unknown | unknown-execution |
| 10-0 | a41f11e12267 | main | ready | failed | not-reached | init-difference-needs-diagnosis |
| 11-0 | 76c7d225a47b | site | ready | failed | failed | init-difference-needs-diagnosis |
| 12-0 | 92b6747fd42c | site | ready | failed | failed | init-difference-needs-diagnosis |
| 13-0 | 713a2c84b270 | main | ready | unobserved | unknown | unknown-execution |
| 14-0 | b644dc3adc5f | main | ready | loaded | ready | same-successful-or-failed-behavior |
| 15-0 | 0e0158a66f88 | main | ready | loaded | ready | same-successful-or-failed-behavior |
| 15-1 | 0e0158a66f88 | main | ready | loaded | ready | live-response-difference |
| 16-0 | ed56f35b6794 | site | ready | failed | failed | init-difference-needs-diagnosis |
| 17-0 | 6db260446185 | site | ready | failed | unknown | unknown-execution |
| 18-0 | 62aec35b3a4c | site | ready | loaded | failed | init-difference-needs-diagnosis |
| 19-0 | d8982109de0b | site | ready | loaded | ready | method-results-need-diagnosis |
| 20-0 | 0e622ce7b053 | main | ready | loaded | ready | same-successful-or-failed-behavior |
| 20-1 | 0e622ce7b053 | main | ready | loaded | ready | method-results-need-diagnosis |

ART 的站点加载与初始化分别限 90 秒和 10 秒；NAS 现有接口把两者合并为一次 90 秒请求。两边总 case 预算都是 150 秒、方法 10 秒；超时阶段不可直接作为相同根因的证明。site 的 load/init 组合入口未 ready，不证明第三方 init 方法已经执行。业务响应未冻结，必须从同参数、实际异常和独立用例继续判因。

目前已确认南风 native 构造器的 JVM 格式阻断，并补了未支持边界的自有用例；没有用空构造器绕过。Wogg 缺失 ZXing 已按原版 3.3.0 加入真实库，在新镜像 `808d15d8…` 原参数定点复测初始化成功，空首页返回与 ART 字节一致；这项单独修复结果不覆盖本表的旧镜像观测。

PanConfig 本轮分类页双方各返回 12 条列表记录，12 个图片字段、2 个状态字段和 1 个详情内容字段不同；首页字节一致。生成图像和状态差异未通过删字段变成完全一致。

23 个 NAS 容器均退出并移除，但 case16-0 的 worker 关闭检查失败；已被最终退出/删除的容器收束，仍保留为生命周期失败。第一轮 228 个 worker 的清理成功与本轮这项失败分别报告。

固定源码方法 ART 探针已完成：5 个隔离自有绑定用例及 3 份冻结 JAR 字节扫描均通过。缺 `DexNative` 时，固定方法返回 false、官方方法返回 true；三个 JAR 的双方扫描均为 protected。固定源码只作已记录的命名空间与真实 Application 绑定适配，方法正文未改。这是实际版本合同证据；没有对第三方 JAR 的具体绑定分支做动态计数。

最初两次探针因 ADB 推送到外部存储后的应用可读性校验失败，扫描方法未运行，整轮没有计通过；两次失败记录均保留。第三次改为任务专用内部应用目录，先以目标 UID 校验每个文件哈希，再由普通应用 UID 执行，完整通过。

native loader、实例原生构造器、DEX 验证/转换、主站包共存、超时和未补业务方法仍为后续工作。播放器继续后置。
