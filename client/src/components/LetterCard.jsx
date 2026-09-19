const URGENCY = {
  3: { label: '加急', className: 'urgent' },
  2: { label: '优先', className: 'priority' },
  1: { label: '常规', className: 'routine' }
};

export default function LetterCard({ letter, islands, compact = false, children }) {
  const islandMap = new Map(islands.map((island) => [island.id, island]));
  const origin = islandMap.get(letter.originIslandId);
  const recipient = islandMap.get(letter.recipientIslandId);
  const urgency = URGENCY[letter.urgency];

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
      {letter.overdueReason && (
        <p className="overdue-reason" role="note">⚠ 已超期：{letter.overdueReason}</p>
      )}
      {letter.history?.length > 0 && (
        <ul className="letter-history" aria-label="邮件流转记录">
          {letter.history.map((event, index) => (
            <li key={`${event.day}-${event.type}-${index}`}>
              <span>第{event.day}日</span>
              {event.reason}
            </li>
          ))}
        </ul>
      )}
      {children && <div className="letter-actions">{children}</div>}
    </article>
  );
}
