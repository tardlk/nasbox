# Linux x86_64 核心运行镜像

本阶段交付命令行后端镜像：订阅配置解析、QuickJS、DEX 转换和 ARM/JNI 执行。
默认命令是一次性离线自检，执行成功后容器退出。Web 服务和播放器后续开发。

在仓库根目录构建：

```sh
docker buildx build --platform linux/amd64 --load -f docker/Dockerfile -t tvbox-core:local .
docker run --rm --network none --read-only --tmpfs /tmp:rw,exec,nosuid,nodev,size=256m tvbox-core:local
```

输出一行 JSON，`ok: true` 表示自检通过。自检实际运行固定样本的配置解析、
QuickJS 运算、DEX 爬虫与资源读取、ARM64 Unicorn2/Dynarmic 和 ARM32 Unicorn2
机器码，并检查 JVM 替换和旧 Spider 标识失效。它不访问订阅或其他网络服务，
也不证明真实源的全部方法与 Android 一致。

运行已有的订阅导入入口：

```sh
docker run --rm -v tvbox-core-data:/data tvbox-core:local subscription --config 'http://www.饭太硬.net/tv'
```

运行手动准备的 JAR（`input` 目录包含文件，实际 CSP/API 和 ext 以配置为准）：

```sh
docker run --rm --read-only --tmpfs /tmp:rw,exec,nosuid,nodev,size=256m \
  -v "$PWD/input:/input:ro" -v tvbox-core-data:/data \
  tvbox-core:local spider --native --jar /input/spider.jar --api csp_FirstAidGuard \
  --method homeContent --args '[true]' --timeout 45000
```

其他命令：`help`、`config`（用 `-i` 输入 JSON-lines）、`subscription`、`spider`、
`native-source-probe SUBSCRIPTION_URL /data/report.json`。最后一个命令是显式执行
真实订阅代码的研究探针，会下载全局 JAR 并校验声明的 MD5，报告初始化/首页和
清理结果；临时订阅、JAR 和解密载荷在退出时清理。正式订阅会话的自动 JAR
下载/缓存入口见下方 `session` 命令；研究探针仅用于记录实测结果。

镜像默认 UID/GID 为 10001，运行时只有 JRE 和 Node，没有 javac、clang 或 npm。
预编译输出缺失时立即报错；不会在 NAS 上临时安装编译工具。源码、依赖和原始
参考文件会保留在镜像内，用于现有完整性校验与许可归属。`.dockerignore` 使用
允许列表，排除宿主的 `.tools`、缓存、订阅、密钥、桌面应用和播放器文件。

JNI 库会在 worker 的临时目录解压并加载，因此 `/tmp` 的 tmpfs 需要 `exec`。
默认临时 worker 使用 `/tmp`，退出后删除。订阅和 Spider CLI 的持久数据分别
使用 `/data/subscription`、`/data/spider`；需要保留时挂载数据卷。示例中的命名卷
会长期保留配置/缓存/偏好等数据，删除容器不会删除它。绑定 NAS 目录时，应使
目录可由容器 UID 写入，或通过 `--user UID:GID` 使用目录所有者身份。输入 JAR
目录应按需只读挂载，文件需对该 UID 可读。

原生 worker 最大 Java 堆为 768 MiB，另有模拟器、QuickJS 和 Node 内存，建议
验证时给容器至少 2 GiB 内存上限。无服务端口、自动启动策略或持续后台服务。
容器停止会结束其全部进程；原生 JAR 清空也会完整更换 JVM。当前缓存限额见文末；多
原生制品调度仍待后续实现。

基础镜像标签和 OCI 摘要固定在 `base-images.json`；Java 依赖沿用项目现有哈希，
首次构建下载并校验缺失依赖。依赖获取放在独立构建层，修改业务代码可复用该层。
编译器和 unzip 只存在于构建阶段。Ubuntu apt 包未固定到快照仓库，因此这里
不声称按位可复现构建。内网代理按 Docker 的构建参数/构建器设置配置，不应
把代理或登录凭据写入 Dockerfile 或提交到仓库。

