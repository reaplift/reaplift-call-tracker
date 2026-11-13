import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('App', () => {
  it('shows the login page when not logged in, and the wrong-password message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/auth/me'
          ? json(401, { error: 'UNAUTHENTICATED', message: 'Please log in' })
          : json(401, { error: 'INVALID_CREDENTIALS', message: 'Wrong email or password' }),
      ),
    );
    render(<App />);
    await userEvent.type(await screen.findByLabelText('Email'), 'admin@reaplift.local');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Wrong email or password');
  });

  it('opens the dashboard after login, and a tile opens the calls behind it', async () => {
    const period = (key: string, label: string, firstDay: string, lastDay: string, totalCalls: number) => ({
      key, label, firstDay, lastDay, from: '', to: '', totalCalls, callSeconds: 5247, incomingCalls: 12, incomingSeconds: 2748,
      outgoingCalls: 26, outgoingSeconds: 2499, missedCalls: 3, rejectedCalls: 8, neverAttended: 3, notPickedUp: 2,
      uniqueClients: 21, workingSeconds: 7752, connectedCalls: 30,
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return json(200, { user: { id: 'u', name: 'Nikhila', email: 'a@b.c', role: 'admin' } });
      if (url === '/api/reports/dashboard')
        return json(200, {
          periods: [
            period('today', 'Today', '2026-11-12', '2026-11-12', 12),
            period('yesterday', 'Yesterday', '2026-11-11', '2026-11-11', 49),
            period('last7', 'Last 7 days', '2026-11-05', '2026-11-11', 178),
            period('month', 'This month', '2026-11-01', '2026-11-12', 301),
          ],
        });
      if (url === '/api/employees') return json(200, { items: [] });
      return json(200, { items: [], nextCursor: null });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByText('05 to 11 Nov 2026')).toBeTruthy();
    expect(screen.getByText('01 to 12 Nov 2026')).toBeTruthy();
    expect(screen.getAllByText('1h 27m 27s')).toHaveLength(4);
    await userEvent.click(screen.getByRole('button', { name: /^Yesterday: Missed 3/ }));
    expect(await screen.findByRole('heading', { name: 'Call history' })).toBeTruthy();
    const callsUrl = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith('/api/calls?'))!;
    const q = new URLSearchParams(callsUrl.split('?')[1]);
    expect([q.get('from'), q.get('to'), q.get('types')]).toEqual(['2026-11-10T18:30:00.000Z', '2026-11-11T18:30:00.000Z', 'missed']);
  });

  it('opens call history for a logged-in admin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/auth/me') return json(200, { user: { id: 'u', name: 'Nikhila', email: 'a@b.c', role: 'admin' } });
        if (url === '/api/reports/dashboard') return json(200, { periods: [] });
        if (url === '/api/employees') return json(200, { items: [] });
        return json(200, {
          items: [
            {
              id: 1,
              employeeId: 'e',
              employeeName: 'Ravi Kumar',
              number: '919900011111',
              numberKind: 'mobile',
              contactName: 'Sharma Traders',
              type: 'outgoing',
              startedAt: '2026-11-12T08:32:00Z',
              talkSeconds: 185,
              ringSeconds: 12,
              syncedAt: '2026-11-12T08:33:00Z',
            },
          ],
          nextCursor: null,
        });
      }),
    );
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Call history' }));
    expect(await screen.findByText('Sharma Traders')).toBeTruthy();
    expect(screen.getByText('+91 99000 11111')).toBeTruthy();
    expect(screen.getByText('3m 05s')).toBeTruthy();
    expect(screen.getByText('14:02', { exact: false })).toBeTruthy();
  });
});
