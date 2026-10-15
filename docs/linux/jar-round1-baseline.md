# JAR 第一轮同版本冻结基线

目录订阅 87 项：完整解析 84 项、部分配置 1 项、无配置失败 2 项。

冻结输入 8e9c80c557c5703ff70f8c44fb5a71aaaf3c89d3e0e0d39cdba94cbdaa42a3d3。下载失败 65 项；取得 114 份制品，其中有效 111 份、内容无效 3 份。

旧镜像：sha256:b6e3df0f9f7a9e2fa71bd040551899b1cfebe811dc1034d69a2a133ddbaf534a。最终镜像：sha256:f2f6208a737bd3cfb1826a5059623e1c59d57ce8687590af869d5168bded9318。Runner：df53c8f20d0c33e2d6ccfbcee1201440de40c89d196b288854ff27aaf4cc98af。

| 观测 | 旧镜像 | 最终镜像 |
| --- | ---: | ---: |
| 实际报告 | 114 | 114 |
| 有效制品加载 loaded | 93 | 95 |
| 有效制品加载 failed | 15 | 12 |
| 有效制品加载 timeout | 3 | 4 |
| 有效制品加载 unknown | 0 | 0 |
| 有效制品加载 not-tested | 0 | 0 |
| 初始化 API | 807 | 911 |
| 初始化 ready | 458 | 644 |
| 未初始化变体 | 2552 | 2448 |
| 非空首页 | 47 | 48 |
| 空首页 | 0 | 0 |

每份制品仅选择一个加载角色，同 API 的不同 ext 并未穷举。加载、初始化 ready 与业务非空分别统计；未执行、超时、网络和 JSON 错误均单列。业务响应为在线观察，未证明 Android/ART 一致性，也不据此给出全面兼容率。

