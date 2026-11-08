import { useEffect, useState, type FormEvent } from 'react';
import type { Employee, PairingCodeResponse } from '@reaplift/calls-shared';
import { api, ApiError } from '../api';
import { formatDateTime, formatNumber } from '../format';

function PairDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const [code, setCode] = useState<PairingCodeResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.pairingCode(employee.id).then(setCode, (err) => setError(err instanceof ApiError ? err.message : 'Server unreachable'));
  }, [employee.id]);

  return (
    <div className="overlay" role="dialog" aria-label={`Pair ${employee.name}'s phone`}>
      <div className="card dialog">
        <h2>Pair {employee.name}'s phone</h2>
        {error && <p className="error">{error}</p>}
        {code && (
          <>
            <p>Ask {employee.name.split(' ')[0]} to scan this with the phone camera and follow the steps.</p>
            <div className="qr" dangerouslySetInnerHTML={{ __html: code.qrSvg }} />
            <p className="code" aria-label="Pairing code">
              {code.code.slice(0, 3)} {code.code.slice(3)}
            </p>
            <p className="muted">
              Works once, until {formatDateTime(code.expiresAt)}. Link: <a href={code.installUrl}>{code.installUrl}</a>
            </p>
          </>
        )}
        <button onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export function Employees() {
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [pairing, setPairing] = useState<Employee | null>(null);

  const load = () =>
    api.employees().then(
      (r) => setEmployees(r.items),
      (err) => setError(err instanceof ApiError ? err.message : 'Server unreachable'),
    );
  useEffect(() => {
    load();
  }, []);

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Server unreachable');
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    act(async () => {
      await api.addEmployee({ name, companyNumber: number });
      setName('');
      setNumber('');
    });
  };

  return (
    <section>
      <h1>Employees</h1>
      <form onSubmit={add} className="card row">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Company SIM number
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="98123 45678" required />
        </label>
        <button type="submit">Add employee</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {!employees ? (
        <p>Loading…</p>
      ) : employees.length === 0 ? (
        <p className="muted">No employees yet. Add the first one above.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Company SIM</th>
              <th>Phone</th>
              <th>Last sync</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className={e.status === 'left' ? 'left' : ''}>
                <td>
                  {e.name}
                  {e.status === 'left' && <span className="tag">Left</span>}
                </td>
                <td>{formatNumber(e.companyNumber)}</td>
                <td>
                  {e.device
                    ? `${e.device.brand ?? ''} ${e.device.model ?? ''} · Android ${e.device.androidVersion ?? '?'} · SIM ${(e.device.simSlot ?? 0) + 1}`
                    : <span className="muted">Not paired</span>}
                </td>
                <td>{e.device?.lastSyncAt ? formatDateTime(e.device.lastSyncAt) : '—'}</td>
                <td className="actions">
                  {e.status === 'active' && (
                    <>
                      <button onClick={() => setPairing(e)}>{e.device ? 'Pair new phone' : 'Pair phone'}</button>
                      {e.device && (
                        <button
                          className="secondary"
                          onClick={() => window.confirm(`Unpair ${e.name}'s phone? It stops syncing.`) && act(() => api.revokeDevice(e.id))}
                        >
                          Unpair
                        </button>
                      )}
                      <button
                        className="secondary"
                        onClick={() =>
                          window.confirm(`Mark ${e.name} as left? Their phone stops syncing; their calls are kept.`) &&
                          act(() => api.updateEmployee(e.id, { status: 'left' }))
                        }
                      >
                        Left
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pairing && (
        <PairDialog
          employee={pairing}
          onClose={() => {
            setPairing(null);
            load();
          }}
        />
      )}
    </section>
  );
}
