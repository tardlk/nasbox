# 已跑通 JAR 的配置入口业务复测

生成时间：2026-10-15T14:45:58.667Z

本报告验证已选 JAR 的全部已配置入口；每个入口只覆盖实际记录的有限业务参数。

播放解析仅检查 `playerContent` 返回，不下载或播放媒体。非空 URL 不等于可播放。ART 基类默认方法、合法空响应、失败和未测试分别统计。

## 原始主包与站点包场景

配置场景 15；ART ready 15；NAS ready 10；NAS 有非空业务响应的场景 9。

固定步骤槽位 150；ART 实际记录 150、未到达 0；NAS 实际记录 150、未到达 0。未到达仍计入 not-tested。

| 方法结果 | ART | NAS |
| --- | ---: | ---: |
| nonempty | 94 | 56 |
| empty | 15 | 19 |
| not-implemented | 14 | 0 |
| invalid-json | 0 | 0 |
| network | 0 | 0 |
| failed | 0 | 0 |
| timeout | 0 | 1 |
| not-tested | 27 | 74 |

NAS 清理检查通过 15/15；容器零退出 15/15；实际原参数重放 76 次。

| JAR SHA256 | 配置场景 | NAS ready | 非空响应场景 |
| --- | ---: | ---: | ---: |
| 53628417aa7bd3e18c0526d690fab4cc340c4e1e87b8e679e9f5ccad80289961 | 1 | 0 | 0 |
| 522f5fb49d914102833f3f4814dc83b1785417ff0decc43729b79d96421c591f | 1 | 0 | 0 |
| 6e673a1cfd39c7d1c895fd19d8ef1811792fd469e0b62597187c3b8af5f99903 | 3 | 2 | 2 |
| 7d1eeeb6b3f0e911351858a67ef431f8f9e8e613af9a733ba76e54af0676a997 | 1 | 1 | 1 |
| 90583683bd79fe45e9ff161e38441a45e9bb0d7520274b55bb51cf4eb8e70289 | 6 | 6 | 5 |
| 33a5113b5ecefe33ad0dc7eb980f231a57ec195a0843117c728aec625a63267d | 2 | 0 | 0 |
| 2c81aed7bf1a86da4f22e1ffb680a2914639dcc6eec31a146a3fdaa12fd2dbf1 | 1 | 1 | 1 |

原始场景未执行 binding：10。缺原主包的独立诊断不改变这些未执行记录。

### 0-0 · csp_SP360

JAR：53628417aa7bd3e18c0526d690fab4cc340c4e1e87b8e679e9f5ccad80289961；source key SHA256：ada737ab86115dfd17b7488f95d233db053cfff533e0674320bc423f4d441d2e。ART ready；NAS failed。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | not-tested | not-tested |
| home-video | nonempty | not-tested | not-tested |
| category-page1 | nonempty | not-tested | not-tested |
| category-page2 | nonempty | not-tested | not-tested |
| category-filter | nonempty | not-tested | not-tested |
| detail | nonempty | not-tested | not-tested |
| search | nonempty | not-tested | not-tested |
| search-page1 | nonempty | not-tested | not-tested |
| search-detail | nonempty | not-tested | not-tested |
| player | nonempty | not-tested | not-tested |

### 1-0 · csp_Douban

JAR：522f5fb49d914102833f3f4814dc83b1785417ff0decc43729b79d96421c591f；source key SHA256：d442cd087c0f307ca189c278ca5468caf4caf1f86f80c2c203d512596f4b84d6。ART ready；NAS not-tested。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | not-tested | not-tested |
| home-video | not-implemented | not-tested | not-tested |
| category-page1 | nonempty | not-tested | not-tested |
| category-page2 | nonempty | not-tested | not-tested |
| category-filter | nonempty | not-tested | not-tested |
| detail | not-implemented | not-tested | not-tested |
| search | not-implemented | not-tested | not-tested |
| search-page1 | not-implemented | not-tested | not-tested |
| search-detail | not-tested | not-tested | not-tested |
| player | not-tested | not-tested | not-tested |

