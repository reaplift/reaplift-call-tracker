import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AUTO_BLANKS, BLANK_NAME, blankLabel, fillTemplate, invalidBlanks, templateBlanks, type MessageTemplate } from '@reaplift/calls-shared';
import { api, ApiError } from '../api';

/** What the preview fills the blanks with. Custom blanks show their own label, so the admin sees where they go. */
const SAMPLE: Record<string, string> = {
  name: 'Asha',
  employee_name: 'Meena Iyer',
  company_name: 'Country Roads',
  follow_up_date: '13 Nov',
};

/** Shows a template with its blanks highlighted. */
function Highlighted({ body }: { body: string }) {
  const parts = body.split(/(\{\{\s*[^{}]*?\s*\}\})/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('{{') ? <span key={i} className="blank">{p}</span> : <span key={i}>{p}</span>))}
    </>
  );
}

/**
 * M10: WhatsApp message templates (company admins; the super admin for the company picked). After a call the
 * employee picks one in the app, fills the blanks the app can't, checks it, and WhatsApp opens with the text.
 */
export function MessageTemplates() {
  const [items, setItems] = useState<MessageTemplate[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; title: string; body: string } | null>(null);
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const reload = () => api.messageTemplates().then((r) => setItems(r.items), (err) => setError(err instanceof ApiError ? err.message : 'Server unreachable'));
  useEffect(() => {
    reload();
  }, []);

  const run = async (work: () => Promise<unknown>) => {
    setError('');
    try {
      await work();
      await reload();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Server unreachable');
      return false;
    }
  };

  /** Puts a blank where the cursor is in the message. */
  const insert = (name: string) => {
    if (!editing) return;
    const el = bodyRef.current;
    const token = `{{${name}}}`;
    const start = el?.selectionStart ?? editing.body.length;
    const end = el?.selectionEnd ?? editing.body.length;
    const body = editing.body.slice(0, start) + token + editing.body.slice(end);
    setEditing({ ...editing, body });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const customName = custom.trim().toLowerCase().replace(/\s+/g, '_');
  const bad = editing ? invalidBlanks(editing.body) : [];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing || bad.length) return;
    const body = { title: editing.title.trim(), body: editing.body.trim() };
    const ok = await run(() => (editing.id ? api.updateMessageTemplate(editing.id, body) : api.addMessageTemplate(body)));
    if (ok) setEditing(null);
  };

  return (
    <div className="card">
      <h2>WhatsApp message templates</h2>
      <p className="muted">
        Fixed messages your employees send from their own WhatsApp after a call. The app fills the client's name, the
        employee's name, your company name and the follow-up date when it knows them, and asks the employee for any
        other blank. Employees can't change the wording. Phones get changes within 30 minutes.
      </p>
      {error && <p className="error" role="alert">{error}</p>}

      {items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Template</th>
              <th>Message</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id} className={t.active ? '' : 'left'}>
                <td>
                  <strong>{t.title}</strong>
                  {!t.active && <span className="tag">Off</span>}
                </td>
                <td style={{ maxWidth: 520 }}>
                  <Highlighted body={t.body} />
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="secondary" onClick={() => setEditing({ id: t.id, title: t.title, body: t.body })}>Edit</button>{' '}
                  <button className="secondary" onClick={() => run(() => api.updateMessageTemplate(t.id, { active: !t.active }))}>
                    {t.active ? 'Switch off' : 'Switch on'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {items.length === 0 && !editing && <p className="muted">No templates yet. Add the first one, for example "Follow-up".</p>}

      {!editing && (
        <button onClick={() => setEditing({ id: null, title: '', body: '' })}>Add template</button>
      )}

      {editing && (
        <form onSubmit={save} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          <h3 style={{ margin: 0 }}>{editing.id ? `Edit "${editing.title}"` : 'New template'}</h3>
          <label>
            Title (employees pick by this)
            <input id="tpl-title" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} maxLength={100} placeholder="Follow-up" />
          </label>
          <label>
            Message
            <textarea
              id="tpl-body"
              ref={bodyRef}
              value={editing.body}
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              maxLength={1000}
              placeholder="Hi {{name}}, this is {{employee_name}} from {{company_name}}. Thanks for your time today."
            />
          </label>
          <div className="muted">{editing.body.length} / 1000</div>
          <div>
            <div className="muted" style={{ marginBottom: 6 }}>Insert a blank the app fills</div>
            <div className="chips">
              {AUTO_BLANKS.map((b) => (
                <button key={b} type="button" className="secondary" onClick={() => insert(b)}>
                  + {blankLabel(b)}
                </button>
              ))}
            </div>
          </div>
          <div className="filters">
            <label>
              Or a blank the employee fills, for example "site name" or "price"
              <input id="tpl-custom" value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={30} placeholder="site name" />
            </label>
            <button
              type="button"
              className="secondary"
              disabled={!BLANK_NAME.test(customName)}
              onClick={() => {
                insert(customName);
                setCustom('');
              }}
            >
              Insert {customName ? `{{${customName}}}` : 'blank'}
            </button>
          </div>
          {bad.length > 0 && (
            <p className="error" role="alert">
              Blank names use lowercase letters, digits and underscores. Fix: {bad.map((b) => `{{${b}}}`).join(', ')}
            </p>
          )}
          {editing.body.trim() && (
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>
                Preview with sample values
                {templateBlanks(editing.body).some((b) => !(b in SAMPLE)) && ' (the employee fills the highlighted blanks)'}
              </div>
              <div className="preview">
                <Highlighted body={fillTemplate(editing.body, SAMPLE)} />
              </div>
            </div>
          )}
          <div className="row">
            <button type="submit" disabled={!editing.title.trim() || !editing.body.trim() || bad.length > 0}>
              Save
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