| 序号 | JAR SHA 前 12 位 | 角色 | 内容 | 旧加载 → 最终加载 | ready 旧 → 最终 |
| ---: | --- | --- | --- | --- | ---: |
| 000 | b644dc3adc5f | main | 有效 | loaded → loaded | 17 → 17 |
| 001 | 198d4d2860bd | main | 有效 | loaded → loaded | 0 → 47 |
| 002 | cb3bc0de5dde | site | 有效 | loaded → loaded | 0 → 0 |
| 003 | 0e0158a66f88 | main | 有效 | failed → loaded | 0 → 82 |
| 004 | d8517c4cac6e | main | 有效 | failed → failed | 0 → 0 |
| 005 | 65be8df8bfa6 | main | 有效 | failed → failed | 0 → 0 |
| 006 | 5ee56056022f | main | 有效 | loaded → loaded | 1 → 1 |
| 007 | 791b14bd55d3 | main | 有效 | loaded → loaded | 13 → 13 |
| 008 | b2755622dc43 | main | 有效 | loaded → loaded | 22 → 22 |
| 009 | 646c5449e06b | main | 有效 | loaded → loaded | 22 → 23 |
| 010 | 6db260446185 | site | 有效 | loaded → loaded | 1 → 1 |
| 011 | 19ca20400ffa | site | 有效 | failed → failed | 0 → 0 |
| 012 | ed56f35b6794 | site | 有效 | loaded → loaded | 1 → 1 |
| 013 | d9e77852563e | main | 有效 | loaded → loaded | 2 → 2 |
| 014 | 3d530a7d545f | site | 有效 | loaded → loaded | 1 → 1 |
| 015 | ec9ee50530cb | main | 有效 | loaded → loaded | 14 → 14 |
| 016 | 53628417aa7b | site | 有效 | loaded → loaded | 1 → 1 |
| 017 | 2faba4b3cd0e | main | 有效 | loaded → loaded | 3 → 3 |
| 018 | efe994fe9a17 | main | 有效 | loaded → loaded | 4 → 4 |
| 019 | c81eedda82a8 | main | 有效 | loaded → loaded | 0 → 0 |
| 020 | ecd497ec1f33 | main | 有效 | loaded → loaded | 30 → 31 |
| 021 | cf4a252873ac | site | 有效 | loaded → loaded | 0 → 0 |
| 022 | cc3b06eb7b26 | main | 有效 | loaded → loaded | 29 → 29 |
| 023 | 18939df38112 | site | 有效 | failed → failed | 0 → 0 |
| 024 | 914e2a8edf2e | site | 有效 | loaded → loaded | 1 → 1 |
| 025 | 9a742d08c655 | site | 有效 | loaded → loaded | 1 → 1 |
| 026 | 522f5fb49d91 | site | 有效 | loaded → loaded | 3 → 3 |
| 027 | 0c2579f7af90 | site | 有效 | failed → failed | 0 → 0 |
| 028 | 912e7e285904 | site | 有效 | loaded → loaded | 3 → 3 |
| 029 | 15608f024293 | main | 有效 | loaded → loaded | 5 → 5 |
| 030 | a9dce1158db8 | main | 有效 | failed → failed | 0 → 0 |
| 031 | 4073c52fd60d | main | 有效 | loaded → loaded | 11 → 12 |
| 032 | 291c75e13b7d | site | 有效 | loaded → loaded | 0 → 5 |
| 033 | 6e673a1cfd39 | site | 有效 | loaded → loaded | 1 → 1 |
| 034 | 59ca73d4d127 | site | 有效 | failed → failed | 0 → 0 |
| 035 | 7d1eeeb6b3f0 | site | 有效 | loaded → loaded | 1 → 1 |
| 036 | 62aec35b3a4c | site | 有效 | loaded → loaded | 0 → 0 |
| 037 | aa7bb1f1af9f | site | 有效 | loaded → loaded | 1 → 1 |
| 038 | 504fef5418ef | main | 有效 | loaded → loaded | 2 → 2 |
| 039 | 8f84f164e726 | main | 有效 | loaded → loaded | 10 → 30 |
| 040 | 71789158668d | site | 有效 | loaded → loaded | 0 → 0 |
| 041 | 41d3771d1d06 | site | 有效 | timeout → timeout | 0 → 0 |
| 042 | d8982109de0b | site | 有效 | loaded → loaded | 1 → 1 |
| 043 | d5750c1d6067 | site | 有效 | failed → loaded | 0 → 0 |
| 044 | 402f95d10cae | main | 有效 | failed → loaded | 0 → 0 |
| 045 | dfda804bf1fc | main | 有效 | loaded → loaded | 5 → 5 |
| 046 | 8adcedbd51c3 | main | 有效 | loaded → timeout | 21 → 0 |
| 047 | d4568e87ca77 | main | 有效 | loaded → loaded | 4 → 4 |
| 048 | 8a894c42f296 | main | 有效 | loaded → loaded | 1 → 0 |
| 049 | 90583683bd79 | site | 有效 | loaded → loaded | 1 → 1 |
| 050 | 9cd4cea84b04 | main | 有效 | loaded → loaded | 14 → 14 |
| 051 | f19afc0f7d0e | site | 有效 | loaded → loaded | 0 → 0 |
| 052 | 0e622ce7b053 | main | 有效 | loaded → loaded | 4 → 4 |
| 053 | ace8cb399795 | main | 有效 | loaded → loaded | 23 → 23 |
| 054 | fac695331a7b | main | 有效 | loaded → loaded | 8 → 8 |
| 055 | 7c3e0ac413b7 | main | 有效 | loaded → loaded | 29 → 29 |
| 056 | 3a178ab57161 | site | 有效 | loaded → loaded | 1 → 1 |
| 057 | f9c5795cd16c | main | 有效 | loaded → loaded | 27 → 27 |
| 058 | addacc54c0fb | site | 有效 | loaded → loaded | 0 → 0 |
| 059 | bcf8bddc08de | site | 有效 | loaded → loaded | 0 → 0 |
| 060 | 0a23df47492c | site | 有效 | loaded → loaded | 1 → 1 |
| 061 | a2e4d1a9794c | site | 有效 | loaded → loaded | 1 → 1 |
| 062 | 4399167d2ec5 | site | 有效 | loaded → loaded | 1 → 1 |
| 063 | 2c500f0fe0ba | site | 有效 | loaded → loaded | 1 → 1 |
| 064 | 202a342db03f | site | 有效 | loaded → loaded | 1 → 1 |
| 065 | 79ee8f2d74c7 | site | 有效 | loaded → loaded | 1 → 1 |
| 066 | 4bcdfb1c06eb | main | 无效 | failed → failed | 0 → 0 |
| 067 | c587b01c9ebf | site | 有效 | loaded → loaded | 1 → 1 |
| 068 | 2ff484674c51 | main | 有效 | failed → failed | 0 → 0 |
| 069 | 04f73a0bb4c7 | site | 有效 | loaded → loaded | 1 → 1 |
| 070 | a6f32dcb0292 | site | 有效 | loaded → loaded | 1 → 1 |
| 071 | 33a5113b5ece | site | 有效 | loaded → loaded | 1 → 1 |
| 072 | 2b3a1414b382 | site | 有效 | loaded → loaded | 0 → 1 |
| 073 | 7f309c1cfc08 | main | 有效 | loaded → loaded | 2 → 2 |
| 074 | 703ff3315dcb | main | 有效 | loaded → loaded | 3 → 52 |
| 075 | f317a2b97fd2 | main | 有效 | loaded → loaded | 35 → 35 |
| 076 | e35cc76acd93 | main | 有效 | loaded → loaded | 2 → 2 |
| 077 | cf928d087302 | main | 有效 | failed → failed | 0 → 0 |
| 078 | 86a7833c1520 | main | 有效 | loaded → loaded | 17 → 17 |
| 079 | ee9ff15d1093 | main | 有效 | timeout → timeout | 0 → 0 |
| 080 | 8dbf67664700 | site | 有效 | loaded → loaded | 1 → 1 |
| 081 | fd77abad914f | site | 有效 | loaded → loaded | 2 → 2 |
| 082 | 9432ca67798e | main | 有效 | loaded → loaded | 1 → 1 |
| 083 | dd9800ab0767 | site | 有效 | loaded → loaded | 2 → 2 |
| 084 | 3488351e7d72 | main | 有效 | loaded → loaded | 7 → 8 |
| 085 | a41f11e12267 | main | 有效 | failed → failed | 0 → 0 |
| 086 | 665cd562d81c | main | 有效 | loaded → loaded | 0 → 0 |
| 087 | 9ac6f9029a1a | site | 有效 | loaded → loaded | 1 → 1 |
| 088 | cc960779cc21 | site | 有效 | loaded → loaded | 1 → 1 |
| 089 | 6dc9c7fc93bb | site | 无效 | failed → failed | 0 → 0 |
| 090 | e9bad8658f7e | site | 有效 | loaded → loaded | 1 → 1 |
| 091 | c5395ea2984e | main | 有效 | loaded → loaded | 7 → 7 |
| 092 | 40a3db5c3241 | site | 有效 | loaded → loaded | 0 → 0 |
| 093 | 4c8375db7eaf | site | 有效 | loaded → loaded | 4 → 4 |
| 094 | 8666c57ca5c9 | site | 有效 | loaded → loaded | 0 → 0 |
| 095 | 5be94fe8d09d | site | 有效 | loaded → loaded | 1 → 1 |
| 096 | 768e12910de5 | site | 有效 | loaded → loaded | 0 → 0 |
| 097 | 64637af0a0dc | main | 有效 | loaded → loaded | 1 → 1 |
| 098 | 1dd6f444471f | site | 有效 | loaded → loaded | 1 → 1 |
| 099 | a14fcaa2fb67 | site | 有效 | loaded → loaded | 1 → 1 |
| 100 | 92b6747fd42c | site | 有效 | failed → failed | 0 → 0 |
| 101 | 8fb2f6a5a297 | site | 有效 | loaded → loaded | 0 → 0 |
| 102 | 76c7d225a47b | site | 有效 | failed → failed | 0 → 0 |
| 103 | 1c9792284614 | site | 有效 | loaded → loaded | 1 → 1 |
| 104 | 63344691801b | site | 有效 | loaded → loaded | 1 → 1 |
| 105 | 6b727c38e839 | site | 有效 | loaded → loaded | 1 → 1 |
| 106 | 22bdeaa8a6d9 | site | 有效 | loaded → loaded | 2 → 2 |
| 107 | 9c956b18b7e7 | site | 有效 | loaded → loaded | 1 → 1 |
| 108 | c1511704d0b3 | site | 有效 | loaded → loaded | 1 → 1 |
| 109 | 2c81aed7bf1a | site | 有效 | loaded → loaded | 1 → 1 |
| 110 | 856c1b7be73d | main | 有效 | loaded → loaded | 11 → 11 |
| 111 | 2631f5b60676 | site | 有效 | loaded → loaded | 0 → 0 |
| 112 | bcd5f1ae18c0 | main | 无效 | failed → failed | 0 → 0 |
| 113 | 713a2c84b270 | main | 有效 | timeout → timeout | 0 → 0 |