### 2-0 · csp_Kugou

JAR：6e673a1cfd39c7d1c895fd19d8ef1811792fd469e0b62597187c3b8af5f99903；source key SHA256：f54ffed6d068e1ada8ef8a882682ab15365cd6b64111f8dbff84da8ffd64e4e6。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-nonempty-json |
| home-video | not-implemented | empty | method-not-implemented |
| category-page1 | nonempty | nonempty | same-nonempty-json |
| category-page2 | empty | empty | both-empty |
| category-filter | not-tested | not-tested | not-tested |
| detail | nonempty | nonempty | same-nonempty-json |
| search | not-implemented | empty | method-not-implemented |
| search-page1 | not-implemented | empty | method-not-implemented |
| search-detail | not-tested | not-tested | not-tested |
| player | nonempty | nonempty | live-nonempty-response-difference |

### 2-1 · csp_Kugou

JAR：6e673a1cfd39c7d1c895fd19d8ef1811792fd469e0b62597187c3b8af5f99903；source key SHA256：f54ffed6d068e1ada8ef8a882682ab15365cd6b64111f8dbff84da8ffd64e4e6。ART ready；NAS not-tested。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | not-tested | not-tested |
| home-video | not-implemented | not-tested | not-tested |
| category-page1 | nonempty | not-tested | not-tested |
| category-page2 | empty | not-tested | not-tested |
| category-filter | not-tested | not-tested | not-tested |
| detail | nonempty | not-tested | not-tested |
| search | not-implemented | not-tested | not-tested |
| search-page1 | not-implemented | not-tested | not-tested |
| search-detail | not-tested | not-tested | not-tested |
| player | nonempty | not-tested | not-tested |

### 2-2 · csp_Kugou

JAR：6e673a1cfd39c7d1c895fd19d8ef1811792fd469e0b62597187c3b8af5f99903；source key SHA256：f54ffed6d068e1ada8ef8a882682ab15365cd6b64111f8dbff84da8ffd64e4e6。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-nonempty-json |
| home-video | not-implemented | empty | method-not-implemented |
| category-page1 | nonempty | nonempty | same-nonempty-json |
| category-page2 | empty | empty | both-empty |
| category-filter | not-tested | not-tested | not-tested |
| detail | nonempty | nonempty | same-nonempty-json |
| search | not-implemented | empty | method-not-implemented |
| search-page1 | not-implemented | empty | method-not-implemented |
| search-detail | not-tested | not-tested | not-tested |
| player | nonempty | nonempty | live-nonempty-response-difference |

### 3-0 · csp_Nmvod

JAR：7d1eeeb6b3f0e911351858a67ef431f8f9e8e613af9a733ba76e54af0676a997；source key SHA256：2e2eadd9e41c4e05d19cd948fc349eab6f86200635c2cbf2a17c94d44e0e143b。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-nonempty-json |
| home-video | not-implemented | empty | method-not-implemented |
| category-page1 | nonempty | nonempty | same-nonempty-json |
| category-page2 | nonempty | nonempty | same-nonempty-json |
| category-filter | not-tested | not-tested | not-tested |
| detail | nonempty | nonempty | same-nonempty-json |
| search | nonempty | nonempty | same-nonempty-json |
| search-page1 | nonempty | nonempty | same-nonempty-json |
| search-detail | nonempty | nonempty | same-nonempty-json |
| player | nonempty | nonempty | same-nonempty-json |

### 4-0 · csp_XYQHiker

JAR：90583683bd79fe45e9ff161e38441a45e9bb0d7520274b55bb51cf4eb8e70289；source key SHA256：10bd79e8dfddcd0ee1e67cf2ce780e57b3e52bd6ce0ac36989b648bcca980584。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-nonempty-json |
| home-video | empty | empty | both-empty |
| category-page1 | nonempty | nonempty | live-nonempty-response-difference |
| category-page2 | nonempty | nonempty | live-nonempty-response-difference |
| category-filter | not-tested | not-tested | not-tested |
| detail | nonempty | nonempty | same-nonempty-json |
| search | nonempty | nonempty | same-nonempty-json |
| search-page1 | nonempty | nonempty | same-nonempty-json |
| search-detail | nonempty | nonempty | same-nonempty-json |
| player | nonempty | nonempty | same-nonempty-json |

