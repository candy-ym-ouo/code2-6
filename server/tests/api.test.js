import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { GameStore } from '../store.js';

test('HTTP API 完成读取、预览、结算和重置闭环', async (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-post-api-'));
  const store = new GameStore(path.join(temporaryDirectory, 'state.json'), { seed: 'api-seed' });
  store.load();
  const server = createApp({ store, clientDist: null }).listen(0);
  context.after(() => {
    server.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, options) => {
    const response = await fetch(`${baseUrl}${url}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    return { status: response.status, body: await response.json() };
  };

  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);

  const gameResponse = await request('/api/game');
  assert.equal(gameResponse.status, 200);
  const game = gameResponse.body.state;
  assert.equal(game.day, 1);

  const letter = game.letters.find((item) => item.status === 'inbox');
  const assignment = {
    letterId: letter.id,
    courierId: 'comet',
    targetIslandId: letter.recipientIslandId,
    order: 0
  };

  const previewResponse = await request('/api/game/plan/preview', {
    method: 'POST',
    body: JSON.stringify({ assignments: [assignment] })
  });
  assert.equal(previewResponse.status, 200);
  assert.equal(previewResponse.body.preview.valid, true);

  const advanceBody = JSON.stringify({ assignments: [assignment], expectedRevision: game.revision });
  const advanceResponse = await request('/api/game/day/advance', {
    method: 'POST',
    body: advanceBody
  });
  assert.equal(advanceResponse.status, 200);
  assert.equal(advanceResponse.body.state.day, 2);
  assert.equal(advanceResponse.body.state.revision, 1);
  assert.equal(advanceResponse.body.report.day, 1);

  const duplicateAdvance = await request('/api/game/day/advance', {
    method: 'POST',
    body: advanceBody
  });
  assert.equal(duplicateAdvance.status, 409);
  const stateAfterDuplicate = await request('/api/game');
  assert.equal(stateAfterDuplicate.body.state.day, 2);

  const invalidAssignments = await request('/api/game/plan/preview', {
    method: 'POST',
    body: JSON.stringify({ assignments: '' })
  });
  assert.equal(invalidAssignments.status, 400);

  const missingAssignments = await request('/api/game/plan/preview', {
    method: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(missingAssignments.status, 400);

  const resetResponse = await request('/api/game/reset', {
    method: 'POST',
    body: JSON.stringify({ seed: 'new-run' })
  });
  assert.equal(resetResponse.status, 200);
  assert.equal(resetResponse.body.state.day, 1);
  assert.equal(resetResponse.body.state.seed, 'new-run');
  assert.equal(resetResponse.body.state.phase, 'planning');
});

test('游戏进度写入磁盘后可由新 Store 实例恢复', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-post-store-'));
  const dataFile = path.join(temporaryDirectory, 'state.json');
  const store = new GameStore(dataFile, { seed: 'persistent-seed' });
  store.load();
  store.mutate((state) => {
    state.reputation = 77;
    state.day = 6;
  });

  const reloadedStore = new GameStore(dataFile, { seed: 'ignored-on-existing-file' });
  const reloadedState = reloadedStore.load();

  assert.equal(reloadedState.reputation, 77);
  assert.equal(reloadedState.day, 6);
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('重新开局会递增版本号以避免旧请求命中新局', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-post-reset-'));
  const store = new GameStore(path.join(temporaryDirectory, 'state.json'), { seed: 'reset-seed' });
  const initial = store.load();
  const firstReset = store.reset('reset-one');
  const secondReset = store.reset('reset-two');

  assert.equal(initial.revision, 0);
  assert.equal(firstReset.revision, 1);
  assert.equal(secondReset.revision, 2);
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('损坏或结构不完整的存档会备份并恢复为新局', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-post-corrupt-'));
  const dataFile = path.join(temporaryDirectory, 'state.json');
  fs.writeFileSync(dataFile, JSON.stringify({ version: 1, day: 1 }), 'utf8');

  const store = new GameStore(dataFile, { seed: 'recovered-seed' });
  const recovered = store.load();
  const backups = fs.readdirSync(temporaryDirectory).filter((name) => name.includes('.corrupt-'));

  assert.equal(recovered.phase, 'planning');
  assert.equal(recovered.day, 1);
  assert.equal(recovered.seed, 'recovered-seed');
  assert.ok(recovered.recovery);
  assert.equal(backups.length, 1);
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('终局报告与结局字段不完整时会按损坏存档恢复', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-post-terminal-state-'));
  const dataFile = path.join(temporaryDirectory, 'state.json');
  const store = new GameStore(dataFile, { seed: 'terminal-valid' });
  const state = store.load();
  state.phase = 'completed';
  state.lastReport = {};
  state.ending = { type: 'completed' };
  fs.writeFileSync(dataFile, JSON.stringify(state), 'utf8');

  const reloadedStore = new GameStore(dataFile, { seed: 'terminal-recovered' });
  const recovered = reloadedStore.load();

  assert.equal(recovered.phase, 'planning');
  assert.equal(recovered.day, 1);
  assert.equal(recovered.seed, 'terminal-recovered');
  assert.ok(recovered.recovery);
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('旧存档中的越界状态会在加载时迁移并写回', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-post-migration-'));
  const dataFile = path.join(temporaryDirectory, 'state.json');
  const store = new GameStore(dataFile, { seed: 'migration-seed' });
  const state = store.load();
  state.reputation = 250;
  state.credits = -20;
  state.relations['gale:sun'] = 150;
  fs.writeFileSync(dataFile, JSON.stringify(state), 'utf8');

  const migrated = new GameStore(dataFile, { seed: 'ignored' }).load();
  const persisted = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

  assert.equal(migrated.reputation, 100);
  assert.equal(migrated.credits, 0);
  assert.equal(migrated.relations['gale:sun'], 100);
  assert.deepEqual(persisted, migrated);
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('旧存档的 lastPenaltyDay 会迁移为幂等台账并补录历史链', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-post-ledger-migration-'));
  const dataFile = path.join(temporaryDirectory, 'state.json');
  const store = new GameStore(dataFile, { seed: 'legacy-ledger' });
  const state = store.load();

  // 构造一份"旧版"存档：无台账、无历史链，积压信件带 lastPenaltyDay。
  const legacyLetter = state.letters[0];
  legacyLetter.status = 'backlog';
  legacyLetter.backlogSince = 1;
  legacyLetter.lastPenaltyDay = 1;
  delete legacyLetter.timeline;
  const freshLetter = state.letters[1];
  freshLetter.lastPenaltyDay = 1;
  delete freshLetter.timeline;
  delete state.penaltyLedger;
  state.lastReport = null;
  fs.writeFileSync(dataFile, JSON.stringify(state), 'utf8');

  const migrated = new GameStore(dataFile, { seed: 'ignored' }).load();
  assert.equal(Array.isArray(migrated.penaltyLedger), true);
  assert.equal(migrated.penaltyLedger.length, 2);
  assert.ok(migrated.penaltyLedger.every((entry) => entry.day === 1));
  assert.deepEqual(
    [...migrated.penaltyLedger.map((entry) => entry.key)].sort(),
    [`1:${legacyLetter.id}`, `1:${freshLetter.id}`].sort()
  );
  for (const letter of migrated.letters.slice(0, 2)) {
    assert.equal(letter.lastPenaltyDay, undefined);
    assert.ok(Array.isArray(letter.timeline));
    assert.ok(letter.timeline.some((event) => event.type === 'received'));
  }
  const migratedBacklog = migrated.letters.find((letter) => letter.id === legacyLetter.id);
  assert.ok(migratedBacklog.timeline.some((event) => event.type === 'backlogged'));

  // 再次加载不应重复迁移入账（幂等）。
  const reloaded = new GameStore(dataFile, { seed: 'ignored' }).load();
  assert.equal(reloaded.penaltyLedger.length, 2);
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});
