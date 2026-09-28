import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react';
import { useLocation } from 'react-router';
import { assistant } from '../content/assistant';
import { about } from '../content/about';
import { ui } from '../content/ui';
import { stopScroll, resumeScroll } from '../motion/SmoothScroll';
import { HoverText } from './HoverText';

type Msg = { role: 'user' | 'assistant'; content: string; error?: boolean };

const STORE = 'ask:v1';
const MAX_CHARS = 1000; // matches server/chat.ts

/** What can be sent back: failed turns stay on screen, minus each error and the question it answered. */
const sendable = (list: Msg[]) => list.filter((m, i) => !m.error && !list[i + 1]?.error);

function restore(): Msg[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) ?? '[]');
    return Array.isArray(saved) ? saved.filter((m) => m && typeof m.content === 'string' && !m.error) : [];
  } catch {
    return [];
  }
}

/*
 * One conversation per visit, shared by every view of it (About page, nav dialog), so an answer
 * keeps streaming when the dialog closes and both views always show the same thread.
 */
let chat = { messages: restore(), busy: false };
let abort: AbortController | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

function set(next: Partial<typeof chat>) {
  chat = { ...chat, ...next };
  if (!chat.busy) sessionStorage.setItem(STORE, JSON.stringify(sendable(chat.messages)));
  listeners.forEach((l) => l());
}

async function ask(question: string) {
  const q = question.trim().slice(0, MAX_CHARS);
  if (!q || chat.busy) return;
  const history = sendable(chat.messages).concat({ role: 'user', content: q });
  const ctrl = (abort = new AbortController());
  set({ busy: true, messages: [...chat.messages, { role: 'user', content: q }, { role: 'assistant', content: '' }] });
  // Rewrites the answer in progress; a no-op once stopped or cleared.
  const update = (fn: (last: Msg) => Msg) => {
    if (!ctrl.signal.aborted) set({ messages: [...chat.messages.slice(0, -1), fn(chat.messages[chat.messages.length - 1])] });
  };

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || assistant.errors.unavailable);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) update((last) => ({ ...last, content: last.content + text }));
    }
    update((last) => (last.content.trim()
      ? { ...last, content: last.content.trim() }
      : { ...last, error: true, content: assistant.errors.empty }));
  } catch (err) {
    if (ctrl.signal.aborted) {
      // Stopped: keep what arrived, drop an empty answer (after Clear the list is already empty).
      const last = chat.messages[chat.messages.length - 1];
      if (last?.role === 'assistant' && !last.content) set({ messages: chat.messages.slice(0, -1) });
    } else {
      update((last) => ({ ...last, error: true, content: (err as Error).message || assistant.errors.generic }));
    }
  } finally {
    abort = null;
    set({ busy: false });
  }
}

const Arrow = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.25" /></svg>
);

/**
 * "Ask about me": a ruled interview transcript. Questions are set in the display serif, answers in
 * the body face; before the first one, the suggestions sit on the input as ready-made questions.
 * `onClose` = shown in the nav dialog; `shown` flips true each time the dialog opens.
 */
