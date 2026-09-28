import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { DOCS, clean, docSpec, validate, type DocId, type DocSpec } from './schema';
import { api, ApiError, token } from './api';
import { Fields, ImagesCtx, RootList } from './Fields';
import './admin.css';

type Doc = { saved: unknown; draft: unknown; version: string };
type Status = { kind: 'ok' | 'error' | 'busy'; text: string; errors?: string[] } | null;

/** Canonical form used to decide whether a document has unsaved edits. */
const canon = (spec: DocSpec, v: unknown) => (spec.root ? JSON.stringify(clean(spec.root, v)) : String(v ?? ''));

const fromHash = (): DocId => (docSpec(location.hash.slice(1))?.id ?? 'site');

export default function AdminPage() {
  const [authed, setAuthed] = useState(() => !!token.get());
  const [notice, setNotice] = useState('');

  // Admin-only page chrome: fixed-size type, visible scrollbars, no indexing.
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('data-admin', '');
    html.removeAttribute('data-preload');
    const title = document.title;
    document.title = 'Admin';
    const robots = Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex, nofollow' });
    document.head.append(robots);
    return () => { html.removeAttribute('data-admin'); document.title = title; robots.remove(); };
  }, []);

  const logout = useCallback((message = '') => {
    token.clear();
    setNotice(message);
    setAuthed(false);
  }, []);

  return (
    <main className="admin" data-lenis-prevent="">
      {authed ? <Editor onLogout={logout} /> : <Login notice={notice} onDone={() => { setNotice(''); setAuthed(true); }} />}
    </main>
  );
}

function Login({ notice, onDone }: { notice: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      token.set((await api.login(password)).token);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="adm-login" onSubmit={submit}>
      <p className="adm-eyebrow">Portfolio</p>
      <h1>Admin</h1>
      <label htmlFor="adm-password" className="adm-label">Password</label>
      <input id="adm-password" className="adm-input" type="password" autoComplete="current-password" autoFocus
        value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={error ? 'adm-login-error' : undefined} />
      {error ? <p id="adm-login-error" className="adm-error" role="alert">{error}</p> : null}
      <button className="adm-btn adm-btn--primary" type="submit" disabled={busy || !password}>{busy ? 'Checking…' : 'Log in'}</button>
    </form>
  );
}

