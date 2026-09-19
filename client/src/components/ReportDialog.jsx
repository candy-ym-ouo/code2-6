import { formatHour } from '../utils.js';

const OUTCOME = {
  'on-time': '准时',
  late: '逾时',
  wrong: '误投',
  'wrong-late': '误投且逾时'
};

const FACTOR_LABELS = {
  cruise: '基准航渡',
  load: '满载减速',
  wind: '逆风损失',
  gale: '风翎岛乱流',
  mist: '雾礁岛低云',
  sunFog: '曦光岛晨雾',
  backlog: '跨日积压'
};

function LateReasonTrace({ letter }) {
  if (!letter.lateReason) return null;
  const reason = letter.lateReason;
  const traceable = reason.factors.filter((factor) => factor.type !== 'cruise');

  return (
    <div className={`late-trace ${letter.urgency === 3 ? 'urgent-trace' : ''}`}>
      <p className="late-trace-summary">
        超期 {Math.max(0, reason.overdueHours).toFixed(2)} 小时
        {letter.urgency === 3 && <em className="urgent-inline">加急追索</em>}
        {traceable.length > 0 && <>，主因：<b>{FACTOR_LABELS[reason.primary] || reason.primary}</b></>}
      </p>
      {traceable.length > 0 && (
        <ul className="late-trace-factors">
          {traceable.map((factor) => (
            <li key={`${letter.letterId}-${factor.type}`}>
              <span>{FACTOR_LABELS[factor.type] || factor.label}</span>
              <i>{factor.hours.toFixed(2)} h</i>
              {factor.detail && <small>{factor.detail}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ReportDialog({ report, onClose }) {
  if (!report) return null;
  const delivered = report.routes.reduce((sum, route) => sum + route.letters.length, 0);
  const nextDay = report.generatedNextDay;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <div className="report-header">
          <div>
            <p className="eyebrow">第 {report.day} 日航后电报</p>
            <h2 id="report-title">调度结算完成</h2>
          </div>
          <span className={`report-reputation ${report.reputationDelta >= 0 ? 'positive' : 'negative'}`}>
            信誉 {report.reputationDelta >= 0 ? '+' : ''}{report.reputationDelta}
          </span>
        </div>

        <div className="report-stats">
          <div><b>{delivered}</b><span>已投递</span></div>
          <div><b>{report.routes.flatMap((route) => route.letters).filter((letter) => letter.outcome === 'on-time').length}</b><span>准时</span></div>
          <div><b>{report.routes.flatMap((route) => route.letters).filter((letter) => letter.late).length}</b><span>逾时</span></div>
          <div><b>{report.routes.flatMap((route) => route.letters).filter((letter) => letter.wrong).length}</b><span>误投</span></div>
        </div>

        <div className="report-scroll">
          <div className="report-section">
            <h3>航线回报</h3>
            {report.routes.length === 0 && <p className="report-empty">今日没有出港航班，所有邮件都积压了。</p>}
            {report.routes.map((route) => (
              <div className="report-route" key={route.courierId}>
                <div className="report-route-title">
                  <strong>{route.courierName}</strong>
                  <span>{route.letterCount} 封 · {route.totalDistance} km</span>
                </div>
                {route.letters.map((letter) => (
                  <div className="report-delivery" key={letter.letterId}>
                    <code>{letter.letterId}</code>
                    <span>{letter.targetName}</span>
                    <span>{formatHour(letter.arrivalHour)}</span>
                    <b className={`outcome ${letter.wrong ? 'danger' : letter.late ? 'warning' : 'success'}`}>{OUTCOME[letter.outcome]}</b>
                    {letter.late && <LateReasonTrace letter={letter} />}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {report.relationChanges.length > 0 && (
            <div className="report-section">
              <h3>关系变化</h3>
              {report.relationChanges.map((change) => (
                <div className="relation-change" key={change.key}>
                  <span>{change.firstIslandName} ↔ {change.secondIslandName}</span>
                  <b className={change.delta > 0 ? 'positive' : change.delta < 0 ? 'negative' : ''}>{change.delta > 0 ? '+' : ''}{change.delta}</b>
                  <small>
                    {change.reasons.join('；')}
                    {change.requestedDelta !== undefined && change.requestedDelta !== change.delta ? '（已受关系上下限限制）' : ''}
                  </small>
                </div>
              ))}
            </div>
          )}

          {report.unassignedLetterIds.length > 0 && (
            <div className="report-section report-warning">
              <h3>积压邮件</h3>
              <p>{report.unassignedLetterIds.join('、')} 未出港，已计入积压。</p>
              {report.backlogPenalties.length > 0 && (
                <ul className="ledger-entries">
                  {report.backlogPenalties.map((entry) => (
                    <li key={entry.key}>
                      <code>{entry.letterId}</code>
                      <span>{entry.reason}</span>
                      <i>信誉 {entry.reputationDelta} · 邮资 {entry.creditsDelta}</i>
                    </li>
                  ))}
                </ul>
              )}
              <small className="ledger-note">积压罚则按「结算日 × 信件」幂等入账，重开页面不会重复扣分。</small>
            </div>
          )}
        </div>

        <div className="report-footer">
          <div>
            <span>信誉 <b>{report.reputationAfter}</b></span>
            <span>邮资 <b>{report.creditsAfter}</b></span>
          </div>
          <button type="button" onClick={onClose}>
            {nextDay ? `进入第 ${nextDay} 日` : '查看本局结果'}
          </button>
        </div>
      </section>
    </div>
  );
}
