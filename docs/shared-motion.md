# 颜料 0.1.1 · 共用运动呈现

原实现将收包间隔当作运动时间，并持续把显示插值写入模拟坐标；房主转发时又把旧的客人位置当作新样本。批次收包会放大速度突变。现在通过 pet-kit 0.3.0 Motion 按实体缓存原始模拟时间，房主转发同一原始位置及时间；每帧 drawActors 只返回绘制副本，自己操作的角色保持原本的本地控制。接收端使用单调时钟。复活、死亡、换局、掉线 epoch 清理旧轨迹。

## 验证

- 旧版严格失败：artifacts/host-e2e/2026-10-14T13-17-28-845Z，批次收包 P95 速度比约 8.11。
- 最终运动通过：artifacts/host-e2e/2026-10-14T13-51-48-041Z。批次收包 P95 速度比约 1.012，停顿帧约 0.8%；真实生产 LAN/TLS、实际 CDP 按键，临时 HTML 仅插只读坐标点和 180 ms SDK 收包延迟点。背景截图检查完成。源码内不含测试注入。
- 规则 15 项通过；联网 2 项通过，包含 3 玩家位置/原始时间成对转发、绘制不改权威状态、自己角色不插值、丢包后地图一致、退出电脑接管和离房。
- 浏览器 2D/3D 导入、实际走路、翻滚/下潜、涂色、结算和重赛通过。
- 初次完整宿主验证发现旧测试仍要求第三人重复配对；当前账号准入自动建立信任，已按实际准入更新，邀请接受/能力授权仍真实执行。完整三人回归先在 2026-10-14T13-39-25-157Z 通过，最终结算修复的完整三人回归在 `2026-10-14T13-52-52-377Z` 通过：真实三人操作、地图与赛果 hash 一致、客人退出电脑接管、重开及房主退出均通过。
- 命名门禁：test:rules / test:net / test:motion / test:motion-suite / test:host。无缺依赖 SKIP。

## 回归发现的相邻缺陷

联网回归出现“结算 hash 与最终地面 hash 不同”。可稳定复现的规则测试确认：结算已生成后，迟到的 splat 仍被 Game.receive 应用。修复仅冻结 results 阶段的迟到 paint/fire；judge 宽限期仍接收合法在途涂色。红灯断言在规则测试中先执行失败，修复后两项“结算后冻结/宽限期保留”均通过。下轮不能只检查双方结果卡相同，还需核对实际地图 hash。

最终 HTML SHA-256 `a1908336598ec43fd6143c3e2e97804eeb6adeb6fad8dce9ccb9ee3b4515c1a5`，701616 bytes；固定 kit 源码摘要由构建回执记录。邀请双方需要同一份 HTML。未修改宿主 SDK、权限或公开下载渠道。本轮同机隔离实例覆盖生产 LAN，会话账号服务是隔离生产代码；没有覆盖两台物理 Mac、公网、原生焦点和真实 Keychain。

English: A shared timestamp-based buffer now drives render-only remote poses. Relayed guest samples retain their original positions and timestamps; local controls and authoritative gameplay stay separate. Motion, forwarding and gameplay regressions are executable gates. A discovered late-splat settlement bug is covered by failing-then-passing tests while preserving the judge grace period. This run does not claim physical two-machine or public-network validation.