### 4-1 · csp_XYQHiker

JAR：90583683bd79fe45e9ff161e38441a45e9bb0d7520274b55bb51cf4eb8e70289；source key SHA256：4bf8ce6177d5107f730a9ded0de476d07b526d5146704d99b241e45795ccc8fd。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-nonempty-json |
| home-video | empty | empty | both-empty |
| category-page1 | nonempty | nonempty | same-nonempty-json |
| category-page2 | empty | empty | both-empty |
| category-filter | not-tested | not-tested | not-tested |
| detail | nonempty | nonempty | same-nonempty-json |
| search | nonempty | nonempty | same-nonempty-json |
| search-page1 | nonempty | nonempty | same-nonempty-json |
| search-detail | nonempty | nonempty | same-nonempty-json |
| player | nonempty | nonempty | same-nonempty-json |

### 4-2 · csp_XYQHiker

JAR：90583683bd79fe45e9ff161e38441a45e9bb0d7520274b55bb51cf4eb8e70289；source key SHA256：36c33150482c67e7894259d3748f89282439ff74dd45764c8a31501733df1f10。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | timeout | status-difference |
| home-video | empty | not-tested | not-tested |
| category-page1 | empty | not-tested | not-tested |
| category-page2 | empty | not-tested | not-tested |
| category-filter | not-tested | not-tested | not-tested |
| detail | not-tested | not-tested | not-tested |
| search | not-tested | not-tested | not-tested |
| search-page1 | not-tested | not-tested | not-tested |
| search-detail | not-tested | not-tested | not-tested |
| player | not-tested | not-tested | not-tested |

### 4-3 · csp_XYQHiker

JAR：90583683bd79fe45e9ff161e38441a45e9bb0d7520274b55bb51cf4eb8e70289；source key SHA256：10bd79e8dfddcd0ee1e67cf2ce780e57b3e52bd6ce0ac36989b648bcca980584。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | empty | status-difference |
| home-video | empty | empty | both-empty |
| category-page1 | nonempty | nonempty | live-nonempty-response-difference |
| category-page2 | nonempty | nonempty | live-nonempty-response-difference |
| category-filter | not-tested | not-tested | not-tested |
| detail | nonempty | nonempty | same-nonempty-json |
| search | nonempty | nonempty | same-nonempty-json |
| search-page1 | nonempty | nonempty | same-nonempty-json |
| search-detail | nonempty | nonempty | same-nonempty-json |
| player | nonempty | nonempty | same-nonempty-json |

### 4-4 · csp_XYQHiker

JAR：90583683bd79fe45e9ff161e38441a45e9bb0d7520274b55bb51cf4eb8e70289；source key SHA256：4bf8ce6177d5107f730a9ded0de476d07b526d5146704d99b241e45795ccc8fd。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-nonempty-json |
| home-video | empty | empty | both-empty |
| category-page1 | nonempty | nonempty | same-nonempty-json |
| category-page2 | empty | empty | both-empty |
| category-filter | not-tested | not-tested | not-tested |
| detail | nonempty | nonempty | same-nonempty-json |
| search | nonempty | nonempty | same-nonempty-json |
| search-page1 | nonempty | nonempty | same-nonempty-json |
| search-detail | nonempty | nonempty | same-nonempty-json |
| player | nonempty | nonempty | same-nonempty-json |

### 4-5 · csp_XYQHiker

JAR：90583683bd79fe45e9ff161e38441a45e9bb0d7520274b55bb51cf4eb8e70289；source key SHA256：36c33150482c67e7894259d3748f89282439ff74dd45764c8a31501733df1f10。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-nonempty-json |
| home-video | empty | empty | both-empty |
| category-page1 | empty | empty | both-empty |
| category-page2 | empty | empty | both-empty |
| category-filter | not-tested | not-tested | not-tested |
| detail | not-tested | not-tested | not-tested |
| search | not-tested | not-tested | not-tested |
| search-page1 | not-tested | not-tested | not-tested |
| search-detail | not-tested | not-tested | not-tested |
| player | not-tested | not-tested | not-tested |

