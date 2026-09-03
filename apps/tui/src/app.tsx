import { MouseButton } from '@opentui/core';
import { useKeyboard, useRenderer, useSelectionHandler } from '@opentui/react';
import { useEffect, useRef, useState } from 'react';
import { createSession, getModels, getSessionGit, health, type GitInfo, type SessionInfo } from './api';
import { parseCommand, type AppAction } from './commands';
import { loadPref, savePref } from './config';
import { ContextMenu, type MenuItem } from './components/context-menu';
import { HelpDialog } from './components/help-dialog';
import { ModelDialog } from './components/model-dialog';
import { SessionDialog } from './components/session-dialog';
import { ThemeDialog } from './components/theme-dialog';
import { Home } from './screens/home';
import { Session } from './screens/session';
import { nextMode } from './modes';
import { theme, useTheme } from './theme';

type Route = { name: 'home' } | { name: 'session'; session: SessionInfo; initialText?: string };
type Dialog = 'sessions' | 'models' | 'themes' | 'help' | null;

export function App() {
  const renderer = useRenderer();
  useTheme(); // repaint the whole tree when the active theme changes
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [connected, setConnected] = useState(false);
  const [model, setModel] = useState<string>();
  // Execution mode (plan/manual/auto-edit/auto). Sent with each turn; the agent
  // may switch it mid-run (data-mode), which flows back here via onModeChange.
  const [mode, setMode] = useState('auto');
  // The project IS the directory (Claude Code's model): no workspace object.
  const [cwd, setCwd] = useState<string>();
  const [git, setGit] = useState<GitInfo | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menu, setMenu] = useState<{ variant: 'popup' | 'palette'; x?: number; y?: number } | null>(null);
  const [mouseOn, setMouseOn] = useState(true);
  const creating = useRef(false);
  // Model ids for shift+←/→ cycling (read live in the key handler).
  const modelsRef = useRef<string[]>([]);

  // Select-to-copy: with mouse capture on, drag-selection is ours to handle, so
  // copy whatever the user selects straight to the system clipboard (OSC 52 —
  // works locally and over SSH). This is what makes copying feel normal again.
  useSelectionHandler((selection) => {
    const text = selection.getSelectedText();
    if (text) renderer.copyToClipboardOSC52(text);
  });

  // Mouse capture steals the terminal's native drag-to-select. Keep it on for
  // clicks/menus, but let the user flip it off (Ctrl+P → Toggle mouse) to fall
  // back to native selection if their terminal doesn't honor OSC 52.
  useEffect(() => {
    renderer.useMouse = mouseOn;
  }, [mouseOn, renderer]);

  useEffect(() => {
    const check = () => void health().then(setConnected);
    check();
    const timer = setInterval(check, 10_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    getModels()
      .then(({ active, models }) => {
        modelsRef.current = models.map((m) => m.id);
        // Prefer a persisted pick (if it's still a valid model), else the
        // server default — so a chosen model survives reloads.
        const saved = loadPref('model');
        setModel(saved && models.some((m) => m.id === saved) ? saved : active);
      })
      .catch(() => setModel(loadPref('model')));
  }, []);

  // Persist the selected model so it survives reloads and session switches.
  useEffect(() => {
    if (model) savePref('model', model);
  }, [model]);

  // The directory is the project — there is no workspace to pick. The `vibes`
  // CLI sets VIBES_PROJECT_DIR to the repo it was launched in; otherwise we use
  // the process cwd, exactly like running `claude` in a folder.
  useEffect(() => {
    setCwd((c) => c ?? (process.env.VIBES_PROJECT_DIR || process.cwd()));
  }, []);

  // Track the project's git branch + dirty state for the status bar. Poll so
  // the dirty flag reflects edits the agent makes as it works.
  // Scoped to the active session: git status is read from that session's
  // project dir, so there is nothing to show on the home screen.
  const activeSessionId = route.name === 'session' ? route.session.id : undefined;
  useEffect(() => {
    if (!activeSessionId) {
      setGit(null);
      return;
    }
    const refresh = () => void getSessionGit(activeSessionId).then(setGit).catch(() => setGit(null));
    refresh();
    const timer = setInterval(refresh, 5_000);
    return () => clearInterval(timer);
  }, [activeSessionId]);

  useKeyboard((key) => {
    if (key.ctrl && key.name === 'c') {
      renderer.destroy();
      process.exit(0);
    }
    if (key.ctrl && key.name === 'l') setDialog('sessions');
    if (key.ctrl && key.name === 'o') setDialog('models');
    if (key.ctrl && key.name === 'g') setDialog('themes');
    // shift+tab cycles execution mode (Claude Code muscle memory).
    if (key.shift && key.name === 'tab') setMode((m) => nextMode(m));
    // shift+←/→ cycles the model.
    if (key.shift && (key.name === 'left' || key.name === 'right')) {
      const ids = modelsRef.current;
      if (ids.length) {
        const dir = key.name === 'right' ? 1 : -1;
        setModel((cur) => {
          const i = ids.indexOf(cur ?? '');
          return ids[(((i < 0 ? 0 : i) + dir) % ids.length + ids.length) % ids.length];
        });
      }
    }
    // ctrl+p opens the centered command palette (also the keyboard fallback for
    // terminals that grab right-click for their own context menu).
    if (key.ctrl && key.name === 'p') setMenu((m) => (m ? null : { variant: 'palette' }));
    if (key.name === 'f1') setDialog('help');
    if (key.ctrl && key.name === 'n') {
      setDialog(null);
      setRoute({ name: 'home' });
    }
  });

  const runAppAction = (action: AppAction) => {
    if (action === 'new') {
      setDialog(null);
      setRoute({ name: 'home' });
      return;
    }
    // 'rewind' and 'artifacts' are session-scoped — the Session screen owns
    // them, because they need the thread's messages.
    if (action === 'rewind') return;
    setDialog(action);
  };

  const menuItems: MenuItem[] = [
    { label: 'New session', hint: 'ctrl+n', description: 'Start a fresh session in this directory', onSelect: () => runAppAction('new') },
    { label: 'Sessions', hint: 'ctrl+l', description: 'Browse and switch between sessions', onSelect: () => runAppAction('sessions') },
    { label: 'Model', hint: 'ctrl+o', description: 'Switch the language model', onSelect: () => runAppAction('models') },
    { label: `Mode: ${mode}`, hint: 'shift+tab', description: 'Cycle plan → manual → auto-edit → auto', onSelect: () => setMode((m) => nextMode(m)) },
    { label: 'Theme', hint: 'ctrl+g', description: 'Switch the color theme (Bearded family)', onSelect: () => runAppAction('themes') },
    {
      label: mouseOn ? 'Disable mouse' : 'Enable mouse',
      description: mouseOn ? 'Turn off mouse capture to use native terminal copy' : 'Turn on mouse for clicks and menus',
      onSelect: () => setMouseOn((v) => !v),
    },
    { label: 'Help', hint: 'f1', description: 'Keybindings and commands', onSelect: () => runAppAction('help') },
  ];

  const startSession = (text: string) => {
    const cmd = parseCommand(text);
    if (cmd) {
      // Unknown commands and /artifacts (session-only) are ignored on Home
      // rather than creating a junk session.
      if (cmd !== 'unknown' && cmd.action !== 'artifacts') runAppAction(cmd.action);
      return;
    }
    if (creating.current) return;
    creating.current = true;
    createSession({ cwd: cwd ?? undefined })
      .then((id) => setRoute({ name: 'session', session: { id, cwd: cwd ?? undefined }, initialText: text }))
      .catch(() => {})
      .finally(() => {
        creating.current = false;
      });
  };

  return (
    <box
      flexGrow={1}
      backgroundColor={theme.background}
      onMouseDown={(e) => {
        if (e.button === MouseButton.RIGHT) {
          e.preventDefault();
          setMenu({ variant: 'popup', x: e.x, y: e.y });
        }
      }}
    >
      {route.name === 'home' ? (
        <Home
          connected={connected}
          model={model}
          mode={mode}
          cwd={cwd}
          git={git}
          focused={dialog === null && menu === null}
          onSubmit={startSession}
        />
      ) : (
        <Session
          key={route.session.id}
          session={route.session}
          initialText={route.initialText}
          active={dialog === null && menu === null}
          connected={connected}
          model={model}
          mode={mode}
          onModeChange={setMode}
          cwd={cwd}
          git={git}
          onAppAction={runAppAction}
        />
      )}
      {dialog === 'sessions' ? (
        <SessionDialog
          currentId={route.name === 'session' ? route.session.id : undefined}
          cwd={cwd}
          onSelect={(session) => {
            setDialog(null);
            setRoute({ name: 'session', session });
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {menu ? (
        <ContextMenu
          items={menuItems}
          variant={menu.variant}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {dialog === 'help' ? <HelpDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'models' ? (
        <ModelDialog
          currentId={model}
          onSelect={(id) => {
            setDialog(null);
            setModel(id);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'themes' ? <ThemeDialog onClose={() => setDialog(null)} /> : null}
    </box>
  );
}
