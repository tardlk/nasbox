# 真实 JS 源 NAS 业务观察

生成时间：2026/10/16 06:53:06（Asia/Shanghai）

以下为固定脚本与有限真实参数的运行记录，不代表所有脚本或全部业务可用。

生产宿主组的原规则 URL 与业务 HTTP 在线；冻结组以研究用宿主 overlay 返回捕获代码/规则，业务 HTTP 仍在线。两个组分开统计。

`playerContent` 只验证方法返回；非空 URL 可能是原样透传的剧集 ID 或待继续解析的页面，不能据此称为解出媒体或能播放。JS 返回 null、空串、非法 JSON、失败、超时及未测试分别记录。

## 生产宿主：规则与业务在线

源 3，实际收齐 3；固定步骤 30，实际记录 30；获得非空业务响应的源 3。

| 状态 | 次数 |
| --- | ---: |
| nonempty | 28 |
| empty | 1 |
| not-implemented | 0 |
| invalid-json | 0 |
| network | 0 |
| failed | 0 |
| timeout | 0 |
| not-tested | 1 |

null 返回 0；独立 runtime 续测 0；十步骤均非空且同一 runtime 2；player 非空返回 3（原样返回输入 ID 2，parse=1 3）。

清理通过 3/3；容器零退出 3/3；fixture 命中诊断标记 0，在线 HTTP 诊断标记 0。

### 虎牙js

源索引 0，source identity SHA256：59e729b154b61a83a6d648eae759e47a7488fd297e36d36935bfb1c5455f47a7。

| 步骤 | 状态 | runtime |
| --- | --- | ---: |
| home | nonempty | 1 |
| home-video | nonempty | 1 |
| category-page1 | nonempty | 1 |
| category-page2 | nonempty | 1 |
| category-filter | nonempty | 1 |
| detail | nonempty | 1 |
| search | nonempty | 1 |
| search-page1 | nonempty | 1 |
| search-detail | nonempty | 1 |
| player | nonempty（parse=1，原样输入 ID） | 1 |

### 斗鱼js

源索引 1，source identity SHA256：117a645b2f7c101b9d0c1a3e6bfbf9d23a403a5c8bedd0a454e7404ec4b04d9a。

| 步骤 | 状态 | runtime |
| --- | --- | ---: |
| home | nonempty | 1 |
| home-video | nonempty | 1 |
| category-page1 | nonempty | 1 |
| category-page2 | nonempty | 1 |
| category-filter | nonempty | 1 |
| detail | nonempty | 1 |
| search | nonempty | 1 |
| search-page1 | nonempty | 1 |
| search-detail | nonempty | 1 |
| player | nonempty（parse=1，原样输入 ID） | 1 |

### dr_兔小贝

源索引 2，source identity SHA256：64da72ac4c2dfbe23e01012fb61351377e53b4f6599c49beec322d7483cada7a。

| 步骤 | 状态 | runtime |
| --- | --- | ---: |
| home | nonempty | 1 |
| home-video | empty | 1 |
| category-page1 | nonempty | 1 |
| category-page2 | nonempty | 1 |
| category-filter | not-tested | — |
| detail | nonempty | 1 |
| search | nonempty | 1 |
| search-page1 | nonempty | 1 |
| search-detail | nonempty | 1 |
| player | nonempty（parse=1，返回值异于输入 ID） | 1 |

## 研究宿主：代码/规则冻结，业务在线

源 3，实际收齐 3；固定步骤 30，实际记录 30；获得非空业务响应的源 3。

| 状态 | 次数 |
| --- | ---: |
| nonempty | 28 |
| empty | 1 |
| not-implemented | 0 |
| invalid-json | 0 |
| network | 0 |
| failed | 0 |
| timeout | 0 |
| not-tested | 1 |

null 返回 0；独立 runtime 续测 0；十步骤均非空且同一 runtime 2；player 非空返回 3（原样返回输入 ID 2，parse=1 3）。

清理通过 3/3；容器零退出 3/3；fixture 命中诊断标记 3，在线 HTTP 诊断标记 18。

### 虎牙js

源索引 0，source identity SHA256：59e729b154b61a83a6d648eae759e47a7488fd297e36d36935bfb1c5455f47a7。

| 步骤 | 状态 | runtime |
| --- | --- | ---: |
| home | nonempty | 1 |
| home-video | nonempty | 1 |
| category-page1 | nonempty | 1 |
| category-page2 | nonempty | 1 |
| category-filter | nonempty | 1 |
| detail | nonempty | 1 |
| search | nonempty | 1 |
| search-page1 | nonempty | 1 |
| search-detail | nonempty | 1 |
| player | nonempty（parse=1，原样输入 ID） | 1 |

### 斗鱼js

源索引 1，source identity SHA256：117a645b2f7c101b9d0c1a3e6bfbf9d23a403a5c8bedd0a454e7404ec4b04d9a。

| 步骤 | 状态 | runtime |
| --- | --- | ---: |
| home | nonempty | 1 |
| home-video | nonempty | 1 |
| category-page1 | nonempty | 1 |
| category-page2 | nonempty | 1 |
| category-filter | nonempty | 1 |
| detail | nonempty | 1 |
| search | nonempty | 1 |
| search-page1 | nonempty | 1 |
| search-detail | nonempty | 1 |
| player | nonempty（parse=1，原样输入 ID） | 1 |

### dr_兔小贝

源索引 2，source identity SHA256：64da72ac4c2dfbe23e01012fb61351377e53b4f6599c49beec322d7483cada7a。

| 步骤 | 状态 | runtime |
| --- | --- | ---: |
| home | nonempty | 1 |
| home-video | empty | 1 |
| category-page1 | nonempty | 1 |
| category-page2 | nonempty | 1 |
| category-filter | not-tested | — |
| detail | nonempty | 1 |
| search | nonempty | 1 |
| search-page1 | nonempty | 1 |
| search-detail | nonempty | 1 |
| player | nonempty（parse=1，返回值异于输入 ID） | 1 |

## 两组观察比较

两组各自从真实响应推导参数。只有参数相同时才比较响应；在线响应差异不直接归因于核心缺陷。

方法配对 30；参数相同 19；参数不同、不可直接比较 10；未测试 1。

相同参数且 JSON 语义相同 14；相同参数但在线响应不同 5。

日志数字是捕获快照中的诊断标记观察次数，可能重复或碰撞，不是精确 HTTP 请求数。
