import React, { useMemo, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  Terminal,
  CheckCircle2,
  Circle,
  Loader2,
  Send,
  User,
  Bot,
  Box,
  AlertCircle,
  Command,
  Cpu,
  Zap,
  ChevronRight
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'framer-motion';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Define specific types for our DeepAgent data parts
type DataStatusPart = { type: 'data-status'; data: { message: string; step?: number } };
type TodoUpdatePart = { type: 'data-todo_update'; data: { id: string; status: string; title?: string } };
type NotificationPart = { type: 'data-notification'; data: { message: string; level: 'info' | 'error' } };
type DeepAgentPart = DataStatusPart | TodoUpdatePart | NotificationPart | { type: 'text'; text: string };

export default function App() {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/viper/stream' }),
    messages: [
      {
        id: 'welcome',
        role: 'assistant',
        parts: [{ type: 'text', text: 'I am Viper. Ready for deep investigation. What should we look into today?' }],
      }
    ],
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  const onSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage({ text: input });
      setInput('');
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-5xl mx-auto p-6 font-sans bg-zinc-950 selection:bg-amber-500/30">
      {/* Premium Header */}
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="flex items-center justify-between mb-8 p-5 border border-zinc-800/50 rounded-2xl bg-zinc-900/30 backdrop-blur-xl shadow-2xl"
      >
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 bg-amber-500 blur-xl opacity-20 animate-pulse" />
            <div className="relative p-3 bg-zinc-900 border border-zinc-700 rounded-xl">
              <Terminal className="w-6 h-6 text-amber-500" />
            </div>
          </div>
          <div>
            <h1 className="font-bold text-2xl tracking-tight bg-gradient-to-br from-white to-zinc-500 bg-clip-text text-transparent">Viper Explorer</h1>
            <div className="flex items-center gap-2 mt-1">
              <div className={cn("w-2 h-2 rounded-full", isLoading ? "bg-amber-500 animate-ping" : "bg-emerald-500")} />
              <p className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase">{isLoading ? 'Processing...' : 'Ready for instruction'}</p>
            </div>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/50 text-[10px] font-mono text-zinc-400 flex items-center gap-2">
            <Cpu className="w-3 h-3" /> AI_SDK_V6
          </div>
          <div className="px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/50 text-[10px] font-mono text-zinc-400 flex items-center gap-2">
            <Zap className="w-3 h-3" /> STREAMING_DATA
          </div>
        </div>
      </motion.header>

      {/* Main Chat Area */}
      <main className="flex-1 overflow-y-auto space-y-8 px-4 mb-6 scroll-smooth scrollbar-hide">
        <AnimatePresence mode="popLayout">
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.3 }}
              className={cn(
                "flex flex-col gap-3 group",
                (m.role as string) === 'user' ? "items-end text-right" : "items-start text-left"
              )}
            >
              {/* Role Indicator */}
              <div className={cn(
                "flex items-center gap-3 opacity-40 group-hover:opacity-100 transition-opacity",
                (m.role as string) === 'user' ? "flex-row-reverse" : "flex-row"
              )}>
                <div className={cn(
                  "p-1.5 rounded-lg border",
                  (m.role as string) === 'user' ? "bg-zinc-800 border-zinc-700" : "bg-amber-500/10 border-amber-500/20"
                )}>
                  {(m.role as string) === 'user' ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3 text-amber-500" />}
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                  {m.role}
                </span>
              </div>

              <div
                className={cn(
                  "relative max-w-[90%] md:max-w-[75%] p-5 rounded-3xl border transition-all duration-500",
                  (m.role as string) === 'user'
                    ? "bg-zinc-100 text-zinc-950 border-white font-medium shadow-xl shadow-white/5"
                    : "bg-zinc-900/40 border-zinc-800/80 backdrop-blur-md shadow-2xl"
                )}>
                {/* AI SDK v6 Unified Parts Rendering */}
                <div className="space-y-4">
                  {m.parts ? (() => {
                    // Track todo state for deduplication and status updates
                    const todoState = new Map<string, { status: string, firstIndex: number, title?: string }>();
                    m.parts.forEach((part, idx) => {
                      const p = part as any as DeepAgentPart;
                      if (p.type === 'data-todo_update') {
                        if (!todoState.has(p.data.id)) {
                          // First time seeing this todo - store with title from data
                          todoState.set(p.data.id, {
                            status: p.data.status,
                            firstIndex: idx,
                            title: p.data.title
                          });
                        } else {
                          // Update existing todo
                          const state = todoState.get(p.data.id)!;
                          state.status = p.data.status;
                          // Keep the title if we have one
                          if (p.data.title) state.title = p.data.title;
                        }
                      }
                    });

                    return m.parts.map((part, i) => {
                      const p = part as any as DeepAgentPart;

                      if (p.type === 'text') {
                        return (
                          <div key={i} className="text-[15px] leading-relaxed whitespace-pre-wrap selection:bg-zinc-100 selection:text-zinc-900">
                            {p.text}
                          </div>
                        );
                      }

                      if (p.type === 'data-status') {
                        const isWorkingOn = p.data.message.startsWith('Working on:');
                        const isStep = p.data.message.startsWith('Step:');

                        return (
                          <motion.div
                            key={i}
                            initial={{ x: -5, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            className={cn(
                              "flex items-center gap-3 text-[11px] font-mono p-3 rounded-xl border",
                              isWorkingOn
                                ? "text-emerald-400/90 bg-emerald-500/10 border-emerald-500/20"
                                : "text-amber-500/80 bg-amber-500/5 border-amber-500/10"
                            )}
                          >
                            {isWorkingOn ? (
                              <ChevronRight className="w-3.5 h-3.5" />
                            ) : (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            )}
                            <span className="uppercase tracking-wider">
                              {p.data.step !== undefined && <span className="text-zinc-500 mr-2">[Step {p.data.step}]</span>}
                              {p.data.message}
                            </span>
                          </motion.div>
                        );
                      }

                      if (p.type === 'data-todo_update') {
                        const state = todoState.get(p.data.id);
                        if (!state || state.firstIndex !== i) return null;

                        const isComplete = state.status === 'completed';
                        const isInProgress = state.status === 'in_progress';

                        return (
                          <motion.div
                            key={i}
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            layout
                            className={cn(
                              "flex items-center gap-3 p-3 rounded-xl border group/todo transition-all duration-300",
                              isComplete
                                ? "bg-emerald-500/5 border-emerald-500/20"
                                : isInProgress
                                  ? "bg-amber-500/10 border-amber-500/30 shadow-lg shadow-amber-500/5"
                                  : "bg-zinc-800/20 border-zinc-700/20"
                            )}
                          >
                            <div className={cn(
                              "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-500",
                              isComplete ? "bg-emerald-500/20 border-emerald-500" :
                                isInProgress ? "bg-amber-500/20 border-amber-500 animate-pulse" :
                                  "bg-zinc-800 border-zinc-600"
                            )}>
                              {isComplete ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                              ) : isInProgress ? (
                                <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                              ) : (
                                <Circle className="w-4 h-4 text-zinc-500" />
                              )}
                            </div>
                            <div className="flex flex-col flex-1">
                              <span className={cn(
                                "text-xs font-medium transition-all duration-500",
                                isComplete ? "text-emerald-400/70 line-through" :
                                  isInProgress ? "text-amber-400" :
                                    "text-zinc-300"
                              )}>
                                {state.title || `Task ${p.data.id.slice(-4)}`}
                              </span>
                              <span className="text-[9px] text-zinc-600 font-mono">
                                {state.status.toUpperCase()}
                              </span>
                            </div>
                            {isComplete && (
                              <span className="text-[9px] text-emerald-500 font-mono">✓</span>
                            )}
                          </motion.div>
                        );
                      }

                      if (p.type === 'data-notification') {
                        const isError = p.data.level === 'error';
                        return (
                          <div key={i} className={cn(
                            "flex items-start gap-3 p-4 rounded-xl border",
                            isError ? "bg-red-500/5 border-red-500/10 text-red-400" : "bg-blue-500/5 border-blue-500/10 text-blue-400"
                          )}>
                            {isError ? <AlertCircle className="w-4 h-4 mt-0.5" /> : <Box className="w-4 h-4 mt-0.5" />}
                            <p className="text-[13px] font-medium leading-snug">{p.data.message}</p>
                          </div>
                        );
                      }

                      return null;
                    });
                  })() : null}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && messages.length > 0 && (messages[messages.length - 1].role as string) === 'user' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-3 text-zinc-500 text-[11px] font-mono py-4"
          >
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce" />
            </div>
            SYSTEM_ANALYSIS_IN_PROGRESS...
          </motion.div>
        )}
      </main>

      {/* Premium Input Bar */}
      <footer className="p-2 bg-transparent">
        <div className="max-w-4xl mx-auto p-2 bg-zinc-900/80 backdrop-blur-2xl border border-zinc-800 rounded-[2rem] shadow-2xl overflow-hidden">
          <form onSubmit={onSend} className="flex items-center gap-2 pl-4">
            <Command className="w-4 h-4 text-zinc-600" />
            <input
              className="flex-1 bg-transparent border-none focus:ring-0 text-sm placeholder:text-zinc-600 py-4 h-14"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Deploy Viper for investigation..."
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="group relative flex items-center justify-center w-12 h-12 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:opacity-30 text-black rounded-full transition-all duration-300 shadow-xl shadow-amber-500/10 active:scale-95 overflow-hidden"
            >
              <AnimatePresence mode="wait">
                {isLoading ? (
                  <motion.div key="loading" exit={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </motion.div>
                ) : (
                  <motion.div key="send" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
                    <Send className="w-5 h-5" />
                  </motion.div>
                )}
              </AnimatePresence>
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
}
