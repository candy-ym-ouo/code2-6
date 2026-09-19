import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceDay,
  backlogPenaltyKey,
  createInitialState,
  previewPlan,
  relationKey
} from '../engine.js';

function assignmentFor(state, letter, courierId = 'zephyr', targetIslandId = letter.recipientIslandId) {
  return {
    letterId: letter.id,
    courierId,
    targetIslandId,
    order: 0
  };
}

test('同一随机种子生成相同邮件与风况', () => {
  const first = createInitialState({ seed: 'fixed-seed' });
  const second = createInitialState({ seed: 'fixed-seed' });
  const third = createInitialState({ seed: 'another-seed' });

  assert.deepEqual(first.letters, second.letters);
  assert.deepEqual(first.wind, second.wind);
  assert.notDeepEqual(first.letters, third.letters);
});

test('预览会按信使载重与邮件数量执行校验', () => {
  const state = createInitialState({ seed: 'capacity-check' });
  const zephyr = state.couriers.find((courier) => courier.id === 'zephyr');
  const letters = [...state.letters];
  while (letters.length <= zephyr.maxLetters) {
    const template = letters[letters.length % state.letters.length];
    letters.push({ ...template, id: `TEST-${letters.length}` });
  }
  const assignments = letters.map((letter, index) => ({
    ...assignmentFor(state, letter, 'zephyr'),
    order: index
  }));
  const preview = previewPlan(state, assignments);
  assert.equal(preview.valid, false);
  assert.ok(letters.length > zephyr.maxLetters);
  assert.ok(preview.issues.some((issue) => issue.code === 'LETTER_LIMIT_EXCEEDED'));
});

test('误投会降低发件岛与目的岛之间的关系', () => {
  const state = createInitialState({ seed: 'wrong-delivery' });
  const letter = state.letters[0];
  const wrongTarget = state.islands.find((island) => (
    island.id !== 'skyport' &&
    island.id !== letter.recipientIslandId &&
    island.id !== letter.originIslandId
  ));
  const assignment = assignmentFor(state, letter, 'comet', wrongTarget.id);
  const key = relationKey(letter.originIslandId, letter.recipientIslandId);
  const relationBefore = state.relations[key];
  const preview = previewPlan(state, [assignment]);

  assert.equal(preview.valid, true);
  assert.equal(preview.routes[0].letters[0].wrong, true);

  const report = advanceDay(state, [assignment]);
  assert.ok(state.relations[key] < relationBefore);
  assert.ok(report.relationChanges.some((change) => change.key === key && change.delta < 0));
});

test('重复安排同一封邮件会在结算前被拒绝', () => {
  const state = createInitialState({ seed: 'duplicate-letter' });
  const letter = state.letters[0];
  const assignments = [
    assignmentFor(state, letter, 'comet', letter.recipientIslandId),
    { ...assignmentFor(state, letter, 'zephyr', letter.recipientIslandId), order: 1 }
  ];
  const preview = previewPlan(state, assignments);

  assert.equal(preview.valid, false);
  assert.ok(preview.issues.some((issue) => issue.code === 'LETTER_DUPLICATE'));
  assert.throws(() => advanceDay(state, assignments), /调度方案不合法/);
  assert.equal(state.day, 1);
});

test('空方案也能完成一日结算并生成下一日邮件', () => {
  const state = createInitialState({ seed: 'empty-plan' });
  const previousReputation = state.reputation;
  const report = advanceDay(state, []);

  assert.equal(report.day, 1);
  assert.ok(state.reputation < previousReputation);
  assert.equal(state.day, 2);
  assert.equal(state.phase, 'planning');
  assert.ok(state.letters.some((letter) => letter.day === 2 && letter.status === 'inbox'));
  assert.ok(state.letters.some((letter) => letter.day === 1 && letter.status === 'backlog'));
});

