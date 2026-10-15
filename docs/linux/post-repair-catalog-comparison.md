# JAR 修复后同输入全量对照

采集 2026-10-15T07:04:10.843Z，114 份同字节制品。旧、新镜像均使用 Android 默认初始化策略。

| 观测 | 旧版 | 修复版 |
| --- | ---: | ---: |
| 成功加载制品 | 91 | 89 |
| 实际初始化入口 | 887 | 861 |
| 取得 Spider 入口 | 537 | 603 |
| 非空首页 | 47 | 48 |
| 非空分类 | 26 | 26 |
| 非空详情 | 12 | 12 |
| 未初始化变体 | 2395 | 2421 |

取得至少一个 Spider 的制品为 75 → 75 份，有非空首页的制品为 47 → 48 份。

按 JAR SHA、API、实际 ext SHA 配对，新增明确加载成功 2 份；加载候选退步 4 份；初始化失败转成功 56 个，成功转失败候选 2 个。超时、网络、预算不足、未测试和环境问题单独记录。

同一 SHA 若既有主 JAR 又有站点 JAR 引用，本轮统一选择主 JAR 角色；没有穷举所有角色。首页、分类与详情调用数量受每份制品一次首页和有界时间预算限制。远端业务响应没有固定；完整响应哈希差异仅为观测，不能自动判为兼容性退步。此报告不等于 Android/ART 一致性验收。

