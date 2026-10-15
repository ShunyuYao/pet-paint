'use strict';
// Common two-machine setup lives in the explicit game-side acceptance project.
// Game-specific observable assertions remain in this repository.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{spawnSync}=require('node:child_process');
const acceptance=process.env.PET_GAMES_ACCEPTANCE_ROOT;
assert(acceptance&&path.isAbsolute(acceptance),'explicit PET_GAMES_ACCEPTANCE_ROOT required');
const runner=path.join(acceptance,'tests/physical.cjs');assert(fs.existsSync(runner));
const child=spawnSync(process.execPath,[runner,'--game=paint'],{stdio:'inherit',env:{...process.env,PET_GAME_SCENARIO_ROOT:path.resolve(__dirname,'..')}});
process.exitCode=child.status??1;
