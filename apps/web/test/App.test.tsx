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

  it('opens call history for a logged-in admin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/auth/me') return json(200, { user: { id: 'u', name: 'Nikhila', email: 'a@b.c', role: 'admin' } });
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
    expect(await screen.findByText('Sharma Traders')).toBeTruthy();
    expect(screen.getByText('+91 99000 11111')).toBeTruthy();
    expect(screen.getByText('3m 05s')).toBeTruthy();
    expect(screen.getByText('14:02', { exact: false })).toBeTruthy();
  });
});
