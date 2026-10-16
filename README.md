# NASBox

面向 Linux／NAS 的 TVBox 订阅与脚本执行后端。当前交付是 **命令行与 Docker 核心**；Web 服务、播放器、解码和转码尚未接入。

2026-10-16 已按用户要求删除原开发机的项目专用环境和私有输入，源码完成远端保存后删除本地副本。旧报告中的本机保留路径不再有效；重新开发请先克隆并按交接文档准备环境。私有输入没有上传，无法从GitHub恢复。

由 Win-Box 源码继续演进，优先验证固定 Android TVBoxOS 的订阅协议和脚本行为。原 Windows 项目说明保存在 [README-UPSTREAM.md](README-UPSTREAM.md)，上游历史、作者署名和各组件许可保留。

## 当前能力

| 类型 | 已实现及验证 | 边界 |
| --- | --- | --- |
| 订阅 | 解密、相对路径、集合、配置状态、持久缓存与切换 | Android 网络状态和完整异步 UI 行为未完全复现 |
| JS／DRPY | QuickJS、模块依赖、部分 HTTP／HTML 宿主；3个真实源完成 NAS 业务与原版 ART 同参数观察 | 有在线响应差异；解析返回不代表可播放 |
| JSON／XML CMS | 正式订阅分发：首页、推荐、分类／筛选、搜索、详情及播放元数据；4个真实源 NAS 实测 | 部分源 HTTP403／响应格式错误；1例补充重放记录不足 |
| JAR | JVM／DEX转换、部分Android宿主与ARM/JNI执行；历史完整矩阵和独立业务报告保留 | **当前暂停推进**；新CMS镜像没有重跑全JAR矩阵，不能声称全部兼容 |
| Python、type4 | 能解析配置 | 执行器尚未实现 |

最近完整检查：**698项 native-enabled 测试通过，0失败、0跳过**。这是项目测试数，不是脚本兼容数量。

## 从这里开始

- 接手开发：[HANDOFF.md](HANDOFF.md)
- 当前状态与报告：[文档索引](docs/linux/README.md)
- 后续工作：[路线图](docs/linux/roadmap.md)
- Docker构建与运行：[docker/README.md](docker/README.md)
- 环境路径、占用和清理：[environment.md](docs/linux/environment.md)
- 组件许可：[LICENSES.md](LICENSES.md)

## Linux／NAS 快速开始

使用现有 Docker 构建 Linux amd64 镜像；首次构建需要下载固定依赖并校验摘要：

```sh
docker buildx build --platform linux/amd64 --load \
  -f docker/Dockerfile -t nasbox:local .

docker run --rm --network none --read-only \
  --tmpfs /tmp:rw,exec,nosuid,nodev,size=256m nasbox:local
```

默认命令是一次性离线自检，输出 `ok:true` 后退出，不创建常驻服务或Web端口。`/tmp` 需要 `exec` 以供JNI库加载。

导入自己的订阅并调用实际源：

```sh
docker run --rm --read-only --tmpfs /tmp:rw,exec,nosuid,nodev,size=256m \
  -v nasbox-data:/data nasbox:local \
  session --url 'https://example.invalid/config.json' \
  --source 'YOUR_SOURCE_KEY' --method homeContent --args '[true]' --remote-modules
```

把示例URL和source key换成自己配置中的实际值。JSON／XML CMS不需要 `--native`；需要ARM原生桥的JAR才使用该选项。`--remote-modules` 用于显式允许JS模块获取。数据卷保存订阅状态和缓存，不会随容器退出自动删除。

当前已在物理NAS实测的镜像是本地标签 `tvbox-core:linux-amd64-cms-20261016`，详见交接文档；**尚未发布镜像到镜像仓库或GitHub Release**。从本源码构建的新镜像不保证与报告中的本地镜像ID相同。当前只验证Linux amd64，不能直接承诺ARM NAS支持。

本地运行兼容测试需 Node24+、现有JDK17和已固定的开发依赖：

```sh
TVBOX_TEST_NATIVE=1 node --disable-warning=ExperimentalWarning \
  --import ./scripts/compat/typescript-loader.mjs \
  --test --test-reporter=spec compat/*.test.mjs
```

Linux后端测试不依赖安装Electron。依赖准备和fresh-clone限制见交接文档；不要为了运行后端而重复安装桌面环境。

## 数据与许可

仓库提供源码、固定参考源码、自有测试和允许公开的报告；实际订阅、第三方脚本／JAR、APK、原始响应、凭据、SDK/JDK和构建缓存不随Git提交。本机 `.data/`、`.tools/`、`.cache/` 均被忽略；跨机器交接时公开报告不能替代缺失的原输入字节。

原Win-Box部分按MIT许可保留。TVBoxOS衍生后端／参考及相关工具采用GPL-3.0-only，第三方组件另有许可，**不能把整个NASBox简单称为MIT**。具体适用范围及NOTICE见 [LICENSES.md](LICENSES.md)。本项目不内置内容服务或第三方私有源。
