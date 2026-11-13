import { useEffect, useState } from 'react';
import type { Company } from '@reaplift/calls-shared';
import { api, type User } from './api';
import { CallHistory } from './pages/CallHistory';
import { Dashboard, type CallsPreset } from './pages/Dashboard';
import { Employees } from './pages/Employees';
import { Login } from './pages/Login';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import logo from './assets/reaplift-logo.png';

type PageId = 'dashboard' | 'calls' | 'reports' | 'employees' | 'settings';

/** The sidebar, with the Material icons the CRM uses (M11). Settings is for admins. */
const PAGES: Array<{ id: PageId; label: string; icon: string; adminOnly?: boolean }> = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'calls', label: 'Call history', icon: 'call' },
  { id: 'reports', label: 'Reports', icon: 'bar_chart' },
  { id: 'employees', label: 'Employees', icon: 'badge' },
  { id: 'settings', label: 'Settings', icon: 'settings', adminOnly: true },
];

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
      <aside className="sidebar">
        <img className="logo" src={logo} alt="ReapLift" />
        <div className="product">Callit</div>
        {user.role === 'super_admin' && <CompanyPicker user={user} onPicked={setUser} />}
        <nav aria-label="Pages">
          {PAGES.filter((p) => !(p.adminOnly && user.role === 'manager')).map((p) => (
            <button
              key={p.id}
              type="button"
              className={page === p.id ? 'active' : ''}
              aria-current={page === p.id ? 'page' : undefined}
              onClick={() => (p.id === 'calls' ? openCalls(undefined) : setPage(p.id))}
            >
              <span className="mi" aria-hidden="true">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <span className="who">{user.name}</span>
        <nav aria-label="Account">
          <button type="button" onClick={() => api.logout().finally(() => setUser(null))}>
            <span className="mi" aria-hidden="true">logout</span>
            Log out
          </button>
        </nav>
      </aside>
      <main key={user.companyId ?? 'none'}>
        {user.role === 'super_admin' && user.companyId === null ? (
          <section>
            <h1>Pick a company</h1>
            <p className="muted">As super admin you work in one company at a time. Pick it in the sidebar.</p>
          </section>
        ) : (
          <>
        {page === 'dashboard' && <Dashboard onOpenCalls={openCalls} />}
        {page === 'calls' && <CallHistory key={callsPreset ? JSON.stringify(callsPreset) : 'all'} preset={callsPreset} />}
        {page === 'reports' && <Reports />}
        {page === 'employees' && <Employees />}
        {page === 'settings' && <Settings />}
          </>
        )}
      </main>
    </div>
  );
}

/** The super admin works in one company at a time (P1): the server keeps the choice with the login session. */
function CompanyPicker({ user, onPicked }: { user: User; onPicked: (user: User) => void }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  useEffect(() => {
    api.companies().then((r) => setCompanies(r.items), () => {});
  }, []);
  return (
    <label className="company-picker">
      Company
      <select
        value={user.companyId ?? ''}
        onChange={(e) => e.target.value && api.selectCompany(Number(e.target.value)).then((r) => onPicked(r.user), () => {})}
      >
        <option value="" disabled>
          Pick a company
        </option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
