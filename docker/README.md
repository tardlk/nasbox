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
清理结果；临时订阅、JAR 和解密载荷在退出时清理。生产订阅会话的自动 JAR
下载/更新管理仍未实现，不能把研究探针当作完整生产解析流程。

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
容器停止会结束其全部进程；原生 JAR 清空也会完整更换 JVM。缓存总配额与多
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