### 5-0 · csp_Bili

JAR：33a5113b5ecefe33ad0dc7eb980f231a57ec195a0843117c728aec625a63267d；source key SHA256：0251d092c8e3c739d9ef48790986f8da015bf699997fa5b085d9c20f085a03c2。ART ready；NAS not-tested。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | not-tested | not-tested |
| home-video | nonempty | not-tested | not-tested |
| category-page1 | nonempty | not-tested | not-tested |
| category-page2 | nonempty | not-tested | not-tested |
| category-filter | not-tested | not-tested | not-tested |
| detail | nonempty | not-tested | not-tested |
| search | nonempty | not-tested | not-tested |
| search-page1 | nonempty | not-tested | not-tested |
| search-detail | nonempty | not-tested | not-tested |
| player | nonempty | not-tested | not-tested |

### 5-1 · csp_Bili

JAR：33a5113b5ecefe33ad0dc7eb980f231a57ec195a0843117c728aec625a63267d；source key SHA256：d336867f96f85953c131c44a2ee655549d2cc2ba646305669c16fbc26eb3f3c8。ART ready；NAS not-tested。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | not-tested | not-tested |
| home-video | nonempty | not-tested | not-tested |
| category-page1 | nonempty | not-tested | not-tested |
| category-page2 | nonempty | not-tested | not-tested |
| category-filter | not-tested | not-tested | not-tested |
| detail | nonempty | not-tested | not-tested |
| search | nonempty | not-tested | not-tested |
| search-page1 | nonempty | not-tested | not-tested |
| search-detail | nonempty | not-tested | not-tested |
| player | nonempty | not-tested | not-tested |

### 6-0 · csp_SP33

JAR：2c81aed7bf1a86da4f22e1ffb680a2914639dcc6eec31a146a3fdaa12fd2dbf1；source key SHA256：eda4e0203a911d2d572435501fb7f21acddfc397887a205e3441556cd8e794e2。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-nonempty-json |
| home-video | nonempty | nonempty | same-nonempty-json |
| category-page1 | nonempty | nonempty | same-nonempty-json |
| category-page2 | nonempty | nonempty | same-nonempty-json |
| category-filter | nonempty | nonempty | same-nonempty-json |
| detail | nonempty | nonempty | same-nonempty-json |
| search | nonempty | nonempty | same-nonempty-json |
| search-page1 | nonempty | nonempty | same-nonempty-json |
| search-detail | nonempty | nonempty | same-nonempty-json |
| player | nonempty | nonempty | same-nonempty-json |

## 缺原主包的独立诊断（不能回填原订阅兼容）

配置场景 10；ART ready 10；NAS ready 10；NAS 有非空业务响应的场景 8。

固定步骤槽位 100；ART 实际记录 88、未到达 12；NAS 实际记录 88、未到达 12。未到达仍计入 not-tested。

| 方法结果 | ART | NAS |
| --- | ---: | ---: |
| nonempty | 40 | 40 |
| empty | 19 | 10 |
| not-implemented | 2 | 0 |
| invalid-json | 0 | 0 |
| network | 0 | 0 |
| failed | 0 | 0 |
| timeout | 2 | 2 |
| not-tested | 37 | 48 |

NAS 清理检查通过 10/10；容器零退出 10/10；实际原参数重放 52 次。

| JAR SHA256 | 配置场景 | NAS ready | 非空响应场景 |
| --- | ---: | ---: | ---: |
| 9a742d08c655879c6173d68e29c73d2979e685100a95115497209cc61e81cbad | 8 | 8 | 6 |
| 522f5fb49d914102833f3f4814dc83b1785417ff0decc43729b79d96421c591f | 2 | 2 | 2 |

### 0-0 · csp_XBPQ

