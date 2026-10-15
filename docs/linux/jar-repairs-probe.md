# 已定位 JAR 兼容问题修复

修复提交：`3ff2c81`。445 项含原生集成回归全部通过；以下结果来自同一份 SHA 固定的原始 JAR，在物理 x86_64 NAS 上运行。

| 样本 | 处理的问题 | NAS 结果 |
| --- | --- | --- |
| 夏夏影视 `402f95…` | DEX boolean／引用合流冲突；仅细化已证明的零分支 | 加载成功；3 个入口、3 个非空首页、1 个非空分类 |
| 嗷呜／南风 `198d4d…` | 构造器校验、动态 ARM 库、TextPaint 层级、原生关闭竞态 | 3 个入口、3 个非空首页和分类；worker 正常退出 |
| 王二小 `0e0158…` | Activity 缺失 API、NEW／祖先构造器及枚举父链 | 解密加载器就绪；3 个入口初始化成功、Local 首页成功；其他两个首页缺原始配置，未测试 |
| 宝盒2线 `1ac653…` | 普通 JAR 被固定安卓启发式误判为加壳 | 默认安卓规则仍拒绝；显式 declared 执行真实初始化后，3 个入口成功，2 个非空首页、1 个非空分类 |

没有关闭 JVM 字节码验证，没有跳过业务 native／crypto，也没有制造成功返回。动态库只在明确的 worker-owned 路径范围内按 ARM ELF 内容交给 unidbg。原版 guard 与 ARM32 payload 保留独立执行锁，关闭等待活跃调用及依赖回调完成后才销毁模拟器。

普通 JAR 的误判策略是显式宿主选项：`createExecutableSubscriptionSession({jarInitPolicy:"declared", ...})` 或 `session --jar-init-policy declared`。默认值仍是 `android`，不得把可选路径宣称为安卓行为一致。

同一最终镜像还通过离线 doctor，以及自动导入饭太硬、严格 MD5、Aid 首页和新会话磁盘缓存重启；两次均返回相同的 8 个分类。

镜像：`tvbox-core:linux-amd64-jarfix-20261015`，约490MiB，复用既有层，新增2,151,925字节（约2.05MiB）。运行时仅JRE，不包含临时编译器。完整结果、前后对照、18个源码哈希和退出状态在同名JSON报告中。

这轮没有重新执行全部115份制品及所有API/ext组合，也没有完成Android/ART同输入验收。TextPaint继续使用原先的headless近似，未实现Android字体渲染；反射／方法句柄库加载、instance native、按库名加载和正式多原生JAR调度仍是明确边界。

清理完成：17个任务容器、临时编译器／目录、SSH和本地缓存已移除。四份原始失败JAR及最小输入在核对SHA、完成修复回归后已清理。仅保留约404MiB既有开发环境和已验证NAS镜像；原四个NAS应用容器不变，无新增自启动项或任务服务。
