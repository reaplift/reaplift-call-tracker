import { useEffect, useState } from 'react';
import { api, ApiError, type CallQuery } from '../api';
import { formatSeconds, istDateString } from '../format';
import { toQuery } from './CallHistory';

const today = istDateString(new Date());

export function Reports() {
  const [fromDay, setFromDay] = useState(today);
  const [toDay, setToDay] = useState(today);
  const [summary, setSummary] = useState<{
    totalCalls: number;
    incomingCalls: number;
    outgoingCalls: number;
    missedCalls: number;
    rejectedCalls: number;
    connectedCalls: number;
    talkSeconds: number;
    uniqueNumbers: number;
    employeeCount: number;
  } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const q: CallQuery = toQuery({
      fromDay,
      toDay,
      employeeId: '',
      type: '',
      minTalk: '',
      maxTalk: '',
      minRing: '',
      maxRing: '',
      number: '',
    });
    api
      .reportSummary(q)
      .then((r) => setSummary(r))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Server unreachable'));
  }, [fromDay, toDay]);

  return (
    <section>
      <h1>Reports</h1>
      <div className="card filters">
        <label>
          From
          <input type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} />
        </label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!summary ? (
        <p className="muted">Loading report…</p>
      ) : (
        <div className="card">
          <h2>Summary</h2>
          <ul>
            <li>Total calls: {summary.totalCalls}</li>
            <li>Incoming: {summary.incomingCalls}</li>
            <li>Outgoing: {summary.outgoingCalls}</li>
            <li>Missed: {summary.missedCalls}</li>
            <li>Rejected: {summary.rejectedCalls}</li>
            <li>Connected: {summary.connectedCalls}</li>
            <li>Talk time: {formatSeconds(summary.talkSeconds)}</li>
            <li>Unique numbers: {summary.uniqueNumbers}</li>
            <li>Employees: {summary.employeeCount}</li>
          </ul>
        </div>
      )}
    </section>
  );
}