JAR：9a742d08c655879c6173d68e29c73d2979e685100a95115497209cc61e81cbad；source key SHA256：4abb8fa718b5a3b4a8d770fac8bcf44dab8007e1a8c4f5b078feab40e8be5237。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-nonempty-json |
| home-video | nonempty | nonempty | same-nonempty-json |
| category-page1 | nonempty | nonempty | same-nonempty-json |
| category-page2 | nonempty | nonempty | same-nonempty-json |
| category-filter | nonempty | nonempty | same-nonempty-json |
| detail | nonempty | nonempty | live-nonempty-response-difference |
| search | nonempty | nonempty | same-nonempty-json |
| search-page1 | nonempty | nonempty | same-nonempty-json |
| search-detail | nonempty | nonempty | live-nonempty-response-difference |
| player | nonempty | nonempty | same-nonempty-json |

### 0-1 · csp_XBPQ

JAR：9a742d08c655879c6173d68e29c73d2979e685100a95115497209cc61e81cbad；source key SHA256：ecab89fd68b2879583a9dc295d6cb6012066a7b87c6c5479e9a0bfe0d17e7a44。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-nonempty-json |
| home-video | nonempty | nonempty | same-nonempty-json |
| category-page1 | nonempty | nonempty | same-nonempty-json |
| category-page2 | empty | empty | both-empty |
| category-filter | not-tested | not-tested | not-tested |
| detail | nonempty | nonempty | live-nonempty-response-difference |
| search | timeout | empty | status-difference |
| search-page1 | not-tested | not-tested | not-tested |
| search-detail | not-tested | not-tested | not-tested |
| player | not-tested | not-tested | not-tested |

### 0-2 · csp_XBPQ

JAR：9a742d08c655879c6173d68e29c73d2979e685100a95115497209cc61e81cbad；source key SHA256：6228c19a2088f3bb447de875551d72945f955ec3b61ec0e4239365c8cbf77e2b。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | timeout | nonempty | status-difference |
| home-video | not-tested | not-tested | not-tested |
| category-page1 | not-tested | not-tested | not-tested |
| category-page2 | not-tested | not-tested | not-tested |
| category-filter | not-tested | not-tested | not-tested |
| detail | not-tested | not-tested | not-tested |
| search | not-tested | not-tested | not-tested |
| search-page1 | not-tested | not-tested | not-tested |
| search-detail | not-tested | not-tested | not-tested |
| player | not-tested | not-tested | not-tested |

### 0-3 · csp_XBPQ

JAR：9a742d08c655879c6173d68e29c73d2979e685100a95115497209cc61e81cbad；source key SHA256：c4d534a5da79536755e7d7c86abe0065c21faded917832891498791289505227。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-nonempty-json |
| home-video | empty | nonempty | status-difference |
| category-page1 | empty | empty | both-empty |
| category-page2 | empty | empty | both-empty |
| category-filter | empty | empty | both-empty |
| detail | not-tested | not-tested | not-tested |
| search | not-tested | not-tested | not-tested |
| search-page1 | not-tested | not-tested | not-tested |
| search-detail | not-tested | not-tested | not-tested |
| player | not-tested | not-tested | not-tested |

### 0-4 · csp_XBPQ

JAR：9a742d08c655879c6173d68e29c73d2979e685100a95115497209cc61e81cbad；source key SHA256：652410b413ea7fd76cdcca50838010c04629da222226d35d151c913628b91f29。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-nonempty-json |
| home-video | empty | nonempty | status-difference |
| category-page1 | empty | nonempty | status-difference |
| category-page2 | empty | nonempty | status-difference |
| category-filter | empty | nonempty | status-difference |
| detail | not-tested | not-tested | not-tested |
| search | not-tested | not-tested | not-tested |
| search-page1 | not-tested | not-tested | not-tested |
| search-detail | not-tested | not-tested | not-tested |
| player | not-tested | not-tested | not-tested |

### 0-5 · csp_XBPQ

