import { useState, type FormEvent } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';

import { Route as rootRoute } from './__root';
import { apiFetch, ApiError } from '../lib/api';
import { invalidateSessionProbe } from '../lib/session';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      await apiFetch<{ username: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      invalidateSessionProbe();
      await navigate({ to: '/' });
    } catch (cause) {
      setBusy(false);
      if (cause instanceof ApiError && cause.status === 401) {
        setError('Invalid credentials.');
      } else {
        setError('Could not sign in. Please try again.');
      }
    }
  }

  return (
    <form className="panel stack login-card" onSubmit={submit}>
      <h1 className="brand" style={{ margin: 0 }}>
        trainslator
      </h1>
      <p className="muted" style={{ marginTop: 0 }}>
        AI translation, cached and model-backed. Sign in with your service credential.
      </p>

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <button type="submit" className="button" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
