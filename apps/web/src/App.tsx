import { useEffect, useState } from 'react';
import { api, type User } from './api';
import { CallHistory } from './pages/CallHistory';
import { Dashboard, type CallsPreset } from './pages/Dashboard';
import { Employees } from './pages/Employees';
import { Login } from './pages/Login';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';

type PageId = 'dashboard' | 'calls' | 'reports' | 'employees' | 'settings';

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  // The dashboard is the first page after login (client, 12 November 2026).
  const [page, setPage] = useState<PageId>('dashboard');
  /** Set when a dashboard tile opened call history; a fresh object remounts the page with those filters. */
  const [callsPreset, setCallsPreset] = useState<CallsPreset | undefined>(undefined);
  const openCalls = (preset?: CallsPreset) => {
    setCallsPreset(preset);
    setPage('calls');
  };

  useEffect(() => {
    api.me().then((r) => setUser(r.user), () => setUser(null));
  }, []);

  if (user === undefined) return <p className="loading">Loading…</p>;
  if (user === null) return <Login onLogin={setUser} />;

  return (
    <div className="shell">
      <nav>
        <strong>ReapLift Calls</strong>
        <button className={page === 'dashboard' ? 'active' : ''} onClick={() => setPage('dashboard')}>
          Dashboard
        </button>
        <button className={page === 'calls' ? 'active' : ''} onClick={() => openCalls(undefined)}>
          Call history
        </button>
        <button className={page === 'reports' ? 'active' : ''} onClick={() => setPage('reports')}>
          Reports
        </button>
        <button className={page === 'employees' ? 'active' : ''} onClick={() => setPage('employees')}>
          Employees
        </button>
        {user.role !== 'manager' && (
          <button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}>
            Settings
          </button>
        )}
        <span className="spacer" />
        <span className="muted">{user.name}</span>
        <button className="secondary" onClick={() => api.logout().finally(() => setUser(null))}>
          Log out
        </button>
      </nav>
      <main>
        {page === 'dashboard' && <Dashboard onOpenCalls={openCalls} />}
        {page === 'calls' && <CallHistory key={callsPreset ? JSON.stringify(callsPreset) : 'all'} preset={callsPreset} />}
        {page === 'reports' && <Reports />}
        {page === 'employees' && <Employees />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  );
}
