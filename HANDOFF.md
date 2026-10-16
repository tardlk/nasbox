# NASBox 项目交接 — 2026-10-16

> **本机已按用户要求清理。** 项目 `.tools/`、`.data/`、`.cache/` 和私有复现数据已删除；本地源码目录将在本次清理记录推送并核对后删除。下文旧“保留路径／输入”属于历史交付状态，不能继续视为现存字节。GitHub仅保留源码、测试与公开报告，不能恢复已删除的私有脚本、JAR、APK或原响应。下次从仓库重新克隆并准备环境；需要真实源时重新取得并标为新输入。见 [本机清理记录](docs/linux/local-removal-20261016.json)。远程NAS镜像及原应用服务不属于本地清理，未操作。

接手时先读本文件和 [AGENTS.md](AGENTS.md)，不要重新从零研究。当前完成代码为 `7ce1cb1`（CMS），本次整理提交位于其后。开发分支 `codex/linux-core`；发布源码同步至目标仓库的 `main`，两者在本次交接时指向同一交付。

目标远程 `origin` 为 `tardlk/nasbox`；原Win-Box地址保留为 `upstream`。原浅克隆已补齐固定基线之前的祖先历史；没有重写本地开发提交或混入上游后续功能。继承的 `package.json` 名称／Electron打包元数据仍是Windows上游值，仅用于旧桌面流程；NAS入口、后端与Docker不依赖将其改名。

## 工作方向与完成范围

用户已暂停JAR兼容修复，优先其它脚本类型；播放器UI／解码／转码继续后置。JS及JSON／XML CMS首批工作已经完成，下一批仍缺Python、type4。没有承诺所有脚本兼容。

| 里程碑 | 提交／证据 | 接手须知 |
| --- | --- | --- |
| JAR同输入完整矩阵 | `b5ad70e`；[最终JAR交付](docs/linux/jar-continuation-delivery-20261015.md) | 镜像808d15d8，114份输入／111有效，96加载成功、12失败、3超时；初始化与业务不是同单位 |
| 8个JAR的实际配置业务 | `03c8fda`；[业务摘要](docs/linux/working-sources-summary-20261016.md) | 25场景、10 API；缺原主包诊断与原共存结果分开；344未配置候选类未执行 |
| 3个真实JS | `f97169e`；[JS交付](docs/linux/js-business-delivery-20261016.md) | 虎牙／斗鱼NAS发现轮10项非空，兔小贝8非空；ART同参数28次调用18 JSON同／10差异，空搜索保留 |
| JSON／XML CMS | `7ce1cb1`；[CMS交付](docs/linux/cms-delivery-20261016.md) | 正式session接入type0/1，4源实际测试；7/8最终重放完整，1例工具记录不足，尚无CMS ART业务对照 |

最近全部测试：698通过，0失败／跳过；报告生成器补充检查3通过。历史记录内的497、588、643、683等是各轮当时的数字，不代表当前测试总数。播放器返回URL、`ready`、加载成功、业务非空、失败和未测试必须继续区分。

## 代码入口

| 目录／入口 | 用途 |
| --- | --- |
| `backend/config-core` | 固定Gson／AOSP语义的配置解析与状态核心 |
| `backend/subscription` | 订阅获取、准备、集合／缓存／状态和清理 |
| `backend/spider-runtime/session.mjs` | 正式订阅→CMS或type3运行时分发，按source key调用 |
| `backend/cms-runtime` | JSON／XML HTTP协议、固定模型转换、安全XML适配；不走JAR |
| `backend/spider-runtime` | QuickJS／JVM／DEX／可选原生桥；Python明确不支持 |
| `scripts/android` | 原版APK独立instrumentation及私有结果采集 |
| `scripts/container` | NAS doctor、业务／矩阵探针和镜像预编译 |
| `scripts/compat`、`compat` | 冻结／报告工具、固定源码参考和不依赖Electron的测试 |
| `src`、`tests` | 继承的Windows桌面代码／测试，保留作参考，不等于Linux能力 |

正式使用命令见 [Docker说明](docker/README.md) 和模块README。直接Spider worker仍只接受type3；CMS走session，不能直接给它type0/1。

## 最终镜像和证据不能混用

| 镜像 | ID | 已验证范围 |
| --- | --- | --- |
| 当前CMS | `sha256:e8680fa72a2e8db9b9db8518ec970508946a16f8f30081a95f08f89d31e0429c` | 本地tag `tvbox-core:linux-amd64-cms-20261016`；517,826,084字节未压缩层；CMS最终16次观察＋断网doctor |
| 保留基础／JAR与JS基线 | `sha256:808d15d8ac47fed98670eda0e33ffcb00a12b637114690b94536e53e40e447e7` | 本地tag `tvbox-core:linux-amd64-zxing-20261015`；完整JAR矩阵和JS首批业务证据 |

