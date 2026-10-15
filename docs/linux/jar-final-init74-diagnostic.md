# 第 74 项初始化候选复核 — 2026-10-15

原完整矩阵必须保留：`703ff3315dcb…` 的主包两端均加载成功，`csp_WexbttwoGuard` 在旧 `f2f6208a…` 镜像初始化 ready，在新 `808d15d8…` 镜像返回 SpiderNull，形成一项初始化候选退步。

随后以同一冻结主包、原 main 角色、同 API、同一原始空 ext，在两个镜像分别建立独立 runtime，仅初始化这一个入口。沿用原预算：加载 90 秒、初始化 10 秒、总计 150 秒；没有首页或其他业务调用。两端结果均为主包加载成功、初始化失败，并取得相同受控缺失方法：

```text
android.util.Log.e(java.lang.String, java.lang.String, java.lang.Throwable): int
(Ljava/lang/String;Ljava/lang/String;Ljava/lang/Throwable;)I
```

因此，已确认的是**两版均存在、条件触发的宿主 Log ABI 缺口**，尚未证实为 ZXing 新镜像引入的回归。原矩阵的调用顺序及外部状态可能决定是否走到此错误处理路径；当前证据没有确定其此前的业务异常，不能以“网络波动”解释全部问题，也不能把缺方法计为已支持。原 ready → failed 观测和统计保持原样，成对定点结果作为独立诊断附加。

本轮不修改 core、不新建镜像，也不添加仅断言实现缺方法的重复测试。下一轮若修复，应以自有调用者验证精确三参数重载的消息、Throwable、异常及日志保留边界；新增签名不能隐藏原业务失败。

两次诊断容器 `tvbox-final-init74-old/new` 均 code 0、无 OOM、runtime 正常关闭，已移除。专属 NAS 目录 `/tmp/tvbox-frozen-round1.RhIwSi/single-init-diag` 及本地任务脚本已清理。原冻结输入、矩阵输出、并行完整回测及共用 SSH 连接均未改动；未安装工具或启动服务。完整哈希、预算和受控证据见同名 JSON。
