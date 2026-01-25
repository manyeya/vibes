import React, { useState, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { Streamdown } from 'streamdown';
import {
  CheckCircle2,
  Circle,
  Loader2,
  Send,
  User,
  Bot,
  AlertCircle,
  Terminal,
  Cpu,
  ArrowRight,
  Clock,
  Zap,
  Layers,
  X,
  ChevronDown,
  Info,
  Shield,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'framer-motion';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ============ TYPES ============
type DataStatusPart = { type: 'data-status'; data: { message: string; step?: number } };
type TaskUpdatePart = { type: 'data-task_update'; data: { id: string; status: string; title?: string } };
type TaskGraphPart = {
  type: 'data-task_graph';
  data: {
    nodes: Array<{ id: string; title: string; status: string }>;
    edges: Array<{ from: string; to: string; type: string }>;
  };
};
type NotificationPart = { type: 'data-notification'; data: { message: string; level: 'info' | 'error' } };
type DeepAgentPart = DataStatusPart | TaskUpdatePart | TaskGraphPart | NotificationPart | { type: 'text'; text: string };

type TaskStatus = 'pending' | 'blocked' | 'in_progress' | 'completed' | 'failed';

interface TaskNode {
  id: string;
  title: string;
  status: TaskStatus;
  blockedBy: string[];
  blocks: string[];
}

// ============ STATUS INDICATOR ============
const StatusIndicator = ({ status, pulse }: { status: 'ready' | 'processing'; pulse?: boolean }) => {
  return (
    <div className="flex items-center gap-2">
      <div className={cn(
        "w-1.5 h-1.5 rounded-full transition-colors duration-300",
        status === 'processing' ? "bg-cyan-400" : "bg-emerald-400"
      )}>
        {pulse && (
          <motion.div
            className="w-full h-full rounded-full bg-cyan-400"
            animate={{ scale: [1, 2, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        )}
      </div>
      <span className="text-[10px] font-mono tracking-widest uppercase text-zinc-500">
        {status === 'processing' ? 'Processing' : 'Ready'}
      </span>
    </div>
  );
};

// ============ TASK BADGE ============
const TaskBadge = ({ status, compact = false }: { status: TaskStatus; compact?: boolean }) => {
  const config = {
    completed: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', icon: CheckCircle2 },
    in_progress: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', text: 'text-cyan-400', icon: Loader2 },
    blocked: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400', icon: AlertCircle },
    failed: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400', icon: X },
    pending: { bg: 'bg-zinc-800/50', border: 'border-zinc-700/50', text: 'text-zinc-400', icon: Circle },
  };

  const { bg, border, text, icon: Icon } = config[status] || config.pending;

  if (compact) {
    return (
      <div className={cn("w-5 h-5 rounded-md border flex items-center justify-center", bg, border)}>
        <Icon className={cn("w-3 h-3", text, status === 'in_progress' && 'animate-spin')} />
      </div>
    );
  }

  return (
    <div className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-mono uppercase", bg, border, text)}>
      <Icon className={cn("w-3 h-3", status === 'in_progress' && 'animate-spin')} />
      <span>{status.replace('_', ' ')}</span>
    </div>
  );
};

// ============ TASK FLOW ============
const TaskFlow = ({ nodes }: { nodes: TaskNode[] }) => {
  const completedCount = nodes.filter(n => n.status === 'completed').length;
  const progress = nodes.length > 0 ? completedCount / nodes.length : 0;

  return (
    <div className="bg-zinc-900/80 rounded-2xl border border-zinc-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-zinc-400" />
          <span className="text-xs font-mono text-zinc-400">Task Flow</span>
        </div>
        <span className="text-[10px] font-mono text-zinc-500">
          {completedCount}/{nodes.length} complete
        </span>
      </div>

      <div className="p-4">
        <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden mb-4">
          <motion.div
            className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500"
            initial={{ width: 0 }}
            animate={{ width: `${progress * 100}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {nodes.map((node, i) => (
            <motion.div
              key={node.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className={cn(
                "flex items-center gap-3 p-3 rounded-xl border transition-all duration-300",
                node.status === 'completed' ? "bg-emerald-500/5 border-emerald-500/10" :
                node.status === 'in_progress' ? "bg-cyan-500/10 border-cyan-500/20" :
                node.status === 'blocked' ? "bg-red-500/5 border-red-500/10" :
                "bg-zinc-800/30 border-zinc-800"
              )}
            >
              <TaskBadge status={node.status} compact />
              <span className={cn(
                "text-xs font-medium flex-1 truncate",
                node.status === 'completed' ? "text-zinc-500 line-through" :
                node.status === 'in_progress' ? "text-cyan-300" :
                node.status === 'blocked' ? "text-red-400" :
                "text-zinc-300"
              )}>
                {node.title || node.id.slice(-8)}
              </span>
              {node.status === 'in_progress' && (
                <motion.div
                  className="w-1.5 h-1.5 bg-cyan-400 rounded-full"
                  animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============ STATUS PILL ============
const StatusPill = ({ message, step, type = 'default' }: { message: string; step?: number; type?: 'working' | 'delegating' | 'default' }) => {
  const config = {
    working: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', icon: Terminal },
    delegating: { bg: 'bg-violet-500/10', border: 'border-violet-500/20', text: 'text-violet-400', icon: ArrowRight },
    default: { bg: 'bg-zinc-800/50', border: 'border-zinc-700/50', text: 'text-zinc-400', icon: Clock },
  };

  const { bg, border, text, icon: Icon } = config[type];

  return (
    <div className={cn("inline-flex items-center gap-2 px-3 py-2 rounded-xl border", bg, border)}>
      <Icon className={cn("w-3.5 h-3.5", text)} />
      {step !== undefined && <span className="text-[10px] font-mono text-zinc-500">Step {step}</span>}
      <span className={cn("text-xs font-medium", text)}>{message}</span>
    </div>
  );
};

// ============ APPROVAL CARD ============
interface ApprovalCardProps {
  toolName: string;
  args: any;
  approvalId: string;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}

const ApprovalCard = ({ toolName, args, approvalId, onApprove, onDeny }: ApprovalCardProps) => {
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'y' || e.key === 'Y') {
        onApprove(approvalId);
      } else if (e.key === 'n' || e.key === 'N') {
        onDeny(approvalId);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [approvalId, onApprove, onDeny]);

  const formatJson = (obj: any): string => {
    return JSON.stringify(obj, null, 2);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-950/30 to-orange-950/20 shadow-lg shadow-amber-500/5"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-amber-500/5 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-amber-400 rounded-full border-2 border-[#09090b]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Approval Required</h3>
            <p className="text-[10px] font-mono text-amber-400/70 uppercase tracking-wider">
              Agent requests permission to execute
            </p>
          </div>
        </div>
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-zinc-500"
        >
          <ChevronDown className="w-4 h-4" />
        </motion.div>
      </div>

      {/* Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              {/* Tool Info */}
              <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900/50 rounded-xl border border-zinc-800">
                <Cpu className="w-4 h-4 text-amber-400" />
                <span className="text-[11px] font-mono text-zinc-400">tool:</span>
                <span className="text-xs font-mono text-white">{toolName}</span>
              </div>

              {/* Arguments */}
              <div className="bg-[#0a0a0b] rounded-xl border border-zinc-800 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-zinc-900/50 border-b border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Arguments</span>
                  </div>
                  <span className="text-[9px] font-mono text-zinc-600">JSON</span>
                </div>
                <pre className="p-4 text-xs text-zinc-300 font-mono overflow-x-auto whitespace-pre-wrap break-all">
                  {formatJson(args)}
                </pre>
              </div>

              {/* Keyboard Shortcuts Hint */}
              <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900/30 rounded-lg border border-zinc-800/50">
                <Info className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-[10px] text-zinc-500">
                  Press <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-[9px] font-mono text-zinc-400">Y</kbd> to approve or <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-[9px] font-mono text-zinc-400">N</kbd> to deny
                </span>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={() => onDeny(approvalId)}
                  className="group relative flex items-center justify-center gap-2 px-4 py-3 bg-zinc-900 border border-zinc-700 hover:border-red-500/50 rounded-xl transition-all duration-200"
                >
                  <X className="w-4 h-4 text-zinc-400 group-hover:text-red-400 transition-colors" />
                  <span className="text-xs font-semibold text-zinc-400 group-hover:text-red-400 transition-colors">Deny</span>
                  <span className="absolute top-2 right-2 text-[9px] font-mono text-zinc-600 group-hover:text-red-400/50 transition-colors">N</span>
                </button>
                <button
                  onClick={() => onApprove(approvalId)}
                  className="group relative flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 rounded-xl transition-all duration-200 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30"
                >
                  <CheckCircle2 className="w-4 h-4 text-black" />
                  <span className="text-xs font-semibold text-black">Approve</span>
                  <span className="absolute top-2 right-2 text-[9px] font-mono text-black/40">Y</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ============ MAIN APP ============
export default function App() {
  const [input, setInput] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const { messages, sendMessage, status, addToolApprovalResponse } = useChat({
    transport: new DefaultChatTransport({ api: '/api/mimo-code/stream' }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    messages: [
      {
        id: 'welcome',
        role: 'assistant',
        parts: [{ type: 'text', text: 'I\'m **Vibes** — an intelligent agent system that coordinates tasks across specialized sub-agents.\n\nI can manage complex workflows with dependencies, delegate to specialized agents, and provide real-time progress updates.\n\nWhat would you like me to help you build?' }],
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
    <div className="flex flex-col h-screen bg-[#09090b] text-zinc-100 font-sans selection:bg-cyan-500/30 selection:text-cyan-100">

      {/* ============ HEADER ============ */}
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/50 bg-zinc-950/50 backdrop-blur-sm"
      >
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center shadow-lg shadow-cyan-500/10">
              <Zap className="w-5 h-5 text-white" />
            </div>
            {isLoading && (
              <motion.div
                className="absolute inset-0 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500"
                animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0, 0.3] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            )}
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">Vibes</h1>
            <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Agent System</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <StatusIndicator status={isLoading ? 'processing' : 'ready'} pulse={isLoading} />
        </div>
      </motion.header>

      {/* ============ MAIN CONTENT ============ */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-8">
          <AnimatePresence mode="popLayout">
            {messages.map((message) => {
              const isUser = (message.role as string) === 'user';

              // Hide empty assistant messages that haven't received any content yet
              const isEmptyAssistant = !isUser && (!message.parts || message.parts.length === 0);
              if (isEmptyAssistant) {
                return null;
              }

              return (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  className={cn("mb-8", isUser && "flex justify-end")}
                >
                  <div className={cn(
                    "flex gap-4 max-w-full",
                    isUser && "flex-row-reverse"
                  )}>
                    {/* Avatar */}
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-1",
                      isUser ? "bg-zinc-800" : "bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/20"
                    )}>
                      {isUser ? (
                        <User className="w-4 h-4 text-zinc-400" />
                      ) : (
                        <Bot className="w-4 h-4 text-cyan-400" />
                      )}
                    </div>

                    {/* Content */}
                    <div className={cn(
                      "flex-1 space-y-4",
                      isUser && "flex flex-col items-end"
                    )}>
                      {/* Text content */}
                      {message.parts?.filter((p: any) => p.type === 'text').map((part: any, i: number) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.03 }}
                          className={cn(
                            "rounded-2xl px-4 py-3 text-sm leading-relaxed streamdown",
                            isUser
                              ? "bg-cyan-500 text-white [&_a]:underline [&_a]:text-white/80 [&_code]:bg-white/20 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_pre]:bg-white/10 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto"
                              : "bg-zinc-900 border border-zinc-800 text-zinc-200"
                          )}
                        >
                          <Streamdown>{part.text}</Streamdown>
                        </motion.div>
                      ))}

                      {/* Status updates */}
                      {message.parts?.filter((p: any) => p.type === 'data-status').map((part: any, i: number) => {
                        const p = part as DeepAgentPart;
                        if (p.type !== 'data-status') return null;

                        const isWorkingOn = p.data.message.includes('Working on');
                        const isDelegating = p.data.message.includes('Delegating');

                        return (
                          <StatusPill
                            key={i}
                            message={p.data.message}
                            step={p.data.step}
                            type={isWorkingOn ? 'working' : isDelegating ? 'delegating' : 'default'}
                          />
                        );
                      })}

                      {/* Task graph */}
                      {(() => {
                        const taskGraphPart = message.parts?.find((p: any) => p.type === 'data-task_graph') as any;
                        if (taskGraphPart) {
                          const nodes = taskGraphPart.data.nodes.map((n: any) => ({
                            ...n,
                            status: n.status,
                            blockedBy: [],
                            blocks: []
                          }));
                          return <TaskFlow key="graph" nodes={nodes} />;
                        }
                        return null;
                      })()}

                      {/* Tool approvals */}
                      {(() => {
                        // Track seen toolCallIds to avoid duplicate approval cards
                        const seenToolCalls = new Set<string>();
                        return message.parts?.filter((p: any) => {
                          // Only show parts that need approval and haven't been seen yet
                          const needsApproval = p.state === 'call' || p.state === 'approval-requested' || p.state === 'input-available';
                          const isDuplicate = p.toolCallId && seenToolCalls.has(p.toolCallId);
                          if (p.toolCallId) seenToolCalls.add(p.toolCallId);
                          return needsApproval && !isDuplicate && p.approval?.id;
                        }).map((invocation: any) => {
                          // Extract tool name - handle both static and dynamic tools
                          const toolName = invocation.toolName || invocation.name;
                          // Extract args - might be args, input, or need to be constructed
                          const args = invocation.args || invocation.input;

                          return (
                            <ApprovalCard
                              key={invocation.toolCallId}
                              toolName={toolName || 'Unknown Tool'}
                              args={args || {}}
                              approvalId={invocation.approval?.id}
                              onApprove={(id) => addToolApprovalResponse({ id, approved: true, reason: 'Approved' })}
                              onDeny={(id) => addToolApprovalResponse({ id, approved: false, reason: 'user denied' })}
                            />
                          );
                        });
                      })()}

                      {/* Tool results */}
                      {message.parts?.filter((p: any) => p.state === 'result').map((invocation: any) => (
                        <motion.div
                          key={invocation.toolCallId}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="flex items-center gap-3 px-4 py-3 bg-emerald-500/5 rounded-xl border border-emerald-500/10"
                        >
                          <div className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          </div>
                          <div className="flex-1">
                            <span className="text-xs font-mono text-zinc-400">
                              <span className="text-emerald-400">{invocation.toolName}</span>
                            </span>
                            <span className="text-[10px] text-zinc-500 ml-2">executed successfully</span>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Loading indicator */}
          {isLoading && messages.length > 0 && (messages[messages.length - 1].role as string) === 'user' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-4 py-4"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/20 flex items-center justify-center">
                <Bot className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="flex items-center gap-2">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-2 h-2 bg-cyan-400 rounded-full"
                    animate={{ scale: [1, 1.3, 1], opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </main>

      {/* ============ INPUT AREA ============ */}
      <footer className="border-t border-zinc-800/50 bg-zinc-950/50 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto p-4">
          <form onSubmit={onSend} className="relative">
            <div className={cn(
              "flex items-end gap-3 bg-zinc-900 rounded-2xl border p-2 transition-all",
              isInputFocused ? "border-cyan-500/50" : "border-zinc-800"
            )}>
              <textarea
                className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-zinc-600 resize-none px-3 py-2 max-h-32"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                placeholder="Describe what you want to build..."
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onSend(e);
                  }
                }}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200",
                  (isLoading || !input.trim())
                    ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                    : "bg-cyan-500 text-white hover:bg-cyan-400 shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30"
                )}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
            <p className="text-[10px] text-zinc-600 font-mono text-center mt-3">
              Press Enter to send · Shift+Enter for new line
            </p>
          </form>
        </div>
      </footer>
    </div>
  );
}
