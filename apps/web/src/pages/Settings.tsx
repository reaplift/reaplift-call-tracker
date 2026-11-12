import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type ApiKey } from '../api';

interface Item {
  id: string;
  label: string;
  active: boolean;
}

/**
 * Company settings for the after-call form: call outcomes (M4) and ready-made notes (the pop-up). Phones pick up
 * changes on their next sync. An item in use is switched off rather than deleted, so old calls keep their outcome.
 */
export function Settings() {
  return (
    <section>
      <h1>Settings</h1>
      <p className="muted">These appear in the app's after-call pop-up. Phones get changes on their next sync (within 15 minutes).</p>
      <List
        title="Call outcomes"
        hint="The result an employee picks after a call, for example Interested or Call back later."
        load={async () => (await api.outcomes()).items.map((o) => ({ id: o.id, label: o.label, active: o.active }))}
        add={(label) => api.addOutcome(label)}
        rename={(id, label) => api.updateOutcome(id, { label })}
        toggle={(id, active) => api.updateOutcome(id, { active })}
      />
      <List
        title="Ready-made notes"
        hint='Notes an employee inserts by typing "/" or tapping one, for example "Site visit planned".'
        load={async () => (await api.noteTemplates()).items.map((t) => ({ id: t.id, label: t.text, active: t.active }))}
        add={(text) => api.addNoteTemplate(text)}
        rename={(id, text) => api.updateNoteTemplate(id, { text })}
        toggle={(id, active) => api.updateNoteTemplate(id, { active })}
      />
      <ApiKeys />
    </section>
  );
}

function List(props: {
  title: string;
  hint: string;
  load: () => Promise<Item[]>;
  add: (label: string) => Promise<unknown>;
  rename: (id: string, label: string) => Promise<unknown>;
  toggle: (id: string, active: boolean) => Promise<unknown>;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState('');

  const reload = () => props.load().then(setItems, (err) => setError(err instanceof ApiError ? err.message : 'Server unreachable'));
  useEffect(() => {
    reload();
  }, []);

  const run = async (work: () => Promise<unknown>) => {
    setError('');
    try {
      await work();
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Server unreachable');
    }
  };

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    run(async () => {
      await props.add(draft.trim());
      setDraft('');
    });
  };

  return (
    <div className="card">
      <h2>{props.title}</h2>
      <p className="muted">{props.hint}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <table>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className={item.active ? '' : 'left'}>
              <td>
                {editing?.id === item.id ? (
                  <input
                    aria-label={`New text for ${item.label}`}
                    value={editing.label}
                    onChange={(e) => setEditing({ id: item.id, label: e.target.value })}
                  />
                ) : (
                  <>
                    {item.label}
                    {!item.active && <span className="tag">Off</span>}
                  </>
                )}
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {editing?.id === item.id ? (
                  <>
                    <button onClick={() => run(async () => { await props.rename(item.id, editing.label.trim()); setEditing(null); })}>Save</button>{' '}
                    <button className="secondary" onClick={() => setEditing(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button className="secondary" onClick={() => setEditing({ id: item.id, label: item.label })}>Rename</button>{' '}
                    <button className="secondary" onClick={() => run(() => props.toggle(item.id, !item.active))}>
                      {item.active ? 'Switch off' : 'Switch on'}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={onAdd} className="filters" style={{ marginTop: 12 }}>
        <label>
          Add
          <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} placeholder="New item" />
        </label>
        <button type="submit" disabled={!draft.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Never');

/** Keys for the company's own CRM to read its calls through the Callyzer-compatible API (M5). */
function ApiKeys() {
  const [items, setItems] = useState<ApiKey[]>([]);
  const [name, setName] = useState('');
  const [shown, setShown] = useState<{ name: string; key: string } | null>(null);
  const [error, setError] = useState('');

  const reload = () => api.apiKeys().then((r) => setItems(r.items), (err) => setError(err instanceof ApiError ? err.message : 'Server unreachable'));
  useEffect(() => {
    reload();
  }, []);

  const run = async (work: () => Promise<unknown>) => {
    setError('');
    try {
      await work();
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Server unreachable');
    }
  };

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    run(async () => {
      const created = await api.createApiKey(name.trim());
      setShown({ name: created.name, key: created.key });
      setName('');
    });
  };

  return (
    <div className="card">
      <h2>API keys for your CRM</h2>
      <p className="muted">
        Your CRM reads your company's calls and reports from <code>{window.location.origin}/api/v2.3/</code>, with the same requests and
        answers as Callyzer's API v2.3. Send the key as <code>Authorization: Bearer &lt;key&gt;</code>, only from your CRM's server, never
        from a browser.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {shown && (
        <div className="notice" role="status">
          <p>
            <strong>Copy the key for "{shown.name}" now.</strong> It is not shown again; if it is lost, revoke it and make a new one.
          </p>
          <p>
            <code style={{ wordBreak: 'break-all' }}>{shown.key}</code>{' '}
            <button className="secondary" onClick={() => navigator.clipboard?.writeText(shown.key)}>Copy</button>{' '}
            <button className="secondary" onClick={() => setShown(null)}>Done</button>
          </p>
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Key starts with</th>
            <th>Created</th>
            <th>Last used</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((k) => (
            <tr key={k.id} className={k.revokedAt ? 'left' : ''}>
              <td>
                {k.name}
                {k.revokedAt && <span className="tag">Revoked</span>}
              </td>
              <td><code>{k.keyPrefix}…</code></td>
              <td>{when(k.createdAt)}</td>
              <td>{when(k.lastUsedAt)}</td>
              <td style={{ textAlign: 'right' }}>
                {!k.revokedAt && (
                  <button
                    className="secondary"
                    onClick={() => window.confirm(`Revoke "${k.name}"? Anything using it stops working at once.`) && run(() => api.revokeApiKey(k.id))}
                  >
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={onCreate} className="filters" style={{ marginTop: 12 }}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Our CRM" />
        </label>
        <button type="submit" disabled={!name.trim()}>
          Create key
        </button>
      </form>
    </div>
  );
}
