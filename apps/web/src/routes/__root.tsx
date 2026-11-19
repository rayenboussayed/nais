import { createRootRoute, Link, Outlet, redirect, useRouterState } from '@tanstack/react-router';

import { hasSession } from '../lib/session';

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    if (location.pathname === '/login') return;
    if (!(await hasSession())) {
      throw redirect({ to: '/login' });
    }
  },
  component: RootComponent,
});

function RootComponent() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isLogin = pathname === '/login';

  return (
    <div className="app-shell">
      {!isLogin && (
        <header className="topbar">
          <span className="brand">trainslator</span>
          <nav className="topnav" aria-label="Main">
            <Link to="/" activeProps={{ className: 'active' }}>
              Playground
            </Link>
            <Link to="/studio" activeProps={{ className: 'active' }}>
              Studio
            </Link>
            <Link to="/admin" activeProps={{ className: 'active' }}>
              Admin
            </Link>
          </nav>
        </header>
      )}
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
