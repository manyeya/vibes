import React, { useState, useEffect, useCallback } from 'react';
import { MotionConfig, AnimatePresence } from 'framer-motion';
import { PanelLeft, ChevronRight } from 'lucide-react';
import { SessionSidebar } from './components/chat/SessionSidebar';
import { ChatArea } from './components/chat/ChatArea';
import { LeftNav } from './components/LeftNav';
import { SettingsPage, type SearchProviderId } from './components/SettingsPage';
import type { ModelOption } from './components/chat/ModelSelector';
import type { Session } from './components/chat/session-types';

type Route = 'chat' | 'settings';

const parseRoute = (hash: string): Route => (hash.replace(/^#\/?/, '') === 'settings' ? 'settings' : 'chat');

// ============ MAIN APP ============
export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
    return localStorage.getItem('vibes_session_id') || 'default';
  });
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem('vibes_sidebar_open');
    if (saved !== null) return saved === '1';
    return typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
  });
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(() => localStorage.getItem('vibes_model') || '');
  const [searchProvider, setSearchProvider] = useState<SearchProviderId>(
    () => (localStorage.getItem('vibes_search_provider') as SearchProviderId) || 'auto',
  );

  // Hash-based routing for top-level views (chat / settings) — a real URL
  // (#/settings) without pulling in a router dependency.
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const goSettings = useCallback(() => { window.location.hash = '#/settings'; }, []);
  const goChat = useCallback(() => { window.location.hash = '#/'; }, []);

  const fetchSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      if (data.success) {
        setSessions(data.sessions);
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  const createSession = useCallback(async (title?: string) => {
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(title ? { title } : {}),
      });
      const data = await res.json();
      if (data.success) {
        await fetchSessions();
        setCurrentSessionId(data.sessionId);
      }
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }, [fetchSessions]);

  const deleteSession = useCallback(async (sessionId: string) => {
    if (sessionId === 'default') return;
    try {
      await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      await fetchSessions();
      if (currentSessionId === sessionId) {
        setCurrentSessionId('default');
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }, [currentSessionId, fetchSessions]);

  useEffect(() => {
    localStorage.setItem('vibes_session_id', currentSessionId);
  }, [currentSessionId]);

  useEffect(() => {
    localStorage.setItem('vibes_sidebar_open', sidebarOpen ? '1' : '0');
  }, [sidebarOpen]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Load available models and resolve the active selection.
  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((d) => {
        if (!d?.success) return;
        setModels(d.models ?? []);
        setSelectedModel((prev) => prev || d.active || d.models?.[0]?.id || '');
      })
      .catch(() => { /* selector stays hidden if unavailable */ });
  }, []);

  useEffect(() => {
    if (selectedModel) localStorage.setItem('vibes_model', selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    localStorage.setItem('vibes_search_provider', searchProvider);
  }, [searchProvider]);

  const currentSession = sessions.find(s => s.id === currentSessionId);

  // Right-rail Sessions: from settings it returns to chat (and reveals the
  // list); within chat it just toggles the list.
  const handleToggleSessions = useCallback(() => {
    if (parseRoute(window.location.hash) === 'settings') {
      goChat();
      setSidebarOpen(true);
    } else {
      setSidebarOpen((v) => !v);
    }
  }, [goChat]);

  return (
    <MotionConfig reducedMotion="user">
    <div className="flex h-screen bg-[color:var(--color-ground)] text-[color:var(--color-ink)] bg-paper-grain">
      {/* Far-left icon rail: Sessions (top) · Settings (bottom). */}
      <LeftNav
        active={route}
        sessionsOpen={sidebarOpen}
        onToggleSessions={handleToggleSessions}
        onOpenSettings={goSettings}
      />

      {/* Session Sidebar (wider + collapsible) — chat route only; Settings is
          a full-page view, so the session list steps aside there. */}
      <AnimatePresence>
        {route === 'chat' && sidebarOpen && (
          <SessionSidebar
            sessions={sessions}
            currentSessionId={currentSessionId}
            isLoading={isLoadingSessions}
            onSessionSelect={setCurrentSessionId}
            onCreate={createSession}
            onDeleteSession={deleteSession}
            onClose={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {route === 'settings' ? (
          <SettingsPage
            models={models}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            searchProvider={searchProvider}
            onSearchProviderChange={setSearchProvider}
          />
        ) : (
          <>
            {/* Header — compact Linear-style topbar: breadcrumb on the left, a
                quiet model chip on the right. */}
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-[color:var(--color-line)] bg-[color:var(--color-ground)] px-3">
              <div className="flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSidebarOpen((v) => !v)}
                  aria-label={sidebarOpen ? 'Hide sessions' : 'Show sessions'}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[color:var(--color-ink-faint)] transition-colors hover:bg-[color:var(--color-surface)] hover:text-[color:var(--color-ink)]"
                >
                  <PanelLeft className="h-4 w-4" />
                </button>
                <span className="shrink-0 font-display text-[15px] italic leading-none text-[color:var(--color-ink)]">
                  Vibes
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-ink-faint)]" aria-hidden />
                <span className="min-w-0 truncate text-[13px] text-[color:var(--color-ink-soft)]">
                  {currentSession?.metadata?.title || 'Untitled session'}
                </span>
              </div>
            </header>

            {/* Chat Area */}
            <ChatArea
              key={currentSessionId}
              sessionId={currentSessionId}
              model={selectedModel}
              models={models}
              onModelChange={setSelectedModel}
              searchProvider={searchProvider}
              usage={currentSession?.metadata?.usage}
              onSessionUpdate={fetchSessions}
            />
          </>
        )}
      </div>
    </div>
    </MotionConfig>
  );
}