function Chat({ onClose, shown }: { onClose?: () => void; shown?: boolean }) {
  const { messages, busy } = useSyncExternalStore(subscribe, () => chat);
  const [input, setInput] = useState('');
  const id = useId();
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true); // follow new text unless the reader scrolled up
  const wasBusy = useRef(false);

  useEffect(() => {
    const log = logRef.current;
    if (log && stick.current) log.scrollTop = log.scrollHeight;
  }, [messages]);

  // After an answer, put the caret back if focus fell to the page (a clicked suggestion unmounts).
  useEffect(() => {
    if (wasBusy.current && !busy && document.activeElement === document.body) inputRef.current?.focus({ preventScroll: true });
    wasBusy.current = busy;
  }, [busy]);

  // Dialog opened: jump to the latest turn; with a mouse, go straight to typing (touch keeps its keyboard down).
  useEffect(() => {
    if (!shown) return;
    stick.current = true;
    logRef.current!.scrollTop = logRef.current!.scrollHeight;
    if (matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, [shown]);

  const send = (q: string) => {
    stick.current = true;
    ask(q);
    setInput('');
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) abort?.abort();
    else send(input);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!busy) send(input);
    }
  };

  const clear = () => {
    abort?.abort();
    set({ messages: [] });
    inputRef.current?.focus();
  };

  return (
    <section className="ask" aria-labelledby={`${id}-title`}>
      <header className="ask__head">
        <h2 id={`${id}-title`} className="eyebrow">{assistant.label}</h2>
        <div className="ask__tools">
          {messages.length
            ? <button type="button" className="eyebrow ask__tool" onClick={clear}>{assistant.ui.clear}</button>
            : <p className="eyebrow ask__note">{assistant.ui.note}</p>}
          {onClose ? <button type="button" className="eyebrow ask__tool" onClick={onClose}>{assistant.ui.close}</button> : null}
        </div>
      </header>

      <div
        ref={logRef}
        className="ask__log"
        role="log"
        aria-live="polite"
        aria-busy={busy}
        aria-label={assistant.ui.logLabel}
        data-lenis-prevent=""
        onScroll={(e) => {
          const log = e.currentTarget;
          stick.current = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
        }}
        tabIndex={messages.length ? 0 : -1}
      >
        {messages.length === 0 ? (
          <>
            <p className="ask__greeting">{assistant.greeting}</p>
            <ul className="ask__picks" aria-label={assistant.ui.suggestionsLabel}>
              {assistant.suggestions.map((s) => (
                <li key={s}>
                  <span className="rule" />
                  <button type="button" className="ask__pick" data-hover="" onClick={() => send(s)}>
                    <HoverText text={s} />
                    <Arrow />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          messages.map((m, i) => {
            const live = busy && i === messages.length - 1;
            return m.role === 'user' ? (
              <p className="ask__q" key={i}>
                <span className="sr-only">{assistant.ui.youAsked}</span>
                <span>{m.content}</span>
              </p>
            ) : (
              <p className="ask__a" data-error={m.error || undefined} key={i}>
                <span className="sr-only">{assistant.ui.answer}</span>
                {live && !m.content ? <span className="ask__thinking">{assistant.ui.thinking}…</span> : m.content}
                {m.error ? <> <a className="profile__inline-link" href={`mailto:${about.contact.email}`}>{about.contact.email}</a></> : null}
                {live && m.content ? <span className="ask__caret" aria-hidden="true" /> : null}
              </p>
            );
          })
        )}
      </div>

      <form className="ask__form" onSubmit={onSubmit}>
        <span className="rule" />
        <label htmlFor={`${id}-input`} className="sr-only">{assistant.ui.inputLabel}</label>
        <textarea
          id={`${id}-input`}
          ref={inputRef}
          className="ask__input"
          rows={1}
          value={input}
          maxLength={MAX_CHARS}
          placeholder={assistant.placeholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          enterKeyHint="send"
          autoComplete="off"
        />
        <button
          type="submit"
          className="ask__send"
          data-hover=""
          disabled={!busy && !input.trim()}
          aria-label={busy ? assistant.ui.stopLabel : assistant.ui.sendLabel}
        >
          <HoverText text={busy ? assistant.ui.stop : assistant.ui.ask} />
          {busy ? <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" fill="currentColor" /></svg> : <Arrow />}
        </button>
      </form>
    </section>
  );
}

/** Inline chat (About hero). */
export function AskChat() {
  return <Chat />;
}

/**
 * Nav entry: opens the same chat in a native modal <dialog> (focus trap, Escape, inert page).
 * The page's smooth scroll is paused while it's open.
 */
export function AskDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const downOnBackdrop = useRef(false);
  const [shown, setShown] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => ref.current?.close(), [pathname]); // e.g. browser back while open

  const show = () => {
    ref.current!.showModal();
    stopScroll();
    setShown(true);
  };

  return (
    <>
      <button type="button" className="nav__link" aria-haspopup="dialog" onClick={show} data-hover="">
        <HoverText text={ui.nav.ask} />
      </button>
      <dialog
        ref={ref}
        className="ask-dialog"
        aria-label={assistant.label}
        onClose={() => { resumeScroll(); setShown(false); }}
        // Backdrop clicks land on the <dialog> itself. Both ends must be on it, so a text selection
        // dragged out of the panel doesn't close it.
        onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
        onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) e.currentTarget.close(); }}
      >
        <Chat shown={shown} onClose={() => ref.current!.close()} />
      </dialog>
    </>
  );
}
