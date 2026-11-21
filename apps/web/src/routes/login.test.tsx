// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Route as rootRoute } from './__root';
import { Route } from './login';

const { invalidateSessionProbe, navigate } = vi.hoisted(() => ({
  invalidateSessionProbe: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...original, useNavigate: () => navigate };
});

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
  return { ...original, apiFetch: vi.fn() };
});

vi.mock('../lib/session', () => ({ invalidateSessionProbe }));

import { ApiError, apiFetch } from '../lib/api';

/**
 * Creates a promise that a test can settle explicitly.
 * @returns the promise and its resolver
 */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/**
 * Renders the login page exported through its route.
 */
function renderLogin() {
  const Component = Route.options.component;
  if (!Component) throw new Error('login route has no component');
  render(<Component />);
}

/**
 * Fills the credentials and submits the form.
 * @param username - the username to type
 * @param password - the password to type
 */
function signIn(username: string, password: string) {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('login page', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    navigate.mockReset();
    invalidateSessionProbe.mockReset();
    navigate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the credential form', () => {
    renderLogin();

    expect(screen.getByRole('heading', { name: 'trainslator' })).toBeTruthy();
    expect(screen.getByLabelText('Username')).toHaveProperty('type', 'text');
    expect(screen.getByLabelText('Password')).toHaveProperty('type', 'password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('posts the credentials, drops the session probe and navigates home on success', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ user: { id: 'u1' } } as never);
    renderLogin();

    signIn('alice', 's3cret');

    expect(apiFetch).toHaveBeenCalledWith('/api/auth/login', {
      body: JSON.stringify({ password: 's3cret', username: 'alice' }),
      method: 'POST',
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }));
    expect(invalidateSessionProbe).toHaveBeenCalledTimes(1);
  });

  it('shows the invalid-credentials message on a 401', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(401, 'Authentication required'));
    renderLogin();

    signIn('alice', 'wrong');

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Invalid credentials.');
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(invalidateSessionProbe).not.toHaveBeenCalled();
  });

  it('shows the generic message for another API error', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(500, 'Internal Server Error'));
    renderLogin();

    signIn('alice', 's3cret');

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Could not sign in. Please try again.');
    });
  });

  it('shows the generic message for a non-API failure', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('network down'));
    renderLogin();

    signIn('alice', 's3cret');

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Could not sign in. Please try again.');
    });
  });

  it('disables the form while signing in and ignores a second submit', async () => {
    const pending = deferred<unknown>();
    vi.mocked(apiFetch).mockReturnValue(pending.promise as never);
    renderLogin();

    signIn('alice', 's3cret');

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Signing in…' })).toHaveProperty('disabled', true);

    const form = screen.getByRole('button', { name: 'Signing in…' }).closest('form');
    if (!form) throw new Error('login form was not rendered');
    fireEvent.submit(form);
    expect(apiFetch).toHaveBeenCalledTimes(1);

    pending.settle({});
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }));
  });
});

describe('route metadata', () => {
  it('declares its parent route', () => {
    expect(Route.options.getParentRoute()).toBe(rootRoute);
  });
});
