# 桌宠颜料大作战

一个单文件 HTML 的颜料抢地盘游戏，给「吐梨邦」桌宠的 HTML 作品能力做的。两队用颜料涂书桌，时间到时涂得多的一队赢；在自己的颜料里可以潜进去，游得快、回墨快。

- 在桌宠里打开：自动带入你当前的桌宠（3D 布偶或 2D 立绘）。
- 和朋友一起玩：在桌宠里「发送并一起玩」这份 HTML，再用游戏窗口控制栏的「＋ 邀请」拉第 3、4 个人，最多 4 人，支持局域网与互联网中转。
- 单人练习：普通浏览器直接打开也能玩，对电脑 1v1 或 2v2。

交付文件：`dist/桌宠颜料大作战.html`（three.js、cannon-es 与全部代码内联，无需 CDN，互联网联机使用宿主中转服务）。

需要桌宠测试版 0.26.0-internal.8 及以上（4 人房间和消息积压恢复）；更早的宿主会拒绝打开声明了 4 人的作品。

## 键位

| 键 | 作用 |
|---|---|
| W A S D / 方向键 | 移动 |
| 鼠标 | 瞄准 |
| 左键（按住）或 J / 空格 | 开火；滚刷按住推着刷、点一下往前甩 |
| Shift 或右键（按住） | 在自己的颜料里潜行 |
| P | 显示 / 隐藏键位 |

Esc 在桌宠里会直接关掉游戏窗口，想离开请点右上角「离开」。

## 开发

```bash
npm run build        # dist/桌宠颜料大作战.html
npm run test:rules   # 规则单测
npm run test:net     # 联机逻辑（模拟宿主会话）
npm run test:browser # 普通浏览器端到端
npm run test:host    # 三台真实桌宠宿主端到端（需要本地宿主源码与角色包）
```

规则、数值和每条规则对应的测试见 [docs/SPEC.zh-CN.md](docs/SPEC.zh-CN.md)。

## 第三方

- three.js 0.164.1（MIT）、cannon-es 0.20.0（MIT）：`vendor/lib/`
- pet-ragdoll-renderer 0.2.0（MIT）：`vendor/doll/`，说明见其中的 NOTICE.md
- 其余美术（场景、道具、武器、角色玩具）和音效都由代码生成，没有外部素材。

MIT License.


## Internet relay / 互联网中转

默认HTML已使用宿主自动选择的LAN / authenticated relay；显式LAN产物另附。复跑方法和验收边界见[本轮交付记录](docs/internet-relay-20261015.md)。The default HTML selects LAN or authenticated relay through the host; an explicit LAN-only build is retained. See the delivery record for prerequisites and measured validation boundaries.

互联网一起玩：双方登录同一桌宠环境、互加好友并保持在线，从小游戏目录选择新版游戏后「发送并一起玩」；第3、4人用游戏窗口的「＋邀请」加入。双方需使用同一份新版HTML，历史消息里旧版游戏不会自动换成新版。
For internet play, sign in to the same host environment, add each other as friends and stay online. Send the updated game and play together; use the window's Invite control for players 3 and 4. All players need the same HTML; an old received file remains the old version.
