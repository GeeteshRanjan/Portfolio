import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import type { Field } from './schema';

/** Image paths under /public, for the image pickers. */
export const ImagesCtx = createContext<string[]>([]);

type Props<K extends Field['kind'] = Field['kind']> = {
  field: Extract<Field, { kind: K }>;
  value: unknown;
  onChange: (v: unknown) => void;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const move = <T,>(list: T[], from: number, to: number) => {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};
/** Sets or (for undefined) removes a key, keeping key order. */
const setKey = (obj: Obj, key: string, v: unknown) => {
  const next = { ...obj };
  if (v === undefined) delete next[key];
  else next[key] = v;
  return next;
};

export function FieldEditor({ field, value, onChange }: Props) {
  switch (field.kind) {
    case 'text': return <TextField field={field} value={value} onChange={onChange} />;
    case 'number': return <NumberField field={field} value={value} onChange={onChange} />;
    case 'bool': return <BoolField field={field} value={value} onChange={onChange} />;
    case 'color': return <ColorField field={field} value={value} onChange={onChange} />;
    case 'image': return <ImageField field={field} value={value} onChange={onChange} />;
    case 'strings': return <StringsField field={field} value={value} onChange={onChange} />;
    case 'lines': return <LinesField field={field} value={value} onChange={onChange} />;
    case 'object': return <ObjectField field={field} value={value} onChange={onChange} />;
    case 'list': return <ListField field={field} value={value} onChange={onChange} />;
  }
}

/** The fields of an object, without a surrounding group (used for document roots and list items). */
export function Fields({ fields, value, onChange }: { fields: Field[]; value: Obj; onChange: (v: Obj) => void }) {
  return (
    <div className="adm-fields">
      {fields.map((f) => (
        <FieldEditor key={f.key} field={f} value={value[f.key]} onChange={(v) => onChange(setKey(value, f.key, v))} />
      ))}
    </div>
  );
}

function Row({ id, field, children, error, aside }: { id: string; field: Field; children: ReactNode; error?: string; aside?: ReactNode }) {
  return (
    <div className="adm-row" data-invalid={error ? '' : undefined}>
      <div className="adm-row__head">
        <label htmlFor={id} className="adm-label">
          {field.label}
          {field.optional ? <span className="adm-optional">optional</span> : null}
        </label>
        {aside}
      </div>
      {children}
      {field.help ? <p id={`${id}-help`} className="adm-help">{field.help}</p> : null}
      {error ? <p className="adm-error" role="alert">{error}</p> : null}
    </div>
  );
}

const describedBy = (id: string, field: Field) => (field.help ? `${id}-help` : undefined);

function TextField({ field, value, onChange }: Props<'text'>) {
  const id = useId();
  const v = typeof value === 'string' ? value : '';
  const rows = field.long === true ? 4 : field.long || 0;
  const bad = field.pattern && v && !new RegExp(field.pattern).test(v) ? 'This format isn\u2019t allowed here.' : undefined;
  const common = {
    id, value: v, 'aria-describedby': describedBy(id, field), 'aria-invalid': bad ? true : undefined, spellCheck: rows > 0,
    placeholder: field.placeholder,
  };
  return (
    <Row id={id} field={field} error={bad} aside={rows ? <span className="adm-count">{v.length}</span> : null}>
      {rows ? (
        <textarea {...common} className="adm-input adm-textarea" style={{ minHeight: `${rows * 1.5 + 1}em` }} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} className="adm-input" type="text" onChange={(e) => onChange(e.target.value)} />
      )}
    </Row>
  );
}

function NumberField({ field, value, onChange }: Props<'number'>) {
  const id = useId();
  return (
    <Row id={id} field={field}>
      <input
        id={id} className="adm-input adm-input--short" type="number" step={field.step ?? 1}
        value={typeof value === 'number' ? value : ''} aria-describedby={describedBy(id, field)}
        onChange={(e) => onChange(e.target.value === '' ? (field.optional ? undefined : 0) : Number(e.target.value))}
      />
    </Row>
  );
}