function Editor({ onLogout }: { onLogout: (message?: string) => void }) {
  const [docs, setDocs] = useState<Record<string, Doc> | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [loadError, setLoadError] = useState('');
  const [active, setActive] = useState<DocId>(fromHash);
  const [status, setStatus] = useState<Status>(null);

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) onLogout(err.message);
    return err as Error;
  }, [onLogout]);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await api.content();
      const next: Record<string, Doc> = {};
      for (const d of DOCS) {
        const p = res.docs[d.id];
        const v = d.root ? p.data : p.text;
        next[d.id] = { saved: v, draft: structuredClone(v), version: p.version };
      }
      setDocs(next);
      setImages(res.images);
    } catch (err) {
      setLoadError(fail(err).message);
    }
  }, [fail]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onHash = () => setActive(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const dirty = useMemo(() => {
    const out = new Set<string>();
    if (docs) for (const d of DOCS) if (canon(d, docs[d.id].draft) !== canon(d, docs[d.id].saved)) out.add(d.id);
    return out;
  }, [docs]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty.size) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const spec = docSpec(active)!;
  const doc = docs?.[active];

  const setDraft = (v: unknown) => {
    setDocs((all) => (all ? { ...all, [active]: { ...all[active], draft: v } } : all));
    if (status?.kind === 'ok') setStatus(null);
  };

  const save = useCallback(async () => {
    if (!docs || !dirty.has(active)) return;
    const d = docs[active];
    const payload = spec.root ? { data: clean(spec.root, d.draft) } : { text: String(d.draft) };
    if (spec.root) {
      const errors = validate(spec.root, payload.data);
      if (errors.length) { setStatus({ kind: 'error', text: 'Some fields need fixing before this can be saved.', errors }); return; }
    }
    setStatus({ kind: 'busy', text: 'Saving…' });
    try {
      const res = await api.save(active, { ...payload, version: d.version });
      const v = spec.root ? res.data : res.text;
      setDocs((all) => (all ? { ...all, [active]: { saved: v, draft: structuredClone(v), version: res.version } } : all));
      setStatus({ kind: 'ok', text: spec.root ? `Saved to ${spec.file}. The site has picked it up.` : `Saved to ${spec.file}.` });
    } catch (err) {
      const e = fail(err);
      setStatus({ kind: 'error', text: e.message, errors: e instanceof ApiError ? e.errors : undefined });
    }
  }, [docs, dirty, active, spec, fail]);

  // Cmd/Ctrl+S saves the open section.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const discard = () => {
    if (!docs || !confirm(`Discard unsaved changes to ${spec.title}?`)) return;
    setDocs({ ...docs, [active]: { ...docs[active], draft: structuredClone(docs[active].saved) } });
    setStatus(null);
  };

  const open = (id: DocId) => {
    history.replaceState(null, '', `#${id}`);
    setActive(id);
    setStatus(null);
    document.querySelector('.adm-main')?.scrollTo({ top: 0 });
  };

  return (
    <ImagesCtx.Provider value={images}>
      <div className="adm-shell">
        <aside className="adm-side">
          <p className="adm-eyebrow">Portfolio admin</p>
          <nav aria-label="Sections">
            <ul>
              {DOCS.map((d) => (
                <li key={d.id}>
                  <button type="button" className="adm-side__item" aria-current={d.id === active ? 'page' : undefined} onClick={() => open(d.id)}>
                    {d.title}
                    {dirty.has(d.id) ? <span className="adm-dot" title="Unsaved changes"><span className="sr-only">(unsaved changes)</span></span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="adm-side__foot">
            <a className="adm-link" href="/" target="_blank" rel="noreferrer">View site ↗</a>
            <button type="button" className="adm-link" onClick={() => (!dirty.size || confirm('You have unsaved changes. Log out anyway?')) && onLogout()}>Log out</button>
          </div>
        </aside>

        <section className="adm-main" aria-labelledby="adm-title">
          <header className="adm-head">
            <div>
              <h1 id="adm-title">{spec.title}</h1>
              <p className="adm-blurb">{spec.blurb}</p>
              <p className="adm-file"><code>{spec.file}</code></p>
            </div>
            <div className="adm-actions">
              <button type="button" className="adm-btn" onClick={discard} disabled={!dirty.has(active)}>Discard</button>
              <button type="button" className="adm-btn adm-btn--primary" onClick={save} disabled={!dirty.has(active) || status?.kind === 'busy'} title="Cmd/Ctrl + S">
                {status?.kind === 'busy' ? 'Saving…' : 'Save'}
              </button>
            </div>
            {status ? (
              <div className="adm-status" data-kind={status.kind} role={status.kind === 'error' ? 'alert' : 'status'}>
                <p>{status.text}</p>
                {status.errors?.length ? <ul>{status.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
              </div>
            ) : null}
          </header>

          <div className="adm-body">
            {loadError ? (
              <div className="adm-status" data-kind="error" role="alert">
                <p>{loadError}</p>
                <button type="button" className="adm-btn" onClick={load}>Try again</button>
              </div>
            ) : !doc ? (
              <p className="adm-note">Loading…</p>
            ) : !spec.root ? (
              <textarea className="adm-input adm-textarea adm-textarea--doc" value={String(doc.draft)} spellCheck
                aria-label={spec.title} onChange={(e) => setDraft(e.target.value)} />
            ) : spec.root.kind === 'list' ? (
              <RootList field={spec.root} value={doc.draft} onChange={setDraft} />
            ) : spec.root.kind === 'object' ? (
              <Fields fields={spec.root.fields} value={doc.draft as Record<string, unknown>} onChange={setDraft} />
            ) : null}
            {active === 'knowledge' && doc ? <PromptPreview stale={dirty.has('knowledge') || dirty.has('about') || dirty.has('projects') || dirty.has('site')} onError={fail} /> : null}
          </div>
        </section>
      </div>
    </ImagesCtx.Provider>
  );
}

/** Shows the exact system prompt the chat bot receives, built from the saved content. */
function PromptPreview({ stale, onError }: { stale: boolean; onError: (e: unknown) => Error }) {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const show = async () => {
    setBusy(true);
    setError('');
    try {
      setPrompt((await api.prompt()).prompt);
    } catch (err) {
      setError(onError(err).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="adm-group adm-prompt" aria-labelledby="adm-prompt-title">
      <h2 id="adm-prompt-title" className="adm-legend">Everything the bot knows</h2>
      <p className="adm-help">
        The full prompt sent with every question: the rules above, then the About page, every write-up and the extra facts.
        It uses saved content{stale ? ', so save your changes first to see them here' : ''}.
      </p>
      <button type="button" className="adm-btn" onClick={show} disabled={busy}>{busy ? 'Loading…' : prompt ? 'Refresh' : 'Show prompt'}</button>
      {error ? <p className="adm-error" role="alert">{error}</p> : null}
      {prompt ? (
        <>
          <p className="adm-help">{prompt.length.toLocaleString()} characters, roughly {Math.round(prompt.length / 4).toLocaleString()} tokens.</p>
          <pre className="adm-pre" tabIndex={0}>{prompt}</pre>
        </>
      ) : null}
    </section>
  );
}
