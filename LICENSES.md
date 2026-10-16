# 许可与来源索引

NASBox是多组件仓库，根目录原有MIT许可不覆盖为其它许可的全部新增或第三方代码。现有声明保持原适用范围，不重新许可上游源码。

| 范围 | 许可／记录 |
| --- | --- |
| 继承的Win-Box桌面部分 | 原MIT，[LICENSE](LICENSE)，原作者和历史保留；[原项目说明](README-UPSTREAM.md) |
| TVBoxOS衍生后端、参考与相关工具 | GPL-3.0-only；各文件头／模块NOTICE为准 |
| 配置核心 | [LICENSE](backend/config-core/LICENSE)、[NOTICE](backend/config-core/NOTICE.md)，另有Gson／BC／AOSP来源 |
| Spider／QuickJS／DEX | [LICENSE](backend/spider-runtime/LICENSE)、[NOTICE](backend/spider-runtime/NOTICE.md)、[原生桥NOTICE](backend/spider-runtime/native-bridge/NOTICE)及各依赖许可证 |
| JSON／XML CMS | [来源与变更说明](backend/cms-runtime/NOTICE.md)，固定原始模型及其[上游GPL许可](compat/reference/tvboxos-cms/LICENSE) |
| 固定Android／AOSP参考 | `compat/reference/*/manifest.json`、该目录LICENSE／README，原字节摘要保留 |
| 其它JS／native vendored组件 | 各组件目录LICENSE／NOTICE及固定来源清单 |

实际订阅、APK、第三方私有JAR、运行库二进制、SDK/JDK与原始响应不提交。构建下载的第三方库仍受各自许可约束；公开分发完整镜像时需依据各组件许可提供相应归属及源码材料。本次交付是源码与报告推送，未发布公共镜像或安装包。