JAR：9a742d08c655879c6173d68e29c73d2979e685100a95115497209cc61e81cbad；source key SHA256：51862ea995edb74dec7606a286cefe2f13f6d2e07253e2320da787a12c598a9d。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | timeout | status-difference |
| home-video | nonempty | not-tested | not-tested |
| category-page1 | nonempty | not-tested | not-tested |
| category-page2 | empty | not-tested | not-tested |
| category-filter | not-tested | not-tested | not-tested |
| detail | nonempty | not-tested | not-tested |
| search | empty | not-tested | not-tested |
| search-page1 | empty | not-tested | not-tested |
| search-detail | not-tested | not-tested | not-tested |
| player | nonempty | not-tested | not-tested |

### 0-6 · csp_XBPQ

JAR：9a742d08c655879c6173d68e29c73d2979e685100a95115497209cc61e81cbad；source key SHA256：bfa6c552aa1ef265b213517a5e6007ce8c6bf204ebd061ce51f8b073e23b9a49。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-nonempty-json |
| home-video | nonempty | nonempty | same-nonempty-json |
| category-page1 | nonempty | nonempty | same-nonempty-json |
| category-page2 | nonempty | nonempty | same-nonempty-json |
| category-filter | not-tested | not-tested | not-tested |
| detail | nonempty | nonempty | same-nonempty-json |
| search | nonempty | nonempty | same-nonempty-json |
| search-page1 | nonempty | nonempty | same-nonempty-json |
| search-detail | nonempty | nonempty | same-nonempty-json |
| player | nonempty | nonempty | same-nonempty-json |

### 0-7 · csp_XBPQ

JAR：9a742d08c655879c6173d68e29c73d2979e685100a95115497209cc61e81cbad；source key SHA256：99572385c3de1ded4265a3f23ef11b58ea98568886cd3f0f8d439798672737b8。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | timeout | status-difference |
| home-video | empty | not-tested | not-tested |
| category-page1 | empty | not-tested | not-tested |
| category-page2 | empty | not-tested | not-tested |
| category-filter | empty | not-tested | not-tested |
| detail | not-tested | not-tested | not-tested |
| search | not-tested | not-tested | not-tested |
| search-page1 | not-tested | not-tested | not-tested |
| search-detail | not-tested | not-tested | not-tested |
| player | not-tested | not-tested | not-tested |

### 1-0 · csp_AppRJ

JAR：522f5fb49d914102833f3f4814dc83b1785417ff0decc43729b79d96421c591f；source key SHA256：3cff8181754d585e1bcc25409a78d54e1facd5b7c011ff232ca66c9d5450f86c。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-nonempty-json |
| home-video | not-implemented | empty | method-not-implemented |
| category-page1 | nonempty | nonempty | same-nonempty-json |
| category-page2 | nonempty | nonempty | same-nonempty-json |
| category-filter | empty | empty | both-empty |
| detail | nonempty | nonempty | same-nonempty-json |
| search | nonempty | nonempty | same-nonempty-json |
| search-page1 | nonempty | nonempty | same-nonempty-json |
| search-detail | nonempty | nonempty | same-nonempty-json |
| player | nonempty | nonempty | live-nonempty-response-difference |

### 1-1 · csp_Qiyou

JAR：522f5fb49d914102833f3f4814dc83b1785417ff0decc43729b79d96421c591f；source key SHA256：412fbbea0382c29169a9a38e624c10413bdb11b8640325548c2140c52671287e。ART ready；NAS ready。

| 步骤 | ART | NAS | 比较 |
| --- | --- | --- | --- |
| home | nonempty | nonempty | same-nonempty-json |
| home-video | not-implemented | empty | method-not-implemented |
| category-page1 | empty | empty | both-empty |
| category-page2 | empty | empty | both-empty |
| category-filter | not-tested | not-tested | not-tested |
| detail | not-tested | not-tested | not-tested |
| search | not-tested | not-tested | not-tested |
| search-page1 | not-tested | not-tested | not-tested |
| search-detail | not-tested | not-tested | not-tested |
| player | not-tested | not-tested | not-tested |