test('十四日结算会进入明确终局而不是无限循环', () => {
  const state = createInitialState({ seed: 'campaign-end' });
  state.reputation = 1000;

  while (state.phase === 'planning') {
    state.reputation = 100;
    for (const letter of state.letters.filter((item) => ['inbox', 'backlog'].includes(item.status))) {
      state.penaltyLedger.push({
        key: backlogPenaltyKey(letter.id, state.day),
        type: 'backlog',
        letterId: letter.id,
        day: state.day,
        reputationDelta: 0,
        creditsDelta: 0,
        reason: '测试预登记，跳过当日积压扣减'
      });
    }
    advanceDay(state, []);
  }

  assert.equal(state.phase, 'completed');
  assert.equal(state.day, 14);
  assert.equal(state.ending.type, 'completed');
  assert.ok(['S', 'A', 'B', 'C'].includes(state.ending.rank));
});

test('每日邮件不会自寄且发件到收件路线不重复', () => {
  for (let seed = 0; seed < 1000; seed += 1) {
    const letters = createInitialState({ seed: `route-${seed}` }).letters;
    const routes = new Set();

    for (const letter of letters) {
      assert.notEqual(letter.originIslandId, letter.recipientIslandId);
      const route = `${letter.originIslandId}:${letter.recipientIslandId}`;
      assert.equal(routes.has(route), false);
      routes.add(route);
    }
  }
});

test('非法航线顺序不会被静默替换', () => {
  const state = createInitialState({ seed: 'invalid-order' });
  const letter = state.letters[0];
  assert.throws(
    () => previewPlan(state, [{ ...assignmentFor(state, letter), order: 'not-a-number' }]),
    /航线顺序无效/
  );
});

test('关系触及边界时结算报告记录实际变化量', () => {
  const state = createInitialState({ seed: 'relation-boundary' });
  const letter = state.letters[0];
  const key = relationKey(letter.originIslandId, letter.recipientIslandId);
  const wrongTarget = state.islands.find((island) => (
    island.id !== 'skyport' &&
    island.id !== letter.recipientIslandId &&
    island.id !== letter.originIslandId
  ));
  state.relations[key] = -99;

  const report = advanceDay(state, [assignmentFor(state, letter, 'comet', wrongTarget.id)]);
  const change = report.relationChanges.find((item) => item.key === key);

  assert.equal(state.relations[key], -100);
  assert.equal(change.delta, -1);
  assert.ok(change.requestedDelta < change.delta);
});

test('每次结算都会递增用于防重复提交的版本号', () => {
  const state = createInitialState({ seed: 'revision' });
  assert.equal(state.revision, 0);
  advanceDay(state, []);
  assert.equal(state.revision, 1);
  advanceDay(state, []);
  assert.equal(state.revision, 2);
});

test('信誉在 0 到 100 之间封顶，并正确报告实际变化', () => {
  const state = createInitialState({ seed: 'reputation-cap' });
  state.reputation = 99;
  const letter = state.letters[0];
  state.letters = [letter];
  const assignment = assignmentFor(state, letter, 'comet');
  const preview = previewPlan(state, [assignment]);
  const report = advanceDay(state, [assignment]);

  assert.equal(preview.projection.reputationDelta, 1);
  assert.equal(state.reputation, 100);
  assert.equal(report.reputationDelta, 1);
});

test('逾时投递会扣减信誉但保留基础关系修复', () => {
  const state = createInitialState({ seed: 'late-delivery' });
  const letter = state.letters[0];
  letter.deadlineHour = 7;
  state.letters = [letter];
  const key = relationKey(letter.originIslandId, letter.recipientIslandId);
  const relationBefore = state.relations[key];
  const reputationBefore = state.reputation;
  const report = advanceDay(state, [assignmentFor(state, letter, 'comet')]);

  assert.equal(report.routes[0].letters[0].late, true);
  assert.equal(state.reputation, reputationBefore - 1);
  assert.equal(state.relations[key], relationBefore + 1);
});

