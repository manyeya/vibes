import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';

type Theme = 'light' | 'dark';

interface AppState {
  theme: Theme;
  isDebug: boolean;
  terminalWidth: number;
  terminalHeight: number;
}

interface AppActions {
  setTheme: (theme: Theme) => void;
  toggleDebug: () => void;
  setTerminalSize: (width: number, height: number) => void;
}

const AppStateContext = createContext<AppState | null>(null);
const AppActionsContext = createContext<AppActions | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [isDebug, setIsDebug] = useState(false);
  const [terminalSize, setTerminalSize] = useState({ width: 80, height: 24 });

  const toggleDebug = useCallback(() => {
    setIsDebug((prev) => !prev);
  }, []);

  const setTerminalSizeCallback = useCallback((width: number, height: number) => {
    setTerminalSize({ width, height });
  }, []);

  const actions = useMemo(
    () => ({
      setTheme,
      toggleDebug,
      setTerminalSize: setTerminalSizeCallback,
    }),
    [toggleDebug, setTerminalSizeCallback]
  );

  const state = useMemo(
    () => ({
      terminalWidth: terminalSize.width,
      terminalHeight: terminalSize.height,
      theme,
      isDebug,
    }),
    [terminalSize, theme, isDebug]
  );

  return (
    <AppStateContext.Provider value={state}>
      <AppActionsContext.Provider value={actions}>
        {children}
      </AppActionsContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppProvider');
  }
  return context;
}

export function useAppActions(): AppActions {
  const context = useContext(AppActionsContext);
  if (!context) {
    throw new Error('useAppActions must be used within AppProvider');
  }
  return context;
}
