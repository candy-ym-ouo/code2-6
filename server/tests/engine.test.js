import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceDay,
  createInitialState,
  getOpenLetters,
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
      if (!state.penaltyLedger.some((entry) => entry.day === state.day && entry.letterId === letter.id)) {
        state.penaltyLedger.push({
          key: `${state.day}:${letter.id}`,
          day: state.day,
          letterId: letter.id,
          urgency: letter.urgency,
          backlogSince: letter.backlogSince ?? state.day,
          reputationDelta: 0,
          creditsDelta: 0,
          reason: '测试预设免罚',
          recordedAt: null
        });
      }
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

test('积压罚则按 结算日×信件 幂等入账，重放结算不会重复扣分', () => {
  const state = createInitialState({ seed: 'ledger-idempotent' });
  const dayOneLetters = [...state.letters];
  const report = advanceDay(state, []);

  assert.equal(report.backlogPenalties.length, dayOneLetters.length);
  assert.equal(state.penaltyLedger.length, dayOneLetters.length);
  for (const letter of dayOneLetters) {
    const entries = state.penaltyLedger.filter((entry) => entry.letterId === letter.id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].day, 1);
    assert.equal(entries[0].key, `1:${letter.id}`);
  }

  // 模拟崩溃后重放：同一结算日的条目已在台账中时，投影与落账都不再产生罚分。
  const replayState = createInitialState({ seed: 'ledger-idempotent' });
  for (const item of replayState.letters) {
    replayState.penaltyLedger.push({
      key: `1:${item.id}`,
      day: 1,
      letterId: item.id,
      urgency: item.urgency,
      backlogSince: 1,
      reputationDelta: -1,
      creditsDelta: -1,
      reason: '崩溃重放预设',
      recordedAt: null
    });
  }
  const replayPreview = previewPlan(replayState, []);
  assert.equal(replayPreview.projection.backlogPenalties.length, 0);
  assert.equal(replayPreview.projection.reputationDelta, 0);
  assert.equal(replayPreview.projection.creditsDelta, 0);

  const reputationBefore = replayState.reputation;
  const creditsBefore = replayState.credits;
  const replayReport = advanceDay(replayState, []);
  assert.equal(replayReport.backlogPenalties.length, 0);
  assert.equal(replayState.reputation, reputationBefore);
  assert.equal(replayState.credits, creditsBefore);
  assert.equal(replayState.penaltyLedger.length, dayOneLetters.length);
});

test('积压信件跨日继续受罚但每个结算日只入账一次', () => {
  const state = createInitialState({ seed: 'ledger-multi-day' });
  const dayOneIds = new Set(state.letters.map((letter) => letter.id));
  advanceDay(state, []); // 第 1 日全部积压
  const firstDayCount = state.penaltyLedger.length;
  const reputationAfterDayOne = state.reputation;

  const report = advanceDay(state, []); // 第 2 日仍全部积压
  assert.equal(state.day, 3);
  // 第 2 日罚则 = 第 1 日积压件 + 第 2 日新邮件；第 1 日信件各有 2 条（每日一条）。
  assert.ok(report.backlogPenalties.length > firstDayCount);
  for (const letterId of dayOneIds) {
    const entries = state.penaltyLedger.filter((entry) => entry.letterId === letterId);
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((entry) => entry.day), [1, 2]);
  }
  assert.ok(state.reputation < reputationAfterDayOne);

  const keys = state.penaltyLedger.map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('加急件超期后次日仍可补排，并保留可追索原因与完整历史链', () => {
  const state = createInitialState({ seed: 'urgent-trace' });
  const letter = state.letters[0];
  letter.urgency = 3;
  letter.sealColor = 'seal-red';

  // 第 1 日未安排，加急件超期积压。
  advanceDay(state, []);
  const backlogged = state.letters.find((item) => item.id === letter.id);
  assert.equal(backlogged.status, 'backlog');
  assert.equal(backlogged.backlogSince, 1);
  assert.ok(backlogged.timeline.some((event) => event.type === 'backlogged' && event.day === 1));

  // 次日仍可安排这封加急件。
  const assignment = {
    letterId: letter.id,
    courierId: 'comet',
    targetIslandId: letter.recipientIslandId,
    order: 0
  };
  const preview = previewPlan(state, [assignment]);
  assert.equal(preview.valid, true);
  const projected = preview.routes[0].letters[0];
  assert.equal(projected.backlogDays, 1);
  assert.equal(projected.late, true);
  assert.ok(projected.lateReason);
  assert.equal(projected.lateReason.primary, 'backlog');
  assert.ok(projected.lateReason.overdueHours > 0);
  assert.ok(projected.lateReason.factors.some((factor) => factor.type === 'backlog' && factor.hours === 24));

  advanceDay(state, [assignment]);
  const delivered = state.letters.find((item) => item.id === letter.id);
  assert.equal(delivered.status, 'delivered');
  assert.equal(delivered.deliveredDay, 2);
  assert.equal(delivered.outcome, 'late');

  const types = delivered.timeline.map((event) => event.type);
  assert.deepEqual(types, ['received', 'backlogged', 'penalty', 'recovered', 'delivered']);
  const deliveredEvent = delivered.timeline.at(-1);
  assert.ok(deliveredEvent.lateReason);
  assert.equal(deliveredEvent.lateReason.primary, 'backlog');
  assert.ok(deliveredEvent.lateReason.factors.length >= 2);

  // 已投递的信件不再出现在待投递队列，也不会再产生积压罚则。
  assert.equal(getOpenLetters(state).some((item) => item.id === letter.id), false);
  assert.equal(state.penaltyLedger.filter((entry) => entry.letterId === letter.id).length, 1);
});

test('同日加急超期的追索原因可归因到航段因素', () => {
  const state = createInitialState({ seed: 'same-day-factor' });
  const letter = state.letters[0];
  letter.urgency = 3;
  letter.sealColor = 'seal-red';
  letter.deadlineHour = 7;

  const assignment = {
    letterId: letter.id,
    courierId: 'zephyr',
    targetIslandId: letter.recipientIslandId,
    order: 0
  };
  const preview = previewPlan(state, [assignment]);
  const projected = preview.routes[0].letters[0];
  assert.equal(projected.late, true);
  assert.equal(projected.backlogDays, 0);
  assert.ok(projected.lateReason.overdueHours > 0);
  assert.notEqual(projected.lateReason.primary, 'backlog');
  assert.ok(projected.lateReason.factors.every((factor) => Number.isFinite(factor.hours)));
  assert.ok(projected.lateReason.factors.some((factor) => factor.type !== 'cruise'));
});
