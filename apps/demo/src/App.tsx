import React, { useState, useEffect, useCallback } from 'react';
import { MotionConfig, AnimatePresence } from 'framer-motion';
import { PanelLeft, ChevronRight, Plus, Boxes } from 'lucide-react';
import { SessionSidebar } from './components/chat/SessionSidebar';
import { FolderPicker } from './components/chat/FolderPicker';
import { ChatArea } from './components/chat/ChatArea';
import { LeftNav } from './components/LeftNav';
import { SettingsPage, type SearchProviderId } from './components/SettingsPage';
import { PromptsPage } from './components/PromptsPage';
import { WorkspacesPage } from './components/WorkspacesPage';
import type { ModelOption } from './components/chat/ModelSelector';
import type { Session } from './components/chat/session-types';
import type { Workspace } from './components/chat/workspace-types';

type Route = 'chat' | 'settings' | 'prompts' | 'workspaces';

const parseRoute = (hash: string): Route => {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'settings') return 'settings';
  if (path === 'prompts') return 'prompts';
  if (path === 'workspaces') return 'workspaces';
  return 'chat';
};

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

  // Workspaces (projects) — each groups sessions sharing one project dir.
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string>(() => {
    return localStorage.getItem('vibes_workspace_id') || 'default';
  });
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(() => localStorage.getItem('vibes_model') || '');
  const [searchProvider, setSearchProvider] = useState<SearchProviderId>(
    () => (localStorage.getItem('vibes_search_provider') as SearchProviderId) || 'auto',
  );

  // Hash-based routing for top-level views — a real URL (#/settings) without
  // pulling in a router dependency.
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const goSettings = useCallback(() => { window.location.hash = '#/settings'; }, []);
  const goPrompts = useCallback(() => { window.location.hash = '#/prompts'; }, []);
  const goWorkspaces = useCallback(() => { window.location.hash = '#/workspaces'; }, []);
  const goChat = useCallback(() => { window.location.hash = '#/'; }, []);

  // ── Sessions (scoped to the active workspace) ──────────────────────────
  const fetchSessions = useCallback(async (workspaceId: string = currentWorkspaceId): Promise<Session[]> => {
    setIsLoadingSessions(true);
    try {
      const res = await fetch(`/api/sessions?workspace_id=${encodeURIComponent(workspaceId)}`);
      const data = await res.json();
      if (data.success) {
        setSessions(data.sessions);
        return data.sessions as Session[];
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setIsLoadingSessions(false);
    }
    return [];
  }, [currentWorkspaceId]);

  const createSession = useCallback(async (title?: string) => {
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: currentWorkspaceId, ...(title ? { title } : {}) }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchSessions();
        setCurrentSessionId(data.sessionId);
      }
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }, [fetchSessions, currentWorkspaceId]);

  const deleteSession = useCallback(async (sessionId: string) => {
    if (sessionId === 'default') return;
    try {
      await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      const list = await fetchSessions();
      if (currentSessionId === sessionId) {
        setCurrentSessionId(list[0]?.id ?? '');
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }, [currentSessionId, fetchSessions]);

  // ── Workspaces ─────────────────────────────────────────────────────────
  const fetchWorkspaces = useCallback(async (): Promise<Workspace[]> => {
    setIsLoadingWorkspaces(true);
    try {
      const res = await fetch('/api/workspaces');
      const data = await res.json();
      if (data.success) {
        setWorkspaces(data.workspaces);
        return data.workspaces as Workspace[];
      }
    } catch (err) {
      console.error('Failed to fetch workspaces:', err);
    } finally {
      setIsLoadingWorkspaces(false);
    }
    return [];
  }, []);

  const createWorkspace = useCallback(async (name: string) => {
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchWorkspaces();
        setCurrentWorkspaceId(data.workspace.id);
        setCurrentSessionId(''); // fresh workspace → no session yet (effect resolves)
        goChat();
      }
    } catch (err) {
      console.error('Failed to create workspace:', err);
    }
  }, [fetchWorkspaces, goChat]);

  const openFolder = useCallback(async (rootDir: string) => {
    const dir = rootDir.trim();
    if (!dir) return;
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootDir: dir }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchWorkspaces();
        setCurrentWorkspaceId(data.workspace.id);
        setCurrentSessionId('');
        goChat();
      } else {
        window.alert(data.error || 'Could not open that folder. Check the path exists on the server.');
      }
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  }, [fetchWorkspaces, goChat]);

  const renameWorkspace = useCallback(async (id: string, name: string) => {
    try {
      await fetch(`/api/workspaces/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      await fetchWorkspaces();
    } catch (err) {
      console.error('Failed to rename workspace:', err);
    }
  }, [fetchWorkspaces]);

  const deleteWorkspace = useCallback(async (id: string) => {
    if (id === 'default') return;
    if (!window.confirm('Delete this workspace and all of its sessions? This cannot be undone.')) return;
    try {
      await fetch(`/api/workspaces/${id}`, { method: 'DELETE' });
      await fetchWorkspaces();
      if (currentWorkspaceId === id) setCurrentWorkspaceId('default');
    } catch (err) {
      console.error('Failed to delete workspace:', err);
    }
  }, [fetchWorkspaces, currentWorkspaceId]);

  const openWorkspace = useCallback((id: string) => {
    setCurrentWorkspaceId(id);
    goChat();
  }, [goChat]);

  useEffect(() => {
    localStorage.setItem('vibes_session_id', currentSessionId);
  }, [currentSessionId]);

  useEffect(() => {
    localStorage.setItem('vibes_sidebar_open', sidebarOpen ? '1' : '0');
  }, [sidebarOpen]);

  useEffect(() => {
    localStorage.setItem('vibes_workspace_id', currentWorkspaceId);
  }, [currentWorkspaceId]);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  // When the active workspace changes, load its sessions and resolve a valid
  // current session (keep the current one if it belongs here, else the most
  // recent, else none → empty state).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await fetchSessions(currentWorkspaceId);
      if (cancelled) return;
      setCurrentSessionId((prev) => (list.some((s) => s.id === prev) ? prev : list[0]?.id ?? ''));
    })();
    return () => { cancelled = true; };
  }, [currentWorkspaceId, fetchSessions]);

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
  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId);

  // Right-rail Sessions: from another view it returns to chat (and reveals the
  // list); within chat it just toggles the list.
  const handleToggleSessions = useCallback(() => {
    if (parseRoute(window.location.hash) !== 'chat') {
      goChat();
      setSidebarOpen(true);
    } else {
      setSidebarOpen((v) => !v);
    }
  }, [goChat]);

  return (
    <MotionConfig reducedMotion="user">
    <div className="flex h-screen bg-[color:var(--color-ground)] text-[color:var(--color-ink)] bg-paper-grain">
      {/* Far-left icon rail: Sessions · Workspaces · Prompts · Settings. */}
      <LeftNav
        active={route}
        sessionsOpen={sidebarOpen}
        onToggleSessions={handleToggleSessions}
        onOpenWorkspaces={goWorkspaces}
        onOpenPrompts={goPrompts}
        onOpenSettings={goSettings}
      />

      {/* Session Sidebar (wider + collapsible) — chat route only; full-page
          views step the session list aside. */}
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
            workspaces={workspaces}
            currentWorkspaceId={currentWorkspaceId}
            onWorkspaceSwitch={setCurrentWorkspaceId}
            onWorkspaceCreate={createWorkspace}
            onRequestOpenFolder={() => setFolderPickerOpen(true)}
            onManageWorkspaces={goWorkspaces}
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
        ) : route === 'prompts' ? (
          <PromptsPage />
        ) : route === 'workspaces' ? (
          <WorkspacesPage
            workspaces={workspaces}
            currentWorkspaceId={currentWorkspaceId}
            isLoading={isLoadingWorkspaces}
            onOpen={openWorkspace}
            onCreate={createWorkspace}
            onOpenFolder={openFolder}
            onRequestOpenFolder={() => setFolderPickerOpen(true)}
            onRename={renameWorkspace}
            onDelete={deleteWorkspace}
            onRefresh={fetchWorkspaces}
          />
        ) : (
          <>
            {/* Header — compact Linear-style topbar: breadcrumb on the left. */}
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
                <button
                  type="button"
                  onClick={goWorkspaces}
                  title="Manage workspaces"
                  className="shrink-0 truncate text-[13px] text-[color:var(--color-ink-soft)] transition-colors hover:text-[color:var(--color-ink)]"
                >
                  {currentWorkspace?.name ?? 'Default'}
                </button>
                {currentSessionId && (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-ink-faint)]" aria-hidden />
                    <span className="min-w-0 truncate text-[13px] text-[color:var(--color-ink-soft)]">
                      {currentSession?.metadata?.title || 'Untitled session'}
                    </span>
                  </>
                )}
              </div>
            </header>

            {currentSessionId ? (
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
            ) : (
              // Empty workspace — no session selected yet.
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[rgba(244,238,228,0.05)] text-[color:var(--color-amber)]">
                  <Boxes className="h-6 w-6" strokeWidth={1.5} />
                </span>
                <h2 className="font-display text-[20px] text-[color:var(--color-ink)]">
                  {currentWorkspace?.name ?? 'This workspace'} is empty
                </h2>
                <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-[color:var(--color-ink-faint)]">
                  Sessions in this workspace share its project directory. Start one to begin.
                </p>
                <button
                  type="button"
                  onClick={() => createSession('Untitled session')}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-[color:var(--color-amber)] px-3.5 py-2 text-[13px] font-medium text-[color:var(--color-ground)] transition-opacity hover:opacity-90"
                >
                  <Plus className="h-4 w-4" /> New session
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Server-side folder chooser for the "open folder" workspace flow. */}
      <FolderPicker
        open={folderPickerOpen}
        onClose={() => setFolderPickerOpen(false)}
        onChoose={openFolder}
      />
    </div>
    </MotionConfig>
  );
}
