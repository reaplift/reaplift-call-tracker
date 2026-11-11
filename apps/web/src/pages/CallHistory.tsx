import { useEffect, useState } from 'react';
import { CALL_TYPES, type CallRow, type Employee } from '@reaplift/calls-shared';
import { api, ApiError, callQueryString, type CallQuery } from '../api';
import { formatDateTime, formatNumber, formatSeconds, istDateString, istDayStart } from '../format';

const TYPE_LABEL: Record<string, string> = { incoming: 'Incoming', outgoing: 'Outgoing', missed: 'Missed', rejected: 'Rejected' };

interface Filters {
  fromDay: string;
  toDay: string;
  employeeId: string;
  type: string;
  minTalk: string;
  maxTalk: string;
  minRing: string;
  maxRing: string;
  number: string;
  /** After-call form (M4): '' all, 'no' waiting for a comment, 'yes' with one. */
  commented?: string;
}

/** The filters as the server's call filter: the "to" day is included, so the range ends at the next midnight. */
export function toQuery(f: Filters): CallQuery {
  const nextDay = new Date(new Date(`${f.toDay}T00:00:00+05:30`).getTime() + 86_400_000).toISOString();
  return {
    from: istDayStart(f.fromDay),
    to: nextDay,
    employeeIds: f.employeeId,
    types: f.type,
    minTalk: f.minTalk,
    maxTalk: f.maxTalk,
    minRing: f.minRing,
    maxRing: f.maxRing,
    numbers: f.number,
    commented: f.commented,
  };
}

export function CallHistory() {
  const today = istDateString(new Date());
  const [filters, setFilters] = useState<Filters>({
    fromDay: today,
    toDay: today,
    employeeId: '',
    type: '',
    minTalk: '',
    maxTalk: '',
    minRing: '',
    maxRing: '',
    number: '',
    commented: '',
  });
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<CallRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.employees().then((r) => setEmployees(r.items), () => {});
  }, []);

  const load = async (cursor?: string) => {
    setLoading(true);
    setError('');
    try {
      const page = await api.calls({ ...toQuery(filters), cursor });
      setRows((prev) => (cursor ? [...prev, ...page.items] : page.items));
      setNext(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Server unreachable');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    // Reload whenever a filter changes.
  }, [filters]);

  const set = (key: keyof Filters) => (e: { target: { value: string } }) => setFilters({ ...filters, [key]: e.target.value });

  return (
    <section>
      <h1>Call history</h1>
      <div className="card filters">
        <label>
          From
          <input type="date" value={filters.fromDay} onChange={set('fromDay')} />
        </label>
        <label>
          To
          <input type="date" value={filters.toDay} onChange={set('toDay')} />
        </label>
        <label>
          Employee
          <select value={filters.employeeId} onChange={set('employeeId')}>
            <option value="">Everyone</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select value={filters.type} onChange={set('type')}>
            <option value="">All</option>
            {CALL_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Talk at least (s)
          <input inputMode="numeric" value={filters.minTalk} onChange={set('minTalk')} />
        </label>
        <label>
          Talk at most (s)
          <input inputMode="numeric" value={filters.maxTalk} onChange={set('maxTalk')} />
        </label>
        <label>
          Ring at least (s)
          <input inputMode="numeric" value={filters.minRing} onChange={set('minRing')} />
        </label>
        <label>
          Ring at most (s)
          <input inputMode="numeric" value={filters.maxRing} onChange={set('maxRing')} />
        </label>
        <label>
          Number
          <input value={filters.number} onChange={set('number')} placeholder="99000 11111" />
        </label>
        <label>
          Comment
          <select value={filters.commented ?? ''} onChange={set('commented')}>
            <option value="">All calls</option>
            <option value="no">Waiting for a comment</option>
            <option value="yes">Has a comment</option>
          </select>
        </label>
        <a className="button secondary" href={`/api/calls/export.csv?${callQueryString(toQuery(filters))}`}>
          Download CSV
        </a>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Date and time</th>
            <th>Employee</th>
            <th>Number</th>
            <th>Type</th>
            <th>Talk</th>
            <th>Ring</th>
            <th>Outcome and comment</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>{formatDateTime(c.startedAt)}</td>
              <td>{c.employeeName}</td>
              <td>
                {formatNumber(c.number)}
                {c.contactName && <div className="muted">{c.contactName}</div>}
              </td>
              <td>
                <span className={`type ${c.type}`}>{TYPE_LABEL[c.type]}</span>
              </td>
              <td>{formatSeconds(c.talkSeconds)}</td>
              <td>{formatSeconds(c.ringSeconds)}</td>
              <td>
                {c.outcome && <strong>{c.outcome}</strong>}
                {c.note && <div>{c.note}</div>}
                {c.followUpAt && <div className="muted">Follow up {formatDateTime(c.followUpAt)}</div>}
                {!c.commentedAt && (c.type === 'incoming' || c.type === 'outgoing') && <span className="muted">No comment yet</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && rows.length === 0 && !error && <p className="muted">No calls match these filters.</p>}
      {next && (
        <button onClick={() => load(next)} disabled={loading}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
