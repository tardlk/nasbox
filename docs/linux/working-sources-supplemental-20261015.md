# 已跑通 JAR 的补充业务验证

生成时间：2026-10-16 06:03:18（Asia/Shanghai）；文件日期沿用输入批次 20261015。

本报告保留主轮原始结论；补测分别记录，不能合并为全面兼容率。播放解析只检查返回值，不播放媒体。

补测计划已由父计划与私有 ART/NAS 原始证据重新生成并逐字段核对；另核对采集哈希、原参数、加载上下文、镜像、UID、只读挂载、容器退出和 runtime 清理。

## 故意省略已捕获主包的对照

独立场景 5；NAS ready 5；清理通过 5；容器零退出 5。

| 结果 | ART 本轮 | NAS |
| --- | ---: | ---: |
| nonempty | 0 | 36 |
| empty | 0 | 8 |
| not-implemented | 0 | 0 |
| invalid-json | 0 | 0 |
| network | 0 | 0 |
| failed | 0 | 0 |
| timeout | 0 | 0 |
| not-tested | 0 | 6 |

这些对照故意省略可用原主包。即使成功，也只说明站点包独立执行情况，不能代替原主包与站点包共存结果。

| 补测场景 | 父场景 | API | 步骤 | ART 本轮 | NAS |
| --- | --- | --- | --- | --- | --- |
| 0-0 | 0-0 | csp_SP360 | home | 未重新执行 | nonempty |
| 0-0 | 0-0 | csp_SP360 | home-video | 未重新执行 | nonempty |
| 0-0 | 0-0 | csp_SP360 | category-page1 | 未重新执行 | nonempty |
| 0-0 | 0-0 | csp_SP360 | category-page2 | 未重新执行 | nonempty |
| 0-0 | 0-0 | csp_SP360 | category-filter | 未重新执行 | nonempty |
| 0-0 | 0-0 | csp_SP360 | detail | 未重新执行 | nonempty |
| 0-0 | 0-0 | csp_SP360 | search | 未重新执行 | nonempty |
| 0-0 | 0-0 | csp_SP360 | search-page1 | 未重新执行 | nonempty |
| 0-0 | 0-0 | csp_SP360 | search-detail | 未重新执行 | nonempty |
| 0-0 | 0-0 | csp_SP360 | player | 未重新执行 | nonempty |
| 1-0 | 1-0 | csp_Douban | home | 未重新执行 | nonempty |
| 1-0 | 1-0 | csp_Douban | home-video | 未重新执行 | empty |
| 1-0 | 1-0 | csp_Douban | category-page1 | 未重新执行 | nonempty |
| 1-0 | 1-0 | csp_Douban | category-page2 | 未重新执行 | nonempty |
| 1-0 | 1-0 | csp_Douban | category-filter | 未重新执行 | nonempty |
| 1-0 | 1-0 | csp_Douban | detail | 未重新执行 | empty |
| 1-0 | 1-0 | csp_Douban | search | 未重新执行 | empty |
| 1-0 | 1-0 | csp_Douban | search-page1 | 未重新执行 | empty |
| 1-0 | 1-0 | csp_Douban | search-detail | 未重新执行 | not-tested |
| 1-0 | 1-0 | csp_Douban | player | 未重新执行 | not-tested |
| 2-0 | 2-1 | csp_Kugou | home | 未重新执行 | nonempty |
| 2-0 | 2-1 | csp_Kugou | home-video | 未重新执行 | empty |
| 2-0 | 2-1 | csp_Kugou | category-page1 | 未重新执行 | nonempty |
| 2-0 | 2-1 | csp_Kugou | category-page2 | 未重新执行 | empty |
| 2-0 | 2-1 | csp_Kugou | category-filter | 未重新执行 | not-tested |
| 2-0 | 2-1 | csp_Kugou | detail | 未重新执行 | nonempty |
| 2-0 | 2-1 | csp_Kugou | search | 未重新执行 | empty |
| 2-0 | 2-1 | csp_Kugou | search-page1 | 未重新执行 | empty |
| 2-0 | 2-1 | csp_Kugou | search-detail | 未重新执行 | not-tested |
| 2-0 | 2-1 | csp_Kugou | player | 未重新执行 | nonempty |
| 3-0 | 5-0 | csp_Bili | home | 未重新执行 | nonempty |
| 3-0 | 5-0 | csp_Bili | home-video | 未重新执行 | nonempty |
| 3-0 | 5-0 | csp_Bili | category-page1 | 未重新执行 | nonempty |
| 3-0 | 5-0 | csp_Bili | category-page2 | 未重新执行 | nonempty |
| 3-0 | 5-0 | csp_Bili | category-filter | 未重新执行 | not-tested |
| 3-0 | 5-0 | csp_Bili | detail | 未重新执行 | nonempty |
| 3-0 | 5-0 | csp_Bili | search | 未重新执行 | nonempty |
| 3-0 | 5-0 | csp_Bili | search-page1 | 未重新执行 | nonempty |
| 3-0 | 5-0 | csp_Bili | search-detail | 未重新执行 | nonempty |
| 3-0 | 5-0 | csp_Bili | player | 未重新执行 | nonempty |
| 3-1 | 5-1 | csp_Bili | home | 未重新执行 | nonempty |
| 3-1 | 5-1 | csp_Bili | home-video | 未重新执行 | nonempty |
| 3-1 | 5-1 | csp_Bili | category-page1 | 未重新执行 | nonempty |
| 3-1 | 5-1 | csp_Bili | category-page2 | 未重新执行 | nonempty |
| 3-1 | 5-1 | csp_Bili | category-filter | 未重新执行 | not-tested |
| 3-1 | 5-1 | csp_Bili | detail | 未重新执行 | nonempty |
| 3-1 | 5-1 | csp_Bili | search | 未重新执行 | nonempty |
| 3-1 | 5-1 | csp_Bili | search-page1 | 未重新执行 | nonempty |
| 3-1 | 5-1 | csp_Bili | search-detail | 未重新执行 | nonempty |
| 3-1 | 5-1 | csp_Bili | player | 未重新执行 | nonempty |

