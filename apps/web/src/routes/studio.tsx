import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createRoute } from '@tanstack/react-router';

import { Route as rootRoute } from './__root';
import { apiFetch, ApiError } from '../lib/api';
import { useLanguages } from '../lib/languages';
import { useAiTasks } from '../lib/tasks';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/studio',
  component: Studio,
});

type RunState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; cached: boolean; result: Record<string, unknown> };

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

  function buildPayload(): Record<string, unknown> {
    switch (task) {
      case 'translate':
        return { text: text.trim(), targetLanguage };
      case 'question-answering':
        return { question: question.trim(), context: text.trim() };
      case 'zero-shot-classification':
        return {
          text: text.trim(),
          candidateLabels: candidateLabels
            .split(',')
            .map((label) => label.trim())
            .filter(Boolean),
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || run.kind === 'busy') return;
    setRun({ kind: 'busy' });

    try {
      const result = await apiFetch<Record<string, unknown>>(`/api/ai/${task}`, {
        method: 'POST',
        body: JSON.stringify(buildPayload()),
      });
      const cached = typeof result.cached === 'boolean' ? result.cached : false;
      setRun({ kind: 'done', cached, result });
    } catch (cause) {
      if (cause instanceof ApiError) {
        setRun({ kind: 'error', message: cause.apiMessage ?? cause.message });
      } else {
        setRun({ kind: 'error', message: 'Something went wrong. Please try again.' });
      }
    }
  }

  async function copyResult() {
    if (run.kind !== 'done') return;
    await navigator.clipboard.writeText(JSON.stringify(run.result, null, 2));
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
            value={task}
            onChange={(event) => {
              setTask(event.target.value);
              setRun({ kind: 'idle' });
            }}
            style={{ width: 'auto' }}
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
              value={targetLanguage}
              onChange={(event) => setTargetLanguage(event.target.value)}
              style={{ width: 'auto' }}
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
              type="text"
              placeholder="Who was Jim Henson?"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </div>
        )}

        {task === 'zero-shot-classification' && (
          <div>
            <label htmlFor="studio-labels">Candidate labels (comma separated)</label>
            <input
              id="studio-labels"
              type="text"
              value={candidateLabels}
              onChange={(event) => setCandidateLabels(event.target.value)}
            />
          </div>
        )}

        <label htmlFor="studio-text">{task === 'question-answering' ? 'Context' : 'Text'}</label>
        <textarea
          id="studio-text"
          rows={8}
          placeholder={
            task === 'question-answering'
              ? 'Paste the context the question is about…'
              : 'Type or paste the text…'
          }
          value={text}
          onChange={(event) => setText(event.target.value)}
        />

        {run.kind === 'error' && (
          <div className="error-box" role="alert">
            {run.message}
          </div>
        )}

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button type="submit" className="button" disabled={!canSubmit || run.kind === 'busy'}>
            {run.kind === 'busy' ? 'Running…' : 'Run'}
          </button>
          {run.kind === 'done' && (
            <div className="row" style={{ gap: 8 }}>
              <span className={`badge ${run.cached ? 'badge-ok' : ''}`}>
                {run.cached ? 'cached' : 'model'}
              </span>
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={copyResult}
              >
                Copy JSON
              </button>
            </div>
          )}
        </div>
      </form>

      {run.kind === 'done' && (
        <section className="panel stack" aria-label="Result">
          <span className="muted">Result</span>
          <pre className="result-area mono" style={{ whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(run.result, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