| JAR SHA 前12位 | 目录 | 加载旧→新 | Spider旧→新 | 非空首页旧→新 |
| --- | --- | --- | ---: | ---: |
| b644dc3adc5f | 饭太硬、饭太硬2线、饭太硬3线、饭太硬5线、饭太硬6线 | loaded → loaded | 35 → 35 | 1 → 1 |
| 198d4d2860bd | 嗷呜、嗷呜2线、嗷呜3线、南风、南风2线、周J | loaded → loaded | 0 → 47 | 0 → 0 |
| cb3bc0de5dde | 嗷呜、嗷呜2线、周J、嗷呜3线 | loaded → loaded | 0 → 0 | 0 → 0 |
| 0e0158a66f88 | 王二小、王二小2线 | failed → loaded | 0 → 5 | 0 → 0 |
| d8517c4cac6e | 南风、南风2线 | failed → failed | 0 → 0 | 0 → 0 |
| 65be8df8bfa6 | 潇洒 | failed → failed | 0 → 0 | 0 → 0 |
| 5ee56056022f | 老张 | loaded → loaded | 1 → 1 | 0 → 0 |
| 791b14bd55d3 | 挺好 | loaded → loaded | 27 → 27 | 0 → 0 |
| b2755622dc43 | 小马 | loaded → loaded | 22 → 22 | 1 → 1 |
| 646c5449e06b | 小马、FongMI线路 | loaded → loaded | 22 → 22 | 1 → 1 |
| 6db260446185 | 小马 | loaded → failed | 1 → 0 | 0 → 0 |
| 19ca20400ffa | 小马 | failed → failed | 0 → 0 | 0 → 0 |
| ed56f35b6794 | 周J | loaded → loaded | 1 → 1 | 1 → 1 |
| d9e77852563e | 菜妮丝 | loaded → loaded | 25 → 25 | 1 → 1 |
| 3d530a7d545f | 菜妮丝 | loaded → loaded | 1 → 1 | 1 → 1 |
| ec9ee50530cb | 菜妮丝、宝盒、肥猫 | loaded → loaded | 14 → 14 | 0 → 0 |
| 53628417aa7b | 菜妮丝 | loaded → loaded | 1 → 1 | 1 → 1 |
| 2faba4b3cd0e | 心魔 | loaded → loaded | 3 → 3 | 1 → 1 |
| efe994fe9a17 | 俊宇 | loaded → loaded | 4 → 4 | 0 → 0 |
| c81eedda82a8 | clun | loaded → loaded | 0 → 0 | 0 → 0 |
| ecd497ec1f33 | 东篱 | loaded → loaded | 30 → 30 | 1 → 1 |
| cf4a252873ac | 东篱 | loaded → loaded | 0 → 0 | 0 → 0 |
| cc3b06eb7b26 | 聚玩 | loaded → loaded | 29 → 29 | 1 → 1 |
| 18939df38112 | 哈吉米 | unknown → unknown | 0 → 0 | 0 → 0 |
| 914e2a8edf2e | 哈吉米、分享者2线 | loaded → loaded | 1 → 1 | 1 → 1 |
| 9a742d08c655 | 哈吉米 | loaded → loaded | 1 → 1 | 1 → 1 |
| 522f5fb49d91 | 哈吉米、宝盒 | loaded → loaded | 3 → 3 | 1 → 1 |
| 0c2579f7af90 | 哈吉米 | failed → failed | 0 → 0 | 0 → 0 |
| 912e7e285904 | 哈吉米 | loaded → loaded | 3 → 3 | 0 → 0 |
| 15608f024293 | 动漫 | loaded → loaded | 5 → 0 | 1 → 0 |
| a9dce1158db8 | 天神 | failed → failed | 0 → 0 | 0 → 0 |
| 4073c52fd60d | 星微Vip | loaded → loaded | 11 → 12 | 1 → 1 |
| 291c75e13b7d | 星微Vip | loaded → loaded | 0 → 5 | 0 → 1 |
| 6e673a1cfd39 | 星微Vip、宝盒、软件小哥 | loaded → loaded | 1 → 1 | 1 → 1 |
| 59ca73d4d127 | 星微Vip | failed → failed | 0 → 0 | 0 → 0 |
| 7d1eeeb6b3f0 | 星微Vip | loaded → loaded | 1 → 1 | 1 → 1 |
| 62aec35b3a4c | 星微Vip | loaded → failed | 0 → 0 | 0 → 0 |
| aa7bb1f1af9f | 星微Vip | loaded → loaded | 1 → 1 | 1 → 1 |
| 504fef5418ef | 传说、传说2线 | loaded → loaded | 2 → 2 | 0 → 0 |
| 8f84f164e726 | 幸福年年 | loaded → loaded | 12 → 30 | 0 → 0 |
| 71789158668d | 幸福年年 | unknown → unknown | 0 → 0 | 0 → 0 |
| 41d3771d1d06 | 幸福年年 | unknown → unknown | 0 → 0 | 0 → 0 |
| d8982109de0b | 幸福年年 | loaded → failed | 1 → 0 | 0 → 0 |
| d5750c1d6067 | 幸福年年 | unknown → unknown | 0 → 0 | 0 → 0 |
| 402f95d10cae | 夏夏影视 | failed → loaded | 0 → 0 | 0 → 0 |
| dfda804bf1fc | 夏夏影视、X4菠菜pro | loaded → loaded | 5 → 5 | 0 → 0 |
| 8adcedbd51c3 | 摸鱼3线、摸鱼5线、摸鱼6线、摸鱼 | loaded → loaded | 21 → 21 | 0 → 0 |
| d4568e87ca77 | X4菠菜园 | loaded → loaded | 4 → 4 | 1 → 1 |
| 8a894c42f296 | X4少儿频道 | loaded → loaded | 1 → 1 | 1 → 1 |
| 90583683bd79 | X4少儿频道、少儿 | loaded → loaded | 1 → 1 | 0 → 1 |
| 9cd4cea84b04 | 健康家用 | loaded → loaded | 14 → 14 | 0 → 0 |
| f19afc0f7d0e | 健康家用 | loaded → loaded | 0 → 0 | 0 → 0 |
| 0e622ce7b053 | 高天流云js、高天流云 | loaded → failed | 4 → 0 | 1 → 0 |
| ace8cb399795 | 高天流云_XYQ | loaded → loaded | 23 → 23 | 1 → 1 |
| fac695331a7b | 凯弟3线、小凯 | loaded → loaded | 8 → 8 | 1 → 1 |
| 7c3e0ac413b7 | 凯弟1线、凯弟 | loaded → loaded | 29 → 29 | 1 → 1 |
| 3a178ab57161 | 凯弟1线、凯弟 | loaded → loaded | 1 → 1 | 0 → 0 |
| addacc54c0fb | 分享者 | loaded → loaded | 0 → 0 | 0 → 0 |
| bcf8bddc08de | 分享者 | loaded → loaded | 0 → 0 | 0 → 0 |
| 0a23df47492c | 分享者 | loaded → loaded | 1 → 1 | 1 → 1 |
| a2e4d1a9794c | 分享者 | loaded → loaded | 1 → 1 | 1 → 1 |
| 4399167d2ec5 | 分享者 | loaded → loaded | 1 → 1 | 0 → 0 |
| 2c500f0fe0ba | 分享者 | loaded → loaded | 1 → 1 | 1 → 1 |
| 202a342db03f | 分享者、雷蒙 | loaded → loaded | 1 → 1 | 1 → 1 |
| 79ee8f2d74c7 | 分享者 | loaded → loaded | 1 → 1 | 1 → 1 |
| 4bcdfb1c06eb | 时光、时光2线 | failed → failed | 0 → 0 | 0 → 0 |
| c587b01c9ebf | X4菠菜pro | loaded → loaded | 1 → 1 | 1 → 1 |
| 2ff484674c51 | 宝盒 | failed → unknown | 0 → 0 | 0 → 0 |
| 04f73a0bb4c7 | 宝盒 | loaded → loaded | 1 → 1 | 0 → 0 |
| a6f32dcb0292 | 宝盒 | loaded → loaded | 1 → 1 | 1 → 1 |
| 33a5113b5ece | 宝盒 | loaded → loaded | 1 → 1 | 1 → 1 |
| 2b3a1414b382 | 宝盒 | loaded → loaded | 0 → 1 | 0 → 1 |
| 7f309c1cfc08 | 宝盒、少儿 | loaded → loaded | 2 → 2 | 0 → 0 |
| 703ff3315dcb | 王二小3线 | loaded → loaded | 52 → 52 | 1 → 1 |
| f317a2b97fd2 | 真六 | loaded → loaded | 35 → 35 | 1 → 1 |
| e35cc76acd93 | 嗨哥魔改 | loaded → loaded | 2 → 2 | 0 → 0 |
| cf928d087302 | 小虎斑、虎斑 | failed → failed | 0 → 0 | 0 → 0 |
| 86a7833c1520 | 饭太硬4线 | loaded → loaded | 17 → 17 | 0 → 0 |
| ee9ff15d1093 | 小米 | unknown → unknown | 0 → 0 | 0 → 0 |
| 8dbf67664700 | 刺桐 | loaded → loaded | 1 → 1 | 1 → 1 |
| fd77abad914f | 刺桐 | loaded → loaded | 2 → 2 | 0 → 0 |
| 1ac653e6140a | 宝盒2线 | failed → failed | 0 → 0 | 0 → 0 |
| 40a3db5c3241 | 宝盒2线、分享者2线 | loaded → loaded | 0 → 0 | 0 → 0 |
| 9432ca67798e | 玄珠、黄金 | loaded → loaded | 1 → 1 | 0 → 0 |
| dd9800ab0767 | 玄珠、黄金 | loaded → loaded | 2 → 2 | 1 → 1 |
| 3488351e7d72 | 软件小哥 | loaded → loaded | 7 → 8 | 0 → 0 |
| a41f11e12267 | 月光宝盒 | failed → failed | 0 → 0 | 0 → 0 |
| 665cd562d81c | 潇洒4线 | loaded → loaded | 0 → 0 | 0 → 0 |
| 9ac6f9029a1a | 潇洒4线、黄金 | loaded → loaded | 1 → 1 | 1 → 1 |
| cc960779cc21 | 潇洒4线 | loaded → loaded | 1 → 1 | 1 → 1 |
| 6dc9c7fc93bb | 潇洒4线 | failed → failed | 0 → 0 | 0 → 0 |
| e9bad8658f7e | 潇洒4线 | loaded → loaded | 1 → 1 | 0 → 0 |
| c5395ea2984e | 分享者2线 | loaded → loaded | 7 → 7 | 0 → 0 |
| 4c8375db7eaf | 分享者2线 | loaded → loaded | 4 → 4 | 1 → 1 |
| 8666c57ca5c9 | 分享者2线 | loaded → loaded | 0 → 0 | 0 → 0 |
| 5be94fe8d09d | 分享者2线 | loaded → loaded | 1 → 1 | 1 → 1 |
| 768e12910de5 | 沐辰2线 | loaded → loaded | 0 → 0 | 0 → 0 |
| 64637af0a0dc | 雷蒙 | loaded → loaded | 1 → 1 | 1 → 1 |
| 1dd6f444471f | 雷蒙 | loaded → loaded | 1 → 1 | 0 → 0 |
| a14fcaa2fb67 | 雷蒙 | loaded → loaded | 1 → 1 | 0 → 0 |
| 92b6747fd42c | 雷蒙 | failed → failed | 0 → 0 | 0 → 0 |
| 8fb2f6a5a297 | 雷蒙 | loaded → loaded | 0 → 0 | 0 → 0 |
| 76c7d225a47b | 黄金 | failed → failed | 0 → 0 | 0 → 0 |
| 1c9792284614 | 黄金 | loaded → loaded | 1 → 1 | 1 → 1 |
| 63344691801b | 黄金 | loaded → loaded | 1 → 1 | 1 → 1 |
| 6b727c38e839 | 黄金 | loaded → loaded | 1 → 1 | 1 → 1 |
| 22bdeaa8a6d9 | 黄金 | loaded → loaded | 2 → 2 | 1 → 1 |
| 9c956b18b7e7 | 黄金 | loaded → loaded | 1 → 1 | 1 → 1 |
| c1511704d0b3 | 黄金 | loaded → loaded | 1 → 1 | 0 → 0 |
| 2c81aed7bf1a | 黄金 | loaded → loaded | 1 → 1 | 1 → 1 |
| 856c1b7be73d | 驸马 | loaded → loaded | 11 → 10 | 0 → 0 |
| 2631f5b60676 | 驸马 | loaded → loaded | 0 → 0 | 0 → 0 |
| bcd5f1ae18c0 | 潇洒2线 | failed → failed | 0 → 0 | 0 → 0 |
| 713a2c84b270 | 摸鱼2线、摸鱼4线 | unknown → unknown | 0 → 0 | 0 → 0 |

