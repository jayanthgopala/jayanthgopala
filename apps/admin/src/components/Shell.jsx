import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Button } from './ui.jsx';
import Dashboard from '../pages/Dashboard.jsx';
import ProfilePage from '../pages/ProfilePage.jsx';
import StatusPage from '../pages/StatusPage.jsx';
import ProjectsPage from '../pages/ProjectsPage.jsx';
import StackPage from '../pages/StackPage.jsx';
import SocialsPage from '../pages/SocialsPage.jsx';
import { EducationPage, ExperiencePage } from '../pages/TimelinePage.jsx';
import CopyPage from '../pages/CopyPage.jsx';
import PublishPage from '../pages/PublishPage.jsx';

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', Component: Dashboard },
  { id: 'profile', label: 'Profile', Component: ProfilePage },
  { id: 'status', label: 'Live status', Component: StatusPage },
  { id: 'projects', label: 'Projects', Component: ProjectsPage },
  { id: 'experience', label: 'Experience', Component: ExperiencePage },
  { id: 'education', label: 'Education', Component: EducationPage },
  { id: 'stack', label: 'Tech stack', Component: StackPage },
  { id: 'socials', label: 'Links', Component: SocialsPage },
  { id: 'copy', label: 'Copy', Component: CopyPage },
  { id: 'publish', label: 'Publish', Component: PublishPage },
];

/**
 * Hash routing. A seven-page single-operator console does not need a router
 * dependency — the hash is already a perfectly good, bookmarkable state store.
 */
function useHashRoute(fallback) {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || fallback);

  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.slice(1) || fallback);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, [fallback]);

  return route;
}

export default function Shell({ onLogout }) {
  const route = useHashRoute('dashboard');
  const active = PAGES.find((p) => p.id === route) || PAGES[0];
  const { Component } = active;

  async function logout() {
    try {
      await api.logout();
    } finally {
      onLogout();
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="login-mark" style={{ width: 32, height: 32, fontSize: 13 }}>
            P
          </span>
          <div>
            <div style={{ fontWeight: 600 }}>Console</div>
            <div className="dim" style={{ fontSize: 'var(--t-micro)' }}>
              Portfolio CMS
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {PAGES.map((page) => (
            <a
              key={page.id}
              href={`#${page.id}`}
              className="sidebar-link"
              aria-current={page.id === active.id ? 'page' : undefined}
            >
              {page.label}
            </a>
          ))}
        </nav>

        <div className="sidebar-foot">
          <Button size="sm" variant="ghost" onClick={logout}>
            Sign out
          </Button>
        </div>
      </aside>

      <main className="main">
        <Component />
      </main>
    </div>
  );
}