## NAS 超时后独立补测：原始上下文

独立场景 3；NAS ready 3；清理通过 3；容器零退出 3。

| 结果 | ART 本轮 | NAS |
| --- | ---: | ---: |
| nonempty | 0 | 0 |
| empty | 0 | 0 |
| not-implemented | 0 | 0 |
| invalid-json | 0 | 0 |
| network | 0 | 0 |
| failed | 0 | 0 |
| timeout | 0 | 3 |
| not-tested | 0 | 0 |

本组保留原加载上下文。

| 补测场景 | 父场景 | API | 步骤 | ART 本轮 | NAS |
| --- | --- | --- | --- | --- | --- |
| 0-0 | 4-2 | csp_XYQHiker | home-video | 未重新执行 | timeout |
| 0-1 | 4-2 | csp_XYQHiker | category-page1 | 未重新执行 | timeout |
| 0-2 | 4-2 | csp_XYQHiker | category-page2 | 未重新执行 | timeout |

## NAS 超时后独立补测：缺主包诊断

独立场景 11；NAS ready 11；清理通过 11；容器零退出 11。

| 结果 | ART 本轮 | NAS |
| --- | ---: | ---: |
| nonempty | 0 | 4 |
| empty | 0 | 1 |
| not-implemented | 0 | 0 |
| invalid-json | 0 | 0 |
| network | 0 | 0 |
| failed | 0 | 0 |
| timeout | 0 | 6 |
| not-tested | 0 | 0 |

本组缺少原配置主包，只能作为独立诊断。

| 补测场景 | 父场景 | API | 步骤 | ART 本轮 | NAS |
| --- | --- | --- | --- | --- | --- |
| 0-0 | 0-5 | csp_XBPQ | home-video | 未重新执行 | nonempty |
| 0-1 | 0-5 | csp_XBPQ | category-page1 | 未重新执行 | nonempty |
| 0-2 | 0-5 | csp_XBPQ | category-page2 | 未重新执行 | timeout |
| 0-3 | 0-5 | csp_XBPQ | detail | 未重新执行 | nonempty |
| 0-4 | 0-5 | csp_XBPQ | search | 未重新执行 | timeout |
| 0-5 | 0-5 | csp_XBPQ | search-page1 | 未重新执行 | empty |
| 0-6 | 0-5 | csp_XBPQ | player | 未重新执行 | nonempty |
| 1-0 | 0-7 | csp_XBPQ | home-video | 未重新执行 | timeout |
| 1-1 | 0-7 | csp_XBPQ | category-page1 | 未重新执行 | timeout |
| 1-2 | 0-7 | csp_XBPQ | category-page2 | 未重新执行 | timeout |
| 1-3 | 0-7 | csp_XBPQ | category-filter | 未重新执行 | timeout |

## ART 超时后独立补测：修正输入计划

独立场景 5；NAS ready 5；清理通过 5；容器零退出 5。

| 结果 | ART 本轮 | NAS |
| --- | ---: | ---: |
| nonempty | 1 | 4 |
| empty | 0 | 0 |
| not-implemented | 0 | 0 |
| invalid-json | 0 | 0 |
| network | 0 | 0 |
| failed | 0 | 0 |
| timeout | 4 | 1 |
| not-tested | 0 | 0 |

本组缺少原配置主包，只能作为独立诊断。

| 补测场景 | 父场景 | API | 步骤 | ART 本轮 | NAS |
| --- | --- | --- | --- | --- | --- |
| 0-0 | 0-1 | csp_XBPQ | search-page1 | timeout | timeout |
| 0-1 | 0-1 | csp_XBPQ | player | nonempty | nonempty |
| 1-0 | 0-2 | csp_XBPQ | home-video | timeout | nonempty |
| 1-1 | 0-2 | csp_XBPQ | search | timeout | nonempty |
| 1-2 | 0-2 | csp_XBPQ | search-page1 | timeout | nonempty |

## 保留的输入保护拒绝记录

初次补测 5 个容器因计划遗漏冻结输入元数据，在进入 runtime 前被 INPUT_CHECKSUM 保护拒绝；这 5 次属于测试工具输入错误，JAR 未执行，不计为提供方/JAR 失败。修正计划后已另外记录完整新一轮。

空响应不等于业务可用；ART 基类缺省与 NAS 未知实现分别保留。未执行或缺少真实参数的步骤仍为未测试。
