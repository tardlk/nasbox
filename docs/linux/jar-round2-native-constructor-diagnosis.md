# d8517c 原生构造器判因 — 2026-10-15

`d8517c4cac6e…` 在官方原版 APK／ART 上完成加载及 Spider 初始化，在当前最终 NAS 镜像上阻断于 `loadMain`。已确认的技术原因是：

```text
java.lang.ClassFormatError:
Method <init> in class com/github/catvod/en/BaseApi has illegal modifiers: 0x101
```

原始 DEX 的 `BaseApi.<init>()V` 标志为 `0x10101`，即 `PUBLIC | NATIVE | DEX_CONSTRUCTOR`。翻译后的同一构造器仍为 `PUBLIC | NATIVE`，标志 `0x101`、没有 Code 属性；JVM 在定义该类时就拒绝它。独立 NAS 容器禁用网络后两次复现，因此这项失败不是业务网络错误，也不是仅凭异常名推断的缺类问题。主包 SHA、原 DEX、翻译类、镜像及原 ART 身份见同名 JSON。

静态调用边包括 `BaseApi$Loader.<clinit>()V → BaseApi.<init>()V`，以及 `Init.g(Init)V → BaseApi.get()BaseApi`。两个 ABI 的 `libstub.so` 均导出 `JNI_OnLoad` 和 `Java_com_github_catvod_en_BaseApi__0003cinit_0003e__`。原 ART 日志还记录了 `BaseApi.getDexPathList(Native Method)`，说明实例 native 方法已实际走到；目前没有构造器入口计数，静态可达关系不能当作构造器动态调用次数。

新增自有回归 `compat/native-constructor-format.test.mjs`：用本地生成的 class 字节，在 JDK17 `-Xverify:all` 下复现相同格式拒绝，并验证普通构造器对照保留字段初始化副作用。1 项通过。这是未支持边界的回归，不是该 JAR 已兼容的证据；没有修改核心运行时。

本轮不以删除 `native`、空构造器或猜测父构造器绕过。后续桥接须保留原 `<init>` 身份、描述符及 JNI 分派，证明父初始化路径，并将实际 receiver 稳定映射到 ARM 侧；用两个实例验证字段、回调与异常隔离。无法保真时，实际构造应明确失败，不能返回伪造的初始化对象。原生多 JAR owner 隔离继续保留。

任务容器 `tvbox-r2-d851-diag` 两次均已退出、移除，worker 数据及 NAS 专属目录 `/tmp/tvbox-frozen-round1.LWyPp6/d851-diag` 已清理。没有安装工具或新增服务。私有翻译类 `BaseApi.class`（9,074 字节）仅在 `.cache/jar-round1/diagnostics/d851` 保留至整体验证清理，未提交；原始 stderr 只在内存，报告仅保留技术原因、校验后的符号及哈希。
