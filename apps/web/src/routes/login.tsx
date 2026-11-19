import { createRoute, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';

import { ApiError, apiFetch } from '../lib/api';
import { invalidateSessionProbe } from '../lib/session';
import { Route as rootRoute } from './__root';

export const Route = createRoute({
  component: LoginPage,
  getParentRoute: () => rootRoute,
  path: '/login',
});

/**
 * Login page: posts credentials to /api/auth/login.
 * @returns the rendered login page
 */
function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<null | string>(null);

  /**
   * Submits the login form.
   * @param event - the form submit event
   */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      await apiFetch<{ username: string }>('/api/auth/login', {
        body: JSON.stringify({ password, username }),
        method: 'POST',
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
          autoComplete="username"
          autoFocus
          id="username"
          name="username"
          onChange={(event) => setUsername(event.target.value)}
          required
          type="text"
          value={username}
        />
      </div>
      <div>
        <label htmlFor="password">Password</label>
        <input
          autoComplete="current-password"
          id="password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </div>
      <button className="button" disabled={busy} type="submit">
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
