import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';

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
