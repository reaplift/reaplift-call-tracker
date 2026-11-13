import { useEffect, useState } from 'react';
import type { DashboardPeriod } from '@reaplift/calls-shared';
import { api, ApiError } from '../api';
import { formatDayRange, formatDuration } from '../format';

/** What a click on a tile opens: call history for the card's days, with a call type where the tile has one. */
export interface CallsPreset {
  fromDay: string;
  toDay: string;
  type: string;
}

type Tone = '' | 'in' | 'out' | 'bad';
interface Tile {
  label: string;
  value: (p: DashboardPeriod) => string;
  tone: Tone;
  type: string;
}

const count = (k: keyof DashboardPeriod) => (p: DashboardPeriod) => String(p[k]);
const time = (k: keyof DashboardPeriod) => (p: DashboardPeriod) => formatDuration(p[k] as number);

/** Callyzer's 13 tiles, in its order: counts on the left, durations on the right (client, 12 November 2026). */
export const TILES: Tile[] = [
  { label: 'Total calls', value: count('totalCalls'), tone: '', type: '' },
  { label: 'Call duration', value: time('callSeconds'), tone: '', type: '' },
  { label: 'Incoming', value: count('incomingCalls'), tone: 'in', type: 'incoming' },
  { label: 'Incoming duration', value: time('incomingSeconds'), tone: 'in', type: 'incoming' },
  { label: 'Outgoing', value: count('outgoingCalls'), tone: 'out', type: 'outgoing' },
  { label: 'Outgoing duration', value: time('outgoingSeconds'), tone: 'out', type: 'outgoing' },
  { label: 'Missed', value: count('missedCalls'), tone: 'bad', type: 'missed' },
  { label: 'Rejected', value: count('rejectedCalls'), tone: 'bad', type: 'rejected' },
  { label: 'Never attended', value: count('neverAttended'), tone: 'bad', type: '' },
  { label: 'Not picked up by client', value: count('notPickedUp'), tone: 'bad', type: 'outgoing' },
  { label: 'Unique clients', value: count('uniqueClients'), tone: '', type: '' },
  { label: 'Working hours', value: time('workingSeconds'), tone: '', type: '' },
  { label: 'Connected calls', value: count('connectedCalls'), tone: '', type: '' },
];

/** The first page after login (M2 task 2.7): today, yesterday, the last 7 days and this month. */
export function Dashboard({ onOpenCalls }: { onOpenCalls: (preset: CallsPreset) => void }) {
  const [periods, setPeriods] = useState<DashboardPeriod[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.dashboard().then(
      (r) => setPeriods(r.periods),
      (err) => setError(err instanceof ApiError ? err.message : 'Server unreachable'),
    );
  }, []);

  return (
    <section>
      <h1>Dashboard</h1>
      <p className="muted">Company-SIM calls, India time. Excluded numbers are left out. Click a number to see the calls.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {!periods && !error && <p className="muted">Loading…</p>}
      {periods && (
        <div className="dash">
          {periods.map((p) => (
            <div className="card period" key={p.key}>
              <h2>
                {p.label} <small>{formatDayRange(p.firstDay, p.lastDay)}</small>
              </h2>
              <div className="tiles">
                {TILES.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    className={`tile ${t.tone}`}
                    onClick={() => onOpenCalls({ fromDay: p.firstDay, toDay: p.lastDay, type: t.type })}
                    aria-label={`${p.label}: ${t.label} ${t.value(p)}. Open the calls`}
                  >
                    <b>{t.value(p)}</b>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
