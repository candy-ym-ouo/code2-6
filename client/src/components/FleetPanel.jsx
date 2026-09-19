import { formatHour } from '../utils.js';

const OUTCOME = {
  'on-time': { label: '准时', className: 'success' },
  late: { label: '逾时', className: 'warning' },
  wrong: { label: '误投', className: 'danger' },
  'wrong-late': { label: '误投·逾时', className: 'danger' }
};

const FACTOR_LABELS = {
  cruise: '航渡距离',
  load: '满载减速',
  wind: '逆风',
  gale: '风翎岛乱流',
  mist: '雾礁岛低云',
  sunFog: '曦光岛晨雾',
  backlog: '跨日积压'
};


function RouteLetter({ entry, index, total, game, routeResult, busy, onChangeTarget, onMove, onUnassign }) {
  const recipientIslands = game.islands.filter((island) => island.id !== 'skyport');
  const projection = routeResult?.letters.find((letter) => letter.letterId === entry.letterId);
  const outcome = projection ? OUTCOME[projection.outcome] : null;

  return (
    <div className="route-letter">
      <div className="route-sequence">{index + 1}</div>
      <div className="route-letter-main">
        <div className="route-letter-title">
          <strong>{entry.letter.subject}</strong>
          <code>{entry.letter.id}</code>
        </div>
        <div className="route-letter-controls">
          <label>
            <span>投递至</span>
            <select
              value={entry.targetIslandId}
              onChange={(event) => onChangeTarget(entry.letterId, event.target.value)}
              aria-label={`${entry.letter.id} 的投递目标`}
              disabled={busy}
            >
              {recipientIslands.map((island) => (
                <option key={island.id} value={island.id}>
                  {island.name}{island.id === entry.letter.recipientIslandId ? '（原址）' : ''}
                </option>
              ))}
            </select>
          </label>
          <span>{entry.letter.weight.toFixed(1)} kg · 紧急度 {entry.letter.urgency}</span>
          {projection && <span className={`outcome ${outcome?.className || ''}`}>{outcome?.label} {formatHour(projection.arrivalHour)}</span>}
          {projection?.late && projection.lateReason && (
            <span className="late-cause">
              {entry.letter.urgency === 3 && <em className="urgent-inline">加急</em>}
              主因：{FACTOR_LABELS[projection.lateReason.primary] || projection.lateReason.primary}
              （超 {Math.max(0, projection.lateReason.overdueHours).toFixed(1)}h）
              {projection.backlogDays > 0 && ` · 已积压 ${projection.backlogDays} 日`}
            </span>
          )}
        </div>
      </div>
      <div className="route-letter-buttons">
        <button type="button" disabled={busy || index === 0} onClick={() => onMove(entry.letterId, -1)} aria-label="路线中前移">↑</button>
        <button type="button" disabled={busy || index === total - 1} onClick={() => onMove(entry.letterId, 1)} aria-label="路线中后移">↓</button>
        <button type="button" className="remove-button" disabled={busy} onClick={() => onUnassign(entry.letterId)} aria-label="移出路线">×</button>
      </div>
    </div>
  );
}

export default function FleetPanel({ game, assignments, preview, busy, onMove, onUnassign, onChangeTarget }) {
  const letterMap = new Map(game.letters.map((letter) => [letter.id, letter]));

  return (
    <section className="panel fleet-panel" aria-labelledby="fleet-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">三艘信使艇</p>
          <h2 id="fleet-title">装载与航线</h2>
        </div>
        {preview?.valid ? <span className="plan-valid">方案合法</span> : <span className="plan-invalid">需要调整</span>}
      </div>

      {preview?.issues?.length > 0 && (
        <div className="validation-issues" role="alert">
          {preview.issues.map((issue, index) => <p key={`${issue.code}-${index}`}>{issue.message}</p>)}
        </div>
      )}

      <div className="fleet-list">
        {game.couriers.map((courier) => {
          const entries = assignments
            .filter((assignment) => assignment.courierId === courier.id)
            .sort((first, second) => first.order - second.order)
            .map((assignment) => ({ ...assignment, letter: letterMap.get(assignment.letterId) }))
            .filter((assignment) => assignment.letter);
          const totalWeight = entries.reduce((sum, entry) => sum + entry.letter.weight, 0);
          const loadPercent = Math.min(100, totalWeight / courier.capacity * 100);
          const routeResult = preview?.routes?.find((route) => route.courierId === courier.id);

          return (
            <article className="courier-card" key={courier.id}>
              <div className="courier-header">
                <div className="courier-identity">
                  <span className="courier-mark" style={{ background: courier.color }}>{courier.callSign.slice(0, 1)}</span>
                  <div>
                    <h3>{courier.name}</h3>
                    <p>{courier.callSign} · {courier.description}</p>
                  </div>
                </div>
                <div className="courier-timing">
                  <span>{entries.length}/{courier.maxLetters} 封</span>
                  <strong>{routeResult ? `${formatHour(routeResult.startHour)} → ${formatHour(routeResult.endHour)}` : '待命'}</strong>
                </div>
              </div>

              <div className="capacity-row">
                <span>载重 {totalWeight.toFixed(1)} / {courier.capacity} kg</span>
                <div className={`capacity-track ${loadPercent >= 100 ? 'full' : ''}`}>
                  <i style={{ width: `${loadPercent}%`, background: courier.color }} />
                </div>
                <b>{Math.round(loadPercent)}%</b>
              </div>

              <div className="route-letters">
                {entries.length === 0 ? (
                  <p className="empty-lane">尚未分配邮件</p>
                ) : entries.map((entry, index) => (
                  <RouteLetter
                    key={entry.letterId}
                    entry={entry}
                    index={index}
                    total={entries.length}
                    game={game}
                    routeResult={routeResult}
                    busy={busy}
                    onChangeTarget={onChangeTarget}
                    onMove={onMove}
                    onUnassign={onUnassign}
                  />
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
