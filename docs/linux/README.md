# Linux／NAS 文档入口

接手先读根目录 [HANDOFF.md](../../HANDOFF.md)，再看本页。这里保留各轮原报告，不把旧数字或镜像换成最新版本。

本机已执行用户要求的项目环境／私有输入清理；旧保留路径仅作历史记录。见 [本机清理](local-removal-20261016.json)，私有字节不在GitHub中。

| 当前需要 | 入口 |
| --- | --- |
| 最新状态与待办 | [status.md](status.md)、[roadmap.md](roadmap.md) |
| 工具／服务／数据／空间 | [environment.md](environment.md) |
| 本次仓库交接核对 | [handoff-audit-20261016.json](handoff-audit-20261016.json) |
| 最新JSON／XML接入 | [CMS交付](cms-delivery-20261016.md)、[逐方法结果](cms-business-20261016.md)、[结构化证据](cms-business-20261016.json)、[清理](cms-cleanup-20261016.json) |
| 真实JS业务与ART | [JS交付](js-business-delivery-20261016.md)、[NAS](js-business-nas-20261016.md)、[ART](js-business-art-20261016.md)、[静态依赖](js-static-dependency-audit-20261016.json)、[清理](js-business-cleanup-20261016.json) |
| 非JAR类型原始盘点 | [non-jar-status-20261016.md](non-jar-status-20261016.md)，内含执行前历史状态 |
| JAR实际业务覆盖 | [8个JAR摘要](working-sources-summary-20261016.md)、[主轮](working-sources-business-20261015.md)、[补测](working-sources-supplemental-20261015.md) |
| JAR完整矩阵／后续已暂停 | [完整交付](jar-continuation-delivery-20261015.md)、[最终矩阵](jar-round1-zxing-full-matrix.md)、[原下一阶段方案](jar-next-phase-plan.md) |
| Docker使用 | [Docker说明](../../docker/README.md) |
| 模块说明 | [配置](../../backend/config-core/README.md)、[订阅](../../backend/subscription/README.md)、[CMS](../../backend/cms-runtime/README.md)、[Spider](../../backend/spider-runtime/README.md)、[Android工具](../../scripts/android/README.md) |

报告中的“加载”“ready”“非空”“同参数相同JSON”“失败”“超时”“未测试”是不同概念。原主包缺失、剥主包控制、宿主固定HTTP和在线观察分别保留；`parse:1`／URL透传不是可播放证明。

公开JSON只保存允许公开的摘要，不包含完整业务参数。要重建原始报告须有本机私有保留目录及其原哈希；从GitHub克隆不会获得这些数据。许可证见根目录 [LICENSES.md](../../LICENSES.md)。
