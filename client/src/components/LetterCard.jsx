const URGENCY = {
  3: { label: '加急', className: 'urgent' },
  2: { label: '优先', className: 'priority' },
  1: { label: '常规', className: 'routine' }
};

const TIMELINE_LABELS = {
  received: '收件',
  backlogged: '积压',
  penalty: '罚则入账',
  recovered: '重新安排',
  delivered: '签收'
};

export default function LetterCard({ letter, islands, compact = false, children, todayDay = letter.day }) {
  const islandMap = new Map(islands.map((island) => [island.id, island]));
  const origin = islandMap.get(letter.originIslandId);
  const recipient = islandMap.get(letter.recipientIslandId);
  const urgency = URGENCY[letter.urgency];
  const overdue = letter.status === 'backlog' && todayDay > letter.deadlineDay;
  const timeline = Array.isArray(letter.timeline) ? letter.timeline : [];

  return (
    <article className={`letter-card ${urgency.className} ${compact ? 'compact' : ''}`}>
      <div className="letter-topline">
        <span className={`urgency-tag ${urgency.className}`}>{urgency.label}</span>
        <code>{letter.id}</code>
      </div>
      <h3>{letter.subject}</h3>
      <p className="letter-sender">{letter.sender}</p>
      <div className="letter-route">
        <span>{origin?.name}</span>
        <i>→</i>
        <strong>{recipient?.name}</strong>
      </div>
      <div className="letter-meta">
        <span><b>{letter.weight.toFixed(1)}</b> kg</span>
        <span>截止 <b>第{letter.deadlineDay}日 {String(letter.deadlineHour).padStart(2, '0')}:00</b></span>
      </div>
      {letter.status === 'backlog' && (
        <div className={`backlog-notice ${overdue ? 'is-overdue' : ''}`}>
          {overdue && letter.urgency === 3
            ? <>加急件已超期，可在次日继续补排；罚则已幂等入账。</>
            : <>已积压 {Math.max(0, todayDay - letter.day)} 日</>}
        </div>
      )}
      {timeline.length > 0 && (
        <details className="letter-timeline">
          <summary>历史链（{timeline.length}）</summary>
          <ol>
            {timeline.map((event, index) => (
              <li key={`${event.type}-${event.day}-${index}`}>
                <b>{TIMELINE_LABELS[event.type] || event.type}</b>
                <span>第{event.day}日{event.atHour !== null && event.atHour !== undefined ? ` ${String(Math.floor(event.atHour)).padStart(2, '0')}:${String(Math.round((event.atHour % 1) * 60)).padStart(2, '0')}` : ''}</span>
                <small>{event.detail}</small>
              </li>
            ))}
          </ol>
        </details>
      )}
      {children && <div className="letter-actions">{children}</div>}
    </article>
  );
}
