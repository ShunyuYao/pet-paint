'use strict';
// Shared tuning (SPEC §3–§7). Units: metres, seconds. Nothing here imports anything.
// Values started from the reference game's feel and were scaled to a 28 × 18 m desk.

const ARENA={w:28,h:18,cell:0.125}; // x ∈ [-14,14], z ∈ [-9,9]
ARENA.cols=Math.round(ARENA.w/ARENA.cell);ARENA.rows=Math.round(ARENA.h/ARENA.cell);

const PLAYER={
  hp:100,radius:0.4,
  runSpeed:5.5,diveSpeed:10,enemyInkSpeed:2,
  accel:42,decel:36,diveAccel:60,
  inkMax:100,inkRefillDive:40,inkRefillIdle:10,inkRefillDelay:0.8,
  regenDelay:1.5,regenRate:30,
  respawnTime:4,spawnInvuln:1.5,
};

const WEAPONS={
  sprayer:{id:'sprayer',name:'喷壶',fireInterval:0.125,inkPerShot:1,damage:35,projSpeed:24,range:10,spreadDeg:4,
    trailEvery:1.1,trailRadius:0.35,impactRadius:0.8,moveSpeedFiring:4.4},
  roller:{id:'roller',name:'滚刷',flickInk:10,flickDrops:7,flickSpreadDeg:26,flickSpeed:15,flickRange:6.5,flickDamage:35,flickRadius:0.6,
    flickInterval:0.55,rollDelay:0.25,rollSpeed:4,rollWidth:1.6,rollStep:0.25,rollInkPerMeter:1,rollDamage:100},
};
const WEAPON_IDS=Object.keys(WEAPONS);

const MATCH={durations:[60,120,180],defaultDuration:120,countdown:3,judgeGrace:0.5,finalCountdown:10};

const TEAMS=[{id:0,name:'橘队',color:'#f47a12'},{id:1,name:'蓝队',color:'#2a5bd7'}];

// Timestamps for the last-writer-wins paint grid: match milliseconds × STAMP_SLOTS + actor slot.
const STAMP_SLOTS=8;

module.exports={ARENA,PLAYER,WEAPONS,WEAPON_IDS,MATCH,TEAMS,STAMP_SLOTS};
