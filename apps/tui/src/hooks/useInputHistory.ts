import { useState, useCallback, useRef } from 'react';

export interface UseInputHistoryReturn {
  history: string[];
  currentIndex: number;
  addToHistory: (input: string) => void;
  navigateUp: (currentInput: string) => string;
  navigateDown: (currentInput: string) => string;
  resetNavigation: () => void;
}

export function useInputHistory(initialHistory: string[] = []): UseInputHistoryReturn {
  const [history, setHistory] = useState<string[]>(initialHistory);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const inputBeforeNav = useRef('');

  const addToHistory = useCallback((input: string) => {
    if (!input.trim()) return;
    setHistory((prev) => [...prev, input]);
    setCurrentIndex(-1);
    inputBeforeNav.current = '';
  }, []);

  const navigateUp = useCallback((currentInput: string) => {
    if (currentIndex === -1) {
      inputBeforeNav.current = currentInput;
    }

    const newIndex = Math.min(currentIndex + 1, history.length - 1);
    setCurrentIndex(newIndex);
    return history[newIndex] || currentInput;
  }, [currentIndex, history]);

  const navigateDown = useCallback((currentInput: string) => {
    const newIndex = Math.max(currentIndex - 1, -1);
    setCurrentIndex(newIndex);
    return newIndex === -1 ? inputBeforeNav.current : history[newIndex];
  }, [currentIndex, history]);

  const resetNavigation = useCallback(() => {
    setCurrentIndex(-1);
    inputBeforeNav.current = '';
  }, []);

  return {
    history,
    currentIndex,
    addToHistory,
    navigateUp,
    navigateDown,
    resetNavigation,
  };
}