test('信誉降到零会进入失败终局并停止生成下一日邮件', () => {
  const state = createInitialState({ seed: 'failed-ending' });
  state.reputation = 0.5;
  advanceDay(state, []);

  assert.equal(state.reputation, 0);
  assert.equal(state.phase, 'failed');
  assert.equal(state.ending.type, 'failed');
  assert.equal(state.ending.rank, 'D');
});

test('积压惩罚按信件与日幂等入账，重放同一日不重复扣减', () => {
  const state = createInitialState({ seed: 'backlog-ledger' });
  const reputationBefore = state.reputation;
  const creditsBefore = state.credits;
  const openCount = state.letters.filter((item) => item.status === 'inbox').length;

  const report = advanceDay(state, []);

  assert.equal(report.penalties.length, openCount);
  assert.equal(state.penaltyLedger.length, openCount);
  assert.ok(state.reputation < reputationBefore);
  assert.ok(state.credits < creditsBefore);
  for (const entry of state.penaltyLedger) {
    assert.equal(entry.key, backlogPenaltyKey(entry.letterId, 1));
    assert.equal(entry.type, 'backlog');
    assert.equal(entry.day, 1);
    assert.ok(entry.reputationDelta < 0);
    assert.ok(entry.creditsDelta < 0);
  }

  // 模拟"重开页面后重放同一日"：日数与信件集合回到已结算日，预览与结算都不应重复扣减。
  state.day = 1;
  state.letters = state.letters.filter((letter) => letter.day === 1);
  const historyLengths = state.letters.map((letter) => letter.history.length);
  const replayPreview = previewPlan(state, []);
  assert.equal(replayPreview.projection.backlog, 0);
  assert.equal(replayPreview.projection.reputationDelta, 0);
  assert.equal(replayPreview.projection.creditsDelta, 0);

  const ledgerSize = state.penaltyLedger.length;
  const reputationAfterSettle = state.reputation;
  const replayReport = advanceDay(state, []);
  assert.equal(replayReport.penalties.length, 0);
  assert.equal(replayReport.reputationDelta, 0);
  assert.equal(replayReport.creditsDelta, 0);
  assert.equal(state.reputation, reputationAfterSettle);
  assert.equal(state.penaltyLedger.length, ledgerSize);
  assert.deepEqual(
    state.letters.slice(0, historyLengths.length).map((letter) => letter.history.length),
    historyLengths
  );
});

test('加急件超期可追索原因，次日仍可安排且保留历史链', () => {
  const state = createInitialState({ seed: 'urgent-overdue' });
  const urgent = state.letters[0];
  urgent.urgency = 3;
  urgent.deadlineDay = 1;
  urgent.deadlineHour = 12;
  state.letters = [urgent];

  advanceDay(state, []);

  assert.equal(urgent.status, 'backlog');
  assert.match(urgent.overdueReason, /未安排航线/);
  assert.match(urgent.overdueReason, /12:00/);
  assert.equal(urgent.history.length, 1);
  assert.equal(urgent.history[0].type, 'backlog');
  assert.equal(urgent.history[0].day, 1);
  assert.match(urgent.history[0].reason, /未安排航线/);

  // 次日这封已超期的加急件仍然可以安排航线。
  const assignment = assignmentFor(state, urgent, 'comet');
  const preview = previewPlan(state, [assignment]);
  assert.equal(preview.valid, true);

  const report = advanceDay(state, [assignment]);
  assert.equal(urgent.status, 'delivered');
  assert.equal(report.routes[0].letters[0].late, true);
  assert.equal(urgent.overdueReason, null);
  assert.deepEqual(urgent.history.map((event) => event.type), ['backlog', 'delivered']);
  assert.deepEqual(urgent.history.map((event) => event.day), [1, 2]);
  assert.equal(urgent.history[1].outcome, 'late');
  assert.equal(urgent.history[1].courierId, 'comet');
  assert.match(urgent.history[1].reason, /逾时/);
});
