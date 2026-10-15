# 桌宠颜料大作战互联网中转联机（2026-10-15）

默认`dist/桌宠颜料大作战.html`声明`transport:auto`，由宿主按好友来源选LAN或relay。另提供`dist/桌宠颜料大作战-LAN.html`及`build-lan.json`。游戏不连接第三方网络地址，不接触账号token，不改宿主SDK、权限或服务器。双方需要同一作品摘要，断线沿原通道重连。

玩法沿用原版4人房间与裁定；颜料继续本机移动/涂色与房主结算；新增终态地图的校验、补发与确认。协议以`game/net.js`和构建回执为准，不能从文件名或版本号推断兼容。

## 可复跑入口

设置`PAINT_HOST_ROOT`为已构建React、已下载LFS素材的隔离宿主；`PAINT_PACKS_DIR`为本机3D形象夹具目录。构建指定`PET_PAINT_ESBUILD`（宿主的esbuild模块绝对路径）。不要读取或修改日常userData。 隔离worktree的`test:browser`另显式设置`PAINT_DOLL_ZIP`（3D包）和`PAINT_IMAGE`（2D帧）；多人`PAINT_PACKS_DIR`不替代这两项。

- `test:artifact`：auto/LAN与实际协议、vendor、摘要、大小和JavaScript语法一致。
- `test:host`：三人生产LAN完整比赛、自己的桌宠形象、真实输入、结算、再战和离场。
- `test:relay` / `test:mixed`：四人生产中转或混合网络；真实socket中断后相同房间恢复，四人的完整比赛与离场。这里是本机多实例，不是实体公网。
- `test:internet`：产物及受影响的网络聚合；`test:delivery`保留原规则、浏览器及相邻回归。
- `test:physical`：必须显式提供`PET_GAMES_ACCEPTANCE_ROOT`（游戏侧独立acceptance工作区）、`PET_HOST_ROOT`（目录含当前游戏）、`PET_GAME_REMOTE_DEPS`（另一Mac的匹配node_modules）、`PET_GAME_TEST_OTP_FILE`（当前用户的0600 Test开发码文件）。编排只使用明确的Test开发短信环境；不得把验证码、手机号或token写入报告/截图。实际玩法断言在本仓库`tests/public-relay-scenario.cjs`。`test:internet:full`聚合本机与实体路径，缺依赖应失败，不算通过。

只通过本机四人不能声称四台实体跨公网；两台实体的公网对局不能代替Windows或弱网长时验证。全过程隐藏首帧、CDP真实键盘和后台截图，记录实际进程退出与账号清理。

## 本轮发现及结果
以下保留失败到修复的追溯，最终候选以末尾验收表为准。

### 已留存的缺陷与修复
- 最终比分到达、局内地图消息缺失时，旧版实际地面可能无法收敛。扩充`test:net`按类型丢包先红；协议2的房主终态checkpoint校验owner字节和result.hash后原子应用，首次checkpoint丢失会重发，客人确认后停止。
- 四人场景两位默认捏捏互相显示为toy：网络跳过重复的本机signature，渲染却只查远端素材。04-31-44-388Z真实应用稳定失败；显示层与大厅缩略图现在复用同signature的本机asset。原四人每屏kind断言保留，未换不同形象避开故障。
- 并发两套四人时文件接收/固定步长计时出现超时；原始失败保留，最终验收逐组运行。一次就绪等待早于UI首帧，将原标题隐藏断言纳入等待。测试素材、验证码及截图均不随公开仓库发布。

### 当前候选
0.2.0 / pet-paint协议2，auto成品SHA256 `26fba604b8e206369620470025071655e876ebd376f51e17de37cabdf4c2cc0f`，702685字节，pet-kit 0.3.0。
四人纯relay `test:relay`：2026-10-15T04-41-59-245Z，17项检查、零异常/失败；包括同形象显示、4/4容量、3秒真实socket断开后原房恢复、四人真实键盘、完整60秒对局、相同终局grid hash、再战/客人和房主离开。首帧隐藏与四个拥有进程的退出均检查通过。这是本机真实生产中转链路，不能单独证明实体公网。
四人`test:mixed`：2026-10-15T04-59-05-092Z OK，17项检查、零异常/失败；一位客人禁LAN走relay，另两位通过生产LAN加入，同样完成整场、地图摘要/比分、再战和关闭。第四人定向发现的测试配置漏项已补齐，每位LAN受邀者须双向发现后再连接；原04-52-27-484Z失败仍保留。

颜料最终26fba604双实体Mac公网：2026-10-15T05-24-25-805Z OK，18项检查、零异常/失败。两端LAN关闭，真实Test登录与好友申请/接受，Vibe目录跨磁盘HTML摘要一致，公网WSS同局，两路真实键盘移动/射击/整局，相同最终grid hash/比分/胜方、再战、客人离开电脑接管通过；首帧隐藏和实际进程退出、服务器端登出清理通过。远端结算截图已后台目视复核。不是四实体或Windows证据。

共享编排closeWork/target销毁检查更新后，颜料26fba604双实体Mac公网重新验收05-50-46-023Z OK，18项检查、零异常/失败；完整涂色、相同终态地图/比分/胜方、再战、客人退出电脑接管、两端实际退出和服务器登出均通过。取代05-24旧编排的最终证据，不合并参数或省略重启。

## 最终验收表

最终成品为0.2.0 / pet-paint协议2 / pet-kit 0.3.0，SHA256 `26fba604b8e206369620470025071655e876ebd376f51e17de37cabdf4c2cc0f`，702685字节；显式LAN版另见build-lan.json。

| 入口 | 本候选证据 | 结果 |
| --- | --- | --- |
| test:rules / test:net / test:artifact | 16条规则、3条网络（含确定性丢包终态恢复）、双产物契约 | 通过，无跳过 |
| test:browser | 最终成品、真实2D/3D导入/输入、涂色/潜行/射击、全局结算/再战/退出，16项 | 通过，95.97秒 |
| test:relay | host-e2e/2026-10-15T04-41-59-245Z | 四人通过 |
| test:mixed | host-e2e/2026-10-15T04-59-05-092Z | 四人通过 |
| test:physical | acceptance/artifacts/physical/paint/2026-10-15T05-50-46-023Z | 两实体Mac禁LAN公网通过，18项 |

聚合入口有登记，但本轮按相同输入去重逐项执行，没有机械重跑test:delivery。未重复三人纯LAN整场，理由和覆盖替代见宿主任务记录；未验证Windows、四实体公网和长时弱网。测试数据/截图/验证码不提交。宿主SDK未变，类型、脚手架、市场无需同步；成品接入宿主Test，不等于安装包已发布。

Final candidate: 0.2.0, protocol 2, host-selected LAN or internet relay. Four local instances passed relay and mixed-network games; two physical Macs passed the public Test relay with LAN disabled, including real controls, exact terminal grid, rematch and departure. Windows, four physical peers and prolonged poor networks remain outside this run. No host installer was published.