CMS镜像比基础增加1,186,627字节，仍为非root JRE／Node镜像。它没有重跑全部JAR，所以旧矩阵不能改写成新镜像的全JAR结论。镜像只在本地NAS保留，没有推送registry；本次Git推送不包含镜像、Release或部署服务。

## 环境、数据与清理

原工作目录 `/Users/coke/Desktop/Projects/tvbox-linux`；现有Node在用户runtime缓存，JDK为项目 `.tools/jdk17`，SDK为 `.tools/android-sdk`。这些是本机绑定，不可当成其它机器必有路径。现有工具约5.1GiB分配空间，继续保留，不能删其他项目共用工具。

私有输入和证据均被Git忽略，按各自 `freeze.json`／`retention.json` 哈希验证：

| 本机目录 | 用途／约逻辑大小 |
| --- | --- |
| `.data/jar-round1-20261015` | 原配置／JAR字节，283MB |
| `.data/jar-round2-evidence-20261015` | 原APK及ART／NAS精确证据，25.5MB |
| `.data/jar-working-sources-evidence-20261016` | 8个JAR业务场景证据，12.4MB |
| `.data/js-business-inputs-20261016`、`js-business-evidence-20261016` | JS规则／模块及原参数响应，共约6.4MB |
| `.data/cms-business-inputs-20261016`、`cms-business-evidence-20261016` | CMS原配置／HTTP／镜像源上下文，共约23.8MB |

这些是未解修复和回归的精确输入，不推到GitHub；保留到相应差异修复和最终验证结束，再按环境规则清理。换机器没有私有字节时应明确未取得，不能把新下载假称旧字节。凭据没有写入仓库；需要访问NAS时从用户现有授权配置取得，不能把附件内容或密码写进文档。

当前任务临时服务：**无**。AVD／ADB／HTTP／SSH控制连接、临时容器及NAS目录均已结束。NAS原有Docker、moviepilot、qbittorrent、emby、dockge继续运行，均非本任务创建。精确台账见 [CMS清理](docs/linux/cms-cleanup-20261016.json)、[JS清理](docs/linux/js-business-cleanup-20261016.json)、[JAR清理](docs/linux/working-sources-cleanup-20261016.json) 和 [完整环境记录](docs/linux/environment.md)。

## 复核与继续

1. 确认分支、工作区和 [当前状态](docs/linux/status.md)，再按 [路线图](docs/linux/roadmap.md) 选择单一里程碑。JAR仍暂停。
2. 安装前检查已有工具。新机器优先走Docker多阶段构建，依赖获取有固定摘要；Linux测试无需`npm install`／Electron。原生profile测试需现有固定开发库及C/C++编译工具，详见模块README。
3. 在仓库根运行：

   ```sh
   TVBOX_TEST_NATIVE=1 node --disable-warning=ExperimentalWarning \
     --import ./scripts/compat/typescript-loader.mjs \
     --test --test-reporter=spec compat/*.test.mjs
   ```

4. 实际源先固定配置、脚本／依赖／角色／参数；成功、空、错误、超时、未测试分别记录。已有报告不覆盖；有失败再做原版同字节判因和最小自有测试。
5. 新改动若影响运行时，要在最后镜像上重测相应范围。固定输入的断网重放与在线观察分开；未来完成失败事件记录后才能修补CMS不完整重放，不能删除该失败行。
6. 运行测试会重建 `.cache/backend`、`.cache/compat`，部分JS测试还会生成 `.cache/js-business/fixture-host`。验证结束删除本任务生成的缓存，更新环境台账；不删保留输入和共享`.tools`。

## 仍未解决

- Python及type4执行器未实现；不要把系统Python或配置解析当作执行通过。
- CMS XML安全DOM与XStream不保证全部语义一致；无CMS真实ART业务对照。XML搜索403／错误体和响应前网络失败事件重放待推进。
- JS有限样本的10份ART／NAS响应差异原因未定位；完整宿主API、网络状态和所有脚本覆盖未完成。
- JAR原生构造器、loader、共存、条件性ABI及方法超时仍在，用户当前暂停此方向。
- NAS Web/API服务、前端UI、播放器／媒体、生产多任务调度、ARM NAS和公开镜像发行未交付。

权威仍为固定TVBoxOS `ab11d289…` 源码；官方原APK来自另一产品版本 `d5f5006…`。两者证据分开，Win-Box仅实现参考。所有转载源码、模型和第三方库需保留各自NOTICE及许可，见 [LICENSES.md](LICENSES.md)。
