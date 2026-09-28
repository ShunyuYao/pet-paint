# 桌宠颜料大作战 · 规格

两队用颜料涂书桌，时间到时涂得多的一队赢。2–4 人局域网联机（桌宠「发送并一起玩」+ 控制栏「＋ 邀请」），也可以单人对电脑。每个人用自己的桌宠上场：3D 布偶或 2D 立绘。

每条规则后面的「→」是对应的自动化断言，全部由真实输入（按键、鼠标、文件选择）驱动。

## §1 地图：书桌
- 28 × 18 米，以中心点对称；障碍物（笔记本电脑、书堆、马克杯、铅笔）挡人、挡子弹、不能涂。→ `rules: arena is point-symmetric…`、`walls stop movement`
- 两端是出生点：橘队在左，蓝队在右；敌方颜料涂不进出生点，出生点不计分。→ `rules: obstacles and the enemy base never take paint…`

## §2 格子与合并
- 地面切成 224 × 144 个 12.5 厘米的格子，画面、判定、计分、小地图都读这一张。
- 每格记住「最后一次被涂的时间（对局毫秒 × 8 + 角色序号）和队伍」；只有更新的墨点才能覆盖，所以不管消息先到后到，所有屏幕最终一致。→ `rules: splats merged by paint time give identical grids in any arrival order`、`a newer splat covers an older one…`
- 房主轮播整张地图的分块，合并规则相同，漏收的墨点下一轮补齐。→ `rules: rotating chunks bring a grid that missed splats back in line`

## §3 移动
- 跑步 5.5 米/秒。在自己队的颜料里按住 Shift（或右键）潜进去：10 米/秒；在光地面上潜不下去。站在敌方颜料里：最多 2 米/秒，不能潜，不掉血。→ `rules: run speed on bare floor, fast dive…`；`browser-e2e: Shift dives in own ink and swims fast`

## §4 墨量
- 满墨 100。潜着每秒回 40；不开火 0.8 秒后每秒回 10。没墨打不出。→ `rules: run speed…（ink refilled）`

## §5 武器
- 喷壶：按住连射，每秒 8 发，每发 1 墨，伤害 35（3 发打倒），射程约 10 米，飞行途中滴墨、落点炸开。→ `rules: sprayer: 8 shots a second…`、`three hits down an enemy…`
- 滚刷：点一下向前甩出 7 滴（10 墨）；按住 0.25 秒后推着刷，身前 1.6 米宽一条，每米 1 墨；推着撞上敌人直接打倒。→ `rules: roller…`；`browser-e2e: the roller painted our colour`、`a mouse click flicks paint`

## §6 生命与复活
- 生命 100；1.5 秒没挨打后每秒回 30。打倒后 4 秒在自己出生点复活，复活后 1.5 秒无敌。→ `rules: three hits down an enemy, who respawns at base after 4 s with spawn protection`
- 命中由开枪的一方判定（看到打中就算），扣血、打倒、复活统一由房主裁决。

## §7 对局
- 大厅 → 倒计时 3 秒（不能动）→ 对战（1 / 2 / 3 分钟）→ 再等 0.5 秒收完路上的墨点 → 结算。→ `rules: countdown freezes players; timer ends the match…`；`browser-e2e: the countdown freezes movement`
- 可涂面积里各队的占比，高的赢；格子数完全相同算平局。→ `rules: identical cell counts are a draw`
- 分队：1 人和电脑（1v1 / 2v2）；联机时按人数最多的一队补电脑到同样人数（2 人 1v1，3 人 2v1 + 1 个电脑，4 人 2v2）。→ `net: host + 2 guests: lobby → 2v2 with a computer player`

## §8 电脑玩家
- 看到 8–12 米内的敌人就边横移边射击（反应时间、瞄准误差按难度）；墨量低于 20% 回自己颜料里潜着回墨；其余时间找附近最值得涂的地方去涂。→ `rules: a 2v2 match of computer players paints the floor and nobody stays stuck`

## §9 画面与角色
- 斜 50° 俯视，镜头跟着自己，朝瞄准方向略微前探；光标瞄准，不需要锁定鼠标（宿主不允许）。
- 形象三种：3D 布偶（`pet.character.getRealtime()` 或导入角色包）、2D 立牌（当前桌宠的图，或导入图片）、内置玩具（电脑玩家、普通浏览器）。队伍颜色只加在武器、脚下圆环和名字牌上。→ `browser-e2e: a picture becomes a 2D standee`、`a doll pack becomes a 3D doll`；`host-e2e: each pet is drawn as its own 2D / 3D kind on every screen`
- 潜墨：角色往地面以下沉，颜料表面以下被裁切（three.js `clippingPlanes`），3D 和 2D 用同一招；潜着时武器收起。
- Esc 在宿主里会直接关掉游戏窗口，所以游戏里不用 Esc；P 显示键位。

## §10 联机
- 只走局域网，星形：客人只连房主。每台机器算自己的角色、子弹和墨点；房主另外算电脑玩家并当裁判。
- 只用 latest 通道（reliable 整个会话只有 1,024 条）：`hello / up / ping`（客人→房主）、`st / map / pong`（房主→客人），共 6 个 key。事件带序号，对方确认前一直重发；事件列表打包成一个 JSON 字符串。
- 频率：客人 `up` 每秒 20 次；房主 `st` 广播每秒 20 次（大厅里 5 次）、`map` 每秒 2 次。每条客人通道不超过每秒 30 条。→ `net: … no channel went over 30 sends/s`
- 形象用 `transfer` 发给房主，房主转发给其他人；形象包先于自我介绍到达时先暂存，对上号再生效。
- 所有人准备好才开局；开局后才进来的人观战到下一局。客人中途离开由电脑接管；房主离开整个房间结束。→ `net: a guest leaving mid-match is taken over…`；`host-e2e: a guest leaving is taken over by a computer…`、`host closing the game ends the room…`
- 结算以房主为准；各屏的地盘哈希必须一致。→ `net: … same turf everywhere`；`host-e2e: identical result and identical turf (grid hash) on all three hosts`

## §11 测试
| 命令 | 内容 |
|---|---|
| `npm run test:rules` | 规则单测（node） |
| `npm run test:net` | 1 房主 + 2 客人的联机测试，模拟宿主会话规则，3% 丢包 |
| `npm run test:browser` | 普通浏览器：真实按键、鼠标、文件选择打完一局 |
| `npm run test:host` | 三台真实桌宠宿主：真实发送、配对、授权、控制栏邀请、各自键盘打完一局 |

宿主端测试需要本仓库上一级的桌宠测试版源码（`PAINT_HOST_ROOT` 可指定），以及 `../rat-doll-lab/dist` 下的本地角色包（私人素材，不进仓库）。