针对四份退步制品的修复后跟进：已完成 4 / 4 份；加载成功 3 份。预算改为加载120秒、初始化15秒、单调用10秒、制品180秒，每份最多一次首页；使用原始加载角色。主全量结果不覆盖，合并正面证据加载 92 份，不等于最终镜像114份全量重跑。该轮高天流云 `0e622…` 仍因 `DYNAMIC_NATIVE_UNSUPPORTED: instance native` 被整包预扫描拒绝；后续修复结果见下一段。

后续动态 admission 修复后，使用相同跟进预算再测四份：已完成 4 / 4 份；加载成功 4 份。最终合并正面证据为 93 份加载成功、609 个 ready 入口；该合并集合包含不同修复镜像的观测，不是最终镜像全量重跑。

图形候选镜像 b74c7365… 在 Paint/TextPaint 状态复核前另测四份：完成 4 / 4，加载成功 4；该候选未作为最终交付验收。

初始化超时复核：动漫 `15608f…` 首个 XBPQ 入口在原矩阵10秒超时，后四个入口未执行；独立同10秒复测后 Anime1／Ysj／Ying／XPath 均 ready。驸马 `856c1b…` 的 Ddyy 同10秒重测也 ready；原记录保留为超时未知，未当作明确代码退步。XBPQ 另用明确30秒初始化诊断预算后仍超时，结果单独保留，未定位为代码回归。

最终交付镜像 f2f6208a… 继续用同字节、同角色、同预算四份回归：完成 4 / 4，加载成功 4。最终正面证据合并加载 93 份、609 个 ready 入口；仅这四份在最终镜像重测，不称最终114份全测。

已定位加载退步：小马 `6db260…`、星微 Vip `62aec3…`、幸福年年 `d89821…` 在新增 `VerifiedJarRepair.inspect` 静态扫描遇到 dex2jar 产生的不可解析类而中止整份 JAR；错误为 IllegalArgumentException／ArrayIndexOutOfBoundsException。原始类字节已固定用于修复；运行时 JVM 校验未关闭。

清理状态：NAS 临时容器和目录、本地捕获集合及构建缓存均已清理；原四个应用容器的 ID、镜像、启动时间、重启次数和运行状态核对不变。共享 SSH、安卓模拟器、ADB 和测试 HTTP 服务已停止。
