import { useEffect, useState } from 'react';
import { api, type User } from './api';
import { CallHistory } from './pages/CallHistory';
import { Employees } from './pages/Employees';
import { Login } from './pages/Login';
import { Reports } from './pages/Reports';

type PageId = 'calls' | 'reports' | 'employees';

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [page, setPage] = useState<PageId>('calls');

  useEffect(() => {
    api.me().then((r) => setUser(r.user), () => setUser(null));
  }, []);

  if (user === undefined) return <p className="loading">Loading…</p>;
  if (user === null) return <Login onLogin={setUser} />;

  return (
    <div className="shell">
      <nav>
        <strong>ReapLift Calls</strong>
        <button className={page === 'calls' ? 'active' : ''} onClick={() => setPage('calls')}>
          Call history
        </button>
        <button className={page === 'reports' ? 'active' : ''} onClick={() => setPage('reports')}>
          Reports
        </button>
        <button className={page === 'employees' ? 'active' : ''} onClick={() => setPage('employees')}>
          Employees
        </button>
        <span className="spacer" />
        <span className="muted">{user.name}</span>
        <button className="secondary" onClick={() => api.logout().finally(() => setUser(null))}>
          Log out
        </button>
      </nav>
      <main>
        {page === 'calls' && <CallHistory />}
        {page === 'reports' && <Reports />}
        {page === 'employees' && <Employees />}
      </main>
    </div>
  );
}