function BoolField({ field, value, onChange }: Props<'bool'>) {
  const id = useId();
  if (field.optional) {
    return (
      <Row id={id} field={field}>
        <select id={id} className="adm-input adm-input--short" aria-describedby={describedBy(id, field)}
          value={value === true ? 'on' : value === false ? 'off' : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'on')}>
          <option value="">Default</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </Row>
    );
  }
  return (
    <Row id={id} field={field}>
      <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} aria-describedby={describedBy(id, field)} />
    </Row>
  );
}

function ColorField({ field, value, onChange }: Props<'color'>) {
  const id = useId();
  const v = typeof value === 'string' ? value : '#000000';
  const ok = /^#[0-9a-f]{6}$/i.test(v);
  return (
    <Row id={id} field={field} error={ok ? undefined : 'Use a 6-digit hex colour, e.g. #1a2b3c.'}>
      <div className="adm-color">
        <input type="color" value={ok ? v : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label={`${field.label} picker`} />
        <input id={id} className="adm-input adm-input--short" type="text" value={v} onChange={(e) => onChange(e.target.value.trim())} />
      </div>
    </Row>
  );
}

function ImageField({ field, value, onChange }: Props<'image'>) {
  const id = useId();
  const images = useContext(ImagesCtx);
  const v = typeof value === 'string' ? value : '';
  const missing = v && v.startsWith('/') && images.length && !images.includes(v) ? `No file at public${v}.` : undefined;
  return (
    <Row id={id} field={field} error={missing}>
      <div className="adm-image">
        {v ? <img src={v} alt="" /> : <span className="adm-image__empty">No image</span>}
        <div className="adm-image__pick">
          <input id={id} className="adm-input" type="text" list={`${id}-list`} value={v} placeholder="/images/…" aria-describedby={describedBy(id, field)} onChange={(e) => onChange(e.target.value)} />
          <datalist id={`${id}-list`}>{images.map((src) => <option key={src} value={src} />)}</datalist>
          <p className="adm-help">Add new files to <code>public/images/</code>, then pick them here.</p>
        </div>
      </div>
    </Row>
  );
}

function ItemControls({ i, n, onMove, onRemove, label }: { i: number; n: number; onMove: (to: number) => void; onRemove: () => void; label: string }) {
  return (
    // preventDefault: inside a <summary>, a click would also open/close the card.
    <span className="adm-ctrls" onClick={(e) => e.preventDefault()}>
      <button type="button" className="adm-icon" disabled={i === 0} onClick={() => onMove(i - 1)} aria-label={`Move ${label} ${i + 1} up`} title="Move up">↑</button>
      <button type="button" className="adm-icon" disabled={i === n - 1} onClick={() => onMove(i + 1)} aria-label={`Move ${label} ${i + 1} down`} title="Move down">↓</button>
      <button type="button" className="adm-icon adm-icon--danger" onClick={onRemove} aria-label={`Remove ${label} ${i + 1}`} title="Remove">×</button>
    </span>
  );
}

function StringsField({ field, value, onChange }: Props<'strings'>) {
  const id = useId();
  const list = Array.isArray(value) ? (value as string[]) : [];
  const item = field.itemLabel ?? 'item';
  const set = (next: string[]) => onChange(next);
  return (
    <fieldset className="adm-group adm-group--flat" aria-describedby={describedBy(id, field)}>
      <legend className="adm-label">
        {field.label}
        {field.optional ? <span className="adm-optional">optional</span> : null}
      </legend>
      {field.help ? <p id={`${id}-help`} className="adm-help">{field.help}</p> : null}
      <ol className="adm-strings">
        {list.map((s, i) => (
          <li key={i}>
            <span className="adm-strings__n" aria-hidden="true">{i + 1}</span>
            {field.long ? (
              <textarea className="adm-input adm-textarea" style={{ minHeight: '4em' }} value={s} aria-label={`${field.label} ${i + 1}`}
                onChange={(e) => set(list.map((x, j) => (j === i ? e.target.value : x)))} />
            ) : (
              <input className="adm-input" type="text" value={s} aria-label={`${field.label} ${i + 1}`}
                onChange={(e) => set(list.map((x, j) => (j === i ? e.target.value : x)))} />
            )}
            <ItemControls i={i} n={list.length} label={item} onMove={(to) => set(move(list, i, to))} onRemove={() => set(list.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ol>
      <button type="button" className="adm-add" onClick={() => set([...list, ''])}>+ Add {item}</button>
    </fieldset>
  );
}

function LinesField({ field, value, onChange }: Props<'lines'>) {
  const id = useId();
  const text = Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : '';
  const rows = Math.max(1, text.split('\n').length);
  return (
    <Row id={id} field={field}>
      <textarea id={id} className="adm-input adm-textarea" style={{ minHeight: `${rows * 1.5 + 1}em` }} value={text} aria-describedby={describedBy(id, field)}
        onChange={(e) => {
          const lines = e.target.value.split('\n');
          onChange(lines.length > 1 ? lines : lines[0]);
        }} />
    </Row>
  );
}

function ObjectField({ field, value, onChange }: Props<'object'>) {
  const id = useId();
  if (!isObj(value)) {
    return (
      <div className="adm-row adm-row--absent">
        <span className="adm-label">{field.label}<span className="adm-optional">not used</span></span>
        {field.help ? <p className="adm-help">{field.help}</p> : null}
        <button type="button" className="adm-add" onClick={() => onChange(Object.fromEntries(field.fields.filter((f) => !f.optional).map((f) => [f.key, emptyValue(f)])))}>
          + Add {field.label.toLowerCase()}
        </button>
      </div>
    );
  }
  return (
    <fieldset className="adm-group" aria-describedby={describedBy(id, field)}>
      <legend className="adm-legend">
        {field.label}
        {field.optional ? (
          <button type="button" className="adm-link adm-link--danger" onClick={() => confirm(`Remove "${field.label}"?`) && onChange(undefined)}>Remove</button>
        ) : null}
      </legend>
      {field.help ? <p id={`${id}-help`} className="adm-help">{field.help}</p> : null}
      <Fields fields={field.fields} value={value} onChange={onChange} />
    </fieldset>
  );
}

/** Starting value for a newly added required field. */
function emptyValue(f: Field): unknown {
  switch (f.kind) {
    case 'number': return 0;
    case 'bool': return false;
    case 'color': return '#000000';
    case 'strings': return [];
    case 'list': return [];
    case 'object': return Object.fromEntries(f.fields.filter((x) => !x.optional).map((x) => [x.key, emptyValue(x)]));
    default: return '';
  }
}

const summaryOf = (field: Extract<Field, { kind: 'list' }>, item: unknown, i: number) => {
  const s = isObj(item) && field.summary ? item[field.summary] : '';
  return (typeof s === 'string' && s.trim()) || `${field.itemLabel ?? 'Item'} ${i + 1}`;
};

function ListField({ field, value, onChange }: Props<'list'>) {
  const id = useId();
  const list = Array.isArray(value) ? (value as Obj[]) : [];
  const [opened, setOpened] = useState<number | null>(null);
  const item = field.itemLabel ?? 'item';
  return (
    <fieldset className="adm-group" aria-describedby={describedBy(id, field)}>
      <legend className="adm-legend">
        {field.label}
        {field.optional ? <span className="adm-optional">optional</span> : null}
      </legend>
      {field.help ? <p id={`${id}-help`} className="adm-help">{field.help}</p> : null}
      <div className="adm-cards">
        {list.map((it, i) => (
          <details key={i} className="adm-card" open={opened === i || undefined}>
            <summary>
              <span className="adm-card__n">{i + 1}</span>
              <span className="adm-card__title">{summaryOf(field, it, i)}</span>
              <ItemControls
                i={i} n={list.length} label={item}
                onMove={(to) => { onChange(move(list, i, to)); setOpened(null); }}
                onRemove={() => confirm(`Remove ${item} "${summaryOf(field, it, i)}"?`) && onChange(list.filter((_, j) => j !== i))}
              />
            </summary>
            <Fields fields={field.fields} value={isObj(it) ? it : {}} onChange={(v) => onChange(list.map((x, j) => (j === i ? v : x)))} />
          </details>
        ))}
      </div>
      <button type="button" className="adm-add" onClick={() => { onChange([...list, field.newItem()]); setOpened(list.length); }}>+ Add {item}</button>
    </fieldset>
  );
}

/** Master-detail editor for a document whose root is a list (the discs). */
export function RootList({ field, value, onChange }: { field: Extract<Field, { kind: 'list' }>; value: unknown; onChange: (v: unknown) => void }) {
  const list = Array.isArray(value) ? (value as Obj[]) : [];
  const [sel, setSel] = useState(0);
  const at = Math.min(sel, list.length - 1);
  const item = field.itemLabel ?? 'item';
  const uniq = field.unique;

  const duplicate = (i: number) => {
    const copy = structuredClone(list[i]);
    if (uniq && typeof copy[uniq] === 'string') copy[uniq] = `${copy[uniq]}-copy`;
    if (field.summary && typeof copy[field.summary] === 'string') copy[field.summary] = `${copy[field.summary]} (copy)`;
    onChange([...list.slice(0, i + 1), copy, ...list.slice(i + 1)]);
    setSel(i + 1);
  };
  const remove = (i: number) => {
    if (!confirm(`Delete ${item} "${summaryOf(field, list[i], i)}"? This can be undone with Discard until you save.`)) return;
    onChange(list.filter((_, j) => j !== i));
    setSel(Math.max(0, i - 1));
  };

  return (
    <div className="adm-master">
      <div className="adm-master__list">
        <p className="adm-help">Gallery order, left to right.</p>
        <ol>
          {list.map((it, i) => (
            <li key={i} data-active={i === at || undefined}>
              <button type="button" className="adm-master__pick" onClick={() => setSel(i)} aria-current={i === at || undefined}>
                <span className="adm-card__n">{i + 1}</span>
                <span className="adm-master__name">
                  {summaryOf(field, it, i)}
                  {typeof it.category === 'string' ? <small>{it.category} · {String(it.year ?? '')}</small> : null}
                </span>
              </button>
              <ItemControls i={i} n={list.length} label={item} onMove={(to) => { onChange(move(list, i, to)); if (i === at) setSel(to); }} onRemove={() => remove(i)} />
            </li>
          ))}
        </ol>
        <button type="button" className="adm-add" onClick={() => { onChange([...list, field.newItem()]); setSel(list.length); }}>+ Add {item}</button>
      </div>
      {list[at] ? (
        <div className="adm-master__detail">
          <div className="adm-master__bar">
            <h3>{summaryOf(field, list[at], at)}</h3>
            <span>
              {!list[at].href && typeof list[at].slug === 'string'
                ? <a className="adm-link" href={`/work/${list[at].slug}`} target="_blank" rel="noreferrer">Open page ↗</a>
                : null}
              <button type="button" className="adm-link" onClick={() => duplicate(at)}>Duplicate</button>
            </span>
          </div>
          {list[at].href ? <p className="adm-note">This disc opens <code>{String(list[at].href)}</code>, so only its title, category, year, facts and colours are used; its write-up and buttons are ignored.</p> : null}
          <Fields key={at} fields={field.fields} value={list[at]} onChange={(v) => onChange(list.map((x, j) => (j === at ? v : x)))} />
        </div>
      ) : <p className="adm-note">No {item}s yet.</p>}
    </div>
  );
}
