import { createRoute } from '@tanstack/react-router';
import { type FormEvent, useEffect, useMemo, useState } from 'react';

import { ApiError, apiFetch } from '../lib/api';
import { useLanguages } from '../lib/languages';
import { useAiTasks } from '../lib/tasks';
import { Route as rootRoute } from './__root';

export const Route = createRoute({
  component: Studio,
  getParentRoute: () => rootRoute,
  path: '/studio',
});

type RunState =
  | { cached: boolean; kind: 'done'; result: Record<string, unknown> }
  | { kind: 'busy' }
  | { kind: 'error'; message: string }
  | { kind: 'idle' };

/**
 * Studio page: per-task AI console against the general-purpose AI endpoints.
 * @returns the rendered studio
 */
export function Studio() {
  const { data: tasks = [] } = useAiTasks();
  const { data: languages = [] } = useLanguages();
  const [task, setTask] = useState<string>('translate');
  const [text, setText] = useState('');
  const [question, setQuestion] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [candidateLabels, setCandidateLabels] = useState('urgent, not urgent');
  const [run, setRun] = useState<RunState>({ kind: 'idle' });

  useEffect(() => {
    if (tasks.length > 0 && !tasks.some((entry) => entry.task === task)) {
      setTask(tasks[0]?.task ?? 'translate');
    }
  }, [tasks, task]);

  const selected = useMemo(() => tasks.find((entry) => entry.task === task), [tasks, task]);

  /**
   * Builds the task-shaped request payload from the form state.
   * @returns the payload to POST to /api/ai/<task>
   */
  function buildPayload(): Record<string, unknown> {
    switch (task) {
      case 'question-answering':
        return { context: text.trim(), question: question.trim() };
      case 'translate':
        return { targetLanguage, text: text.trim() };
      case 'zero-shot-classification':
        return {
          candidateLabels: candidateLabels
            .split(',')
            .map((label) => label.trim())
            .filter(Boolean),
          text: text.trim(),
        };
      default:
        return { text: text.trim() };
    }
  }

  const canSubmit = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (task === 'question-answering' && !question.trim()) return false;
    if (task === 'zero-shot-classification') {
      const labels = candidateLabels
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean);
      if (labels.length < 2) return false;
    }
    return true;
  }, [text, task, question, candidateLabels]);

  /**
   * Submits the task form and renders the result.
   * @param event - the form submit event
   */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || run.kind === 'busy') return;
    setRun({ kind: 'busy' });

    try {
      const result = await apiFetch<Record<string, unknown>>(`/api/ai/${task}`, {
        body: JSON.stringify(buildPayload()),
        method: 'POST',
      });
      const cached = typeof result.cached === 'boolean' ? result.cached : false;
      setRun({ cached, kind: 'done', result });
    } catch (cause) {
      if (cause instanceof ApiError) {
        setRun({ kind: 'error', message: cause.apiMessage ?? cause.message });
      } else {
        setRun({ kind: 'error', message: 'Something went wrong. Please try again.' });
      }
    }
  }

  /**
   * Copies a finished result to the clipboard.
   * @param result - the already-rendered result payload
   */
  async function copyResult(result: Record<string, unknown>) {
    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- browser global, not Node's experimental navigator
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0 }}>Studio</h1>
          <p className="muted" style={{ margin: 0 }}>
            Every AI task the service exposes — one endpoint, one cached pipeline.
          </p>
        </div>
        <div className="row">
          <label htmlFor="studio-task" style={{ margin: 0 }}>
            Task
          </label>
          <select
            id="studio-task"
            onChange={(event) => {
              setTask(event.target.value);
              setRun({ kind: 'idle' });
            }}
            style={{ width: 'auto' }}
            value={task}
          >
            {tasks.map((entry) => (
              <option key={entry.task} value={entry.task}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="muted" style={{ margin: 0 }}>
        <span className="badge">{selected?.provider ?? '…'}</span>{' '}
        <code className="mono">{selected?.model ?? ''}</code>
        {selected?.description ? ` — ${selected.description}` : ''}
      </p>

      <form className="panel stack" onSubmit={submit}>
        {task === 'translate' && (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label htmlFor="studio-target" style={{ margin: 0 }}>
              Into
            </label>
            <select
              id="studio-target"
              onChange={(event) => setTargetLanguage(event.target.value)}
              style={{ width: 'auto' }}
              value={targetLanguage}
            >
              {languages.map((language) => (
                <option key={language.id} value={language.iso6391}>
                  {language.nativeName} ({language.iso6391})
                </option>
              ))}
            </select>
          </div>
        )}

        {task === 'question-answering' && (
          <div>
            <label htmlFor="studio-question">Question</label>
            <input
              id="studio-question"
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Who was Jim Henson?"
              type="text"
              value={question}
            />
          </div>
        )}

        {task === 'zero-shot-classification' && (
          <div>
            <label htmlFor="studio-labels">Candidate labels (comma separated)</label>
            <input
              id="studio-labels"
              onChange={(event) => setCandidateLabels(event.target.value)}
              type="text"
              value={candidateLabels}
            />
          </div>
        )}

        <label htmlFor="studio-text">{task === 'question-answering' ? 'Context' : 'Text'}</label>
        <textarea
          id="studio-text"
          onChange={(event) => setText(event.target.value)}
          placeholder={
            task === 'question-answering'
              ? 'Paste the context the question is about…'
              : 'Type or paste the text…'
          }
          rows={8}
          value={text}
        />

        {run.kind === 'error' && (
          <div className="error-box" role="alert">
            {run.message}
          </div>
        )}

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="button" disabled={!canSubmit || run.kind === 'busy'} type="submit">
            {run.kind === 'busy' ? 'Running…' : 'Run'}
          </button>
          {run.kind === 'done' && (
            <div className="row" style={{ gap: 8 }}>
              <span className={`badge ${run.cached ? 'badge-ok' : ''}`}>
                {run.cached ? 'cached' : 'model'}
              </span>
              <button
                className="button button-ghost button-small"
                onClick={() => copyResult(run.result)}
                type="button"
              >
                Copy JSON
              </button>
            </div>
          )}
        </div>
      </form>

      {run.kind === 'done' && (
        <section aria-label="Result" className="panel stack">
          <span className="muted">Result</span>
          <pre className="result-area mono" style={{ whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(run.result, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