实现依据：[Docker 多阶段构建](https://docs.docker.com/build/building/multi-stage/)、
[多平台构建](https://docs.docker.com/build/building/multi-platform/)、
[独立构建器](https://docs.docker.com/build/builders/drivers/docker-container)、
[官方镜像清单](https://github.com/docker-library/official-images/tree/master/library)。
许可见后端各目录的 LICENSE/NOTICE 和 native-bridge/NOTICE；对外分发前仍需
完成第三方原生组件的对应源码及许可清单。这里不发布公共镜像。


已在用户提供的物理 x86_64 NAS 上构建并运行，Docker 29.6.2 / buildx 0.33.0，
非 root、只读根文件系统和无网络自检通过。详细结果见
[Docker 运行报告](../docs/linux/docker-runtime-probe.json)。当前 NAS 保留的镜像标签为
`tvbox-core:linux-amd64-20261015`；它是一次性核心运行入口，默认没有 Web 服务。

该镜像随后已完成真实受保护 JAR 的 NAS 验证，见
[同输入实测报告](../docs/linux/nas-native-runtime-probe.json)：45 个 CSP 中 44 个取得
Spider，抽查 5 个首页成功，分类/筛选与 Mac 一致；完整 JSON 有两处待定位差异。
清空、重新加载、旧标识失效及超时后的进程/监听释放均通过，尚无 Android/ART 对照。
这次将新版研究探针只读挂载进旧镜像，未修改其预编译运行时。

当前源码构建的新镜像支持 `--inputs /input` 和 `--deadline`。同输入对照时，先用
`captureNativeSource(url, directory)` 显式捕获一次，再把该目录只读挂载到 `/input`：

```sh
docker run --rm --read-only --tmpfs /tmp:rw,exec,nosuid,nodev,size=256m \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --memory 2g \
  -v "$PWD/input:/input:ro" -v tvbox-core-data:/data \
  tvbox-core:local native-source-probe 'http://www.饭太硬.net/tv' /data/report.json \
  --inputs /input --deadline
```

捕获目录包含原始订阅响应、配置、JAR 与校验元数据；它由调用方管理，验证后应
删除。探针会重新解析捕获响应并校验文件哈希，源本身的 HTTP 请求仍然联网。
默认不加 `--inputs` 时捕获数据归探针所有，退出自动删除。报告只留计数、错误类别
和哈希，不保存首页正文或解密代码。`--deadline` 在真实 JAR 初始化后用独立的合成
死循环触发超时；端口释放检查依赖 Linux `/proc`。清理/重载/超时检查失败会返回
非零退出码；个别 CSP 的 ready=false 仍保留在报告中，不把它伪装成成功。

自动 JAR 会话现已交付到 NAS 标签 `tvbox-core:linux-amd64-artifacts-20261015`。
给出订阅和源键即可调用，无需手工提供 JAR：

```sh
docker run --rm --read-only --tmpfs /tmp:rw,exec,nosuid,nodev,size=256m \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --memory 2g \
  -v tvbox-core-data:/data tvbox-core:linux-amd64-artifacts-20261015 \
  session --native --url 'http://www.饭太硬.net/tv' --source Aid \
  --method homeContent --args '[true]' --strict-md5
```

再次运行可加 `--cache` 复用配置与 JAR。默认下载缓存配额128MiB、单文件64MiB，
支持 `--jar-cache-bytes BYTES`。本次 NAS 两个独立会话都返回 Aid 首页8个分类，
JAR仅下载一次；严格MD5、SHA缓存校验及退出解锁通过。
[缓存规则与边界](../backend/spider-runtime/ARTIFACTS.md) 区分安卓默认行为与
`--strict-md5`，并说明残留锁恢复、暂不自动处理的制品类型和配额范围。

该NAS镜像是基于已验证核心镜像，仅复制5个Node模块生成的本地增量镜像；
JRE、原生依赖和预编译运行时没有改变，也没有公共推送。正常从当前源码构建
Dockerfile同样包含这些模块。此配额仅约束下载JAR及其元数据，运行时DEX/模块/
插件数据另存于 `/data/session/runtime`；当前 DEX/模块限额见文末，插件数据不在该限额内。命名卷由用户长期保留。

最新 NAS 镜像为 `tvbox-core:linux-amd64-cache-20261015`，加入崩溃恢复和默认256MiB
的 DEX/模块合计缓存限额。沿用上面的 `session` 命令并替换镜像标签，可用
`--runtime-cache-bytes BYTES` 调整；JAR下载缓存仍单独默认128MiB。

文件锁随进程退出自动释放，已验证不同容器均为PID1时的互斥与强杀恢复。`.lease`
和`.users`是持续保留的锁文件，不能凭“文件存在”判断存活或直接删除。v1旧版
PID锁需先停止旧客户端，再显式使用一次 `--recover-legacy-lock` 迁移。
[所有权、指标及配额说明](../backend/spider-runtime/CACHE.md) 列出完整边界。

此256MiB限额约束转换DEX及JS模块持久缓存，包含写入暂存空间；正在使用的DEX
保留到JVM退出。转换工作目录位于 `/tmp`，另受256MiB tmpfs约束。原生补丁、
rootfs、插件文件及NAS全盘不在上述配额中。[实测记录](../docs/linux/cache-lifecycle-probe.json)
包含最终镜像、崩溃/限额/真实首页和离线自检结果。新版仍无常驻Web服务或自启动项。

最新路径适配镜像为 `tvbox-core:linux-amd64-routes-20261015`。全局 spider 支持
`img+http…` 包装；站点 JAR 支持 assets、file、clan 的原安卓路由。显式绑定目录：

```sh
docker run --rm --read-only --tmpfs /tmp:rw,exec,nosuid,nodev,size=256m \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --memory 2g \
  -v tvbox-core-data:/data -v "$PWD/input:/input:ro" \
  tvbox-core:linux-amd64-routes-20261015 \
  session --native --url 'http://www.饭太硬.net/tv' --source Aid \
  --method homeContent --args '[true]' --strict-md5 \
  --asset-root /input/assets --external-root /input/sdcard --file-root /input/files
```

这些目录由调用方准备，用于订阅实际指定 assets/file 时查找。assets 复制到受限缓存，
file 直接使用调用方文件；更新活动本地 JAR 时使用原子替换并重新导入。需要现有
clan 本地文件服务时可传 `--local-address http://服务地址/`，CLI 不会另起文件服务。
全局与站点分支不同，订阅原始预处理也可能先把 file/clan 字符串转成 HTTP。

使用显式数据目录时，原生后端可能在其 `runtime/tmp` 下解压 JNI 库，该目录所在
挂载必须允许执行；仅把 `/tmp` 设为 exec 不能改变另一个 noexec 数据挂载。本次
真实 CLI 检查使用退出即销毁的 64MiB exec `/data` tmpfs，日常持久化仍使用数据卷。

NAS 已验证五种路径的实际 Spider 调用、重导入与缓存重启，及真实 Aid 首页。
该增量镜像约488MiB，仅新增约56KiB共享层；没有加入编译器、发布端口或常驻服务。
[路径实测报告](../docs/linux/artifact-routes-probe.json) 保留镜像、源码哈希与验证边界。
