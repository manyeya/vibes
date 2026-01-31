import React, { useState, useEffect, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { Streamdown } from 'streamdown';
import {
  CheckCircle2,
  Clock,
  Loader2,
  Send,
  User,
  Bot,
  Shield,
  Square,
  Brain,
  Plus,
  X,
  ChevronDown,
  MessageSquare,
  History,
  Activity,
  Database,
  Lightbulb,
  Network,
  Settings2,
  Zap,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'framer-motion';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ============ TYPES ============
interface Session {
  id: string;
  metadata?: { title?: string };
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  taskCount: number;
  fileCount: number;
}

interface Task {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'failed';
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

interface AgentStatus {
  reasoningMode: 'react' | 'tot' | 'plan-execute';
  isProcessing: boolean;
  tokenCount: number;
  tasks: Task[];
  lessonsLearned: number;
  factsStored: number;
  patternsCount: number;
}

// ============ AGENT STATUS PANEL ============
interface AgentStatusPanelProps {
  status: AgentStatus;
  isOpen: boolean;
  onToggle: () => void;
}

const AgentStatusPanel = ({ status, isOpen, onToggle }: AgentStatusPanelProps) => {
  const getModeIcon = (mode: string) => {
    switch (mode) {
      case 'tot': return '🌳';
      case 'plan-execute': return '📋';
      case 'react': return '🔄';
      default: return '🔄';
    }
  };

  const getModeLabel = (mode: string) => {
    switch (mode) {
      case 'tot': return 'Tree-of-Thoughts';
      case 'plan-execute': return 'Plan-Execute';
      case 'react': return 'ReAct';
      default: return 'ReAct';
    }
  };

  const getModeColor = (mode: string) => {
    switch (mode) {
      case 'tot': return 'text-violet-400';
      case 'plan-execute': return 'text-amber-400';
      case 'react': return 'text-cyan-400';
      default: return 'text-cyan-400';
    }
  };

  const getStatusIcon = (taskStatus: string) => {
    switch (taskStatus) {
      case 'in_progress': return '●';
      case 'completed': return '✓';
      case 'blocked': return '⊘';
      case 'failed': return '✗';
      case 'pending':
      default: return '○';
    }
  };

  const getStatusColor = (taskStatus: string) => {
    switch (taskStatus) {
      case 'in_progress': return 'text-yellow-400';
      case 'completed': return 'text-emerald-400';
      case 'blocked': return 'text-red-400';
      case 'failed': return 'text-red-400';
      case 'pending':
      default: return 'text-zinc-500';
    }
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-emerald-500';
      default: return 'bg-zinc-500';
    }
  };

  const activeTasks = status.tasks.filter(t => t.status !== 'completed' && t.status !== 'failed');
  const completedTasks = status.tasks.filter(t => t.status === 'completed');

  return (
    <div className="w-80 border-l border-zinc-800 bg-zinc-900/50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium text-zinc-200">Agent Status</span>
        </div>
        <button
          onClick={onToggle}
          className="p-1 rounded hover:bg-zinc-800 transition-colors"
        >
          <Settings2 className={cn("w-4 h-4 text-zinc-500 transition-transform", isOpen && "rotate-90")} />
        </button>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex-1 overflow-y-auto"
          >
            <div className="p-4 space-y-4">
              {/* Reasoning Mode */}
              <div className="p-3 rounded-lg bg-gradient-to-r from-cyan-500/10 to-violet-500/10 border border-cyan-500/20">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-zinc-500">Reasoning Mode</span>
                  {status.isProcessing && (
                    <span className="flex items-center gap-1 text-xs text-cyan-400">
                      <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse" />
                      Processing
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg">{getModeIcon(status.reasoningMode)}</span>
                  <span className={cn("text-sm font-medium", getModeColor(status.reasoningMode))}>
                    {getModeLabel(status.reasoningMode)}
                  </span>
                </div>
              </div>

              {/* Memory Systems */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Database className="w-3.5 h-3.5 text-violet-400" />
                  <span className="text-xs font-medium text-zinc-400">Memory Systems</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 rounded-lg bg-zinc-800/50 text-center">
                    <Lightbulb className="w-3.5 h-3.5 text-amber-400 mx-auto mb-1" />
                    <div className="text-lg font-semibold text-white">{status.lessonsLearned}</div>
                    <div className="text-[9px] text-zinc-500">Lessons</div>
                  </div>
                  <div className="p-2 rounded-lg bg-zinc-800/50 text-center">
                    <FileText className="w-3.5 h-3.5 text-blue-400 mx-auto mb-1" />
                    <div className="text-lg font-semibold text-white">{status.factsStored}</div>
                    <div className="text-[9px] text-zinc-500">Facts</div>
                  </div>
                  <div className="p-2 rounded-lg bg-zinc-800/50 text-center">
                    <Network className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1" />
                    <div className="text-lg font-semibold text-white">{status.patternsCount}</div>
                    <div className="text-[9px] text-zinc-500">Patterns</div>
                  </div>
                </div>
              </div>

              {/* Active Tasks */}
              {activeTasks.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-3.5 h-3.5 text-yellow-400" />
                    <span className="text-xs font-medium text-zinc-400">
                      Active Tasks ({activeTasks.length})
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {activeTasks.slice(0, 5).map((task) => (
                      <div key={task.id} className="flex items-center gap-2 p-2 rounded-lg bg-zinc-800/30">
                        <span className={getStatusColor(task.status)}>
                          {getStatusIcon(task.status)}
                        </span>
                        <span className={cn("text-xs truncate flex-1",
                          task.status === 'pending' ? 'text-zinc-500' : 'text-zinc-300'
                        )}>
                          {task.title.length > 28 ? task.title.slice(0, 28) + '...' : task.title}
                        </span>
                        {task.priority && (
                          <span className={cn("w-1.5 h-1.5 rounded-full", getPriorityColor(task.priority))} />
                        )}
                      </div>
                    ))}
                    {activeTasks.length > 5 && (
                      <div className="text-[10px] text-zinc-600 text-center">
                        +{activeTasks.length - 5} more
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Completed Tasks */}
              {completedTasks.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs font-medium text-zinc-400">
                      Completed ({completedTasks.length})
                    </span>
                  </div>
                  <div className="space-y-1">
                    {completedTasks.slice(-3).map((task) => (
                      <div key={task.id} className="flex items-center gap-2 p-2 rounded-lg bg-zinc-800/20">
                        <span className="text-emerald-400 text-xs">✓</span>
                        <span className="text-xs text-zinc-500 truncate">
                          {task.title.length > 30 ? task.title.slice(0, 30) + '...' : task.title}
                        </span>
                      </div>
                    ))}
                    {completedTasks.length > 3 && (
                      <div className="text-[10px] text-zinc-600 text-center">
                        +{completedTasks.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Capabilities */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-xs font-medium text-zinc-400">Capabilities</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {['Planning', 'Tree-of-Thoughts', 'Semantic Memory', 'Reflexion', 'Procedural', 'Swarm'].map((cap) => (
                    <span
                      key={cap}
                      className="px-2 py-0.5 text-[10px] rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>

              {/* Token Usage */}
              {status.tokenCount > 0 && (
                <div className="pt-2 border-t border-zinc-800">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500">Total Tokens</span>
                    <span className="text-zinc-300 font-mono">
                      {status.tokenCount.toLocaleString()}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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

  const formatJson = (obj: any, maxChars = 500): string => {
    const jsonStr = JSON.stringify(obj, null, 2);
    if (jsonStr.length <= maxChars) return jsonStr;
    return jsonStr.slice(0, maxChars) + '\n... (truncated)';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="border border-amber-500/30 rounded-xl overflow-hidden bg-gradient-to-r from-amber-950/20 to-orange-950/10"
    >
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-amber-500/5 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <Shield className="w-4 h-4 text-amber-400" />
          <div>
            <span className="text-sm font-medium text-white">Permission Required</span>
            <span className="text-xs text-zinc-500 ml-2">{toolName}</span>
          </div>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-zinc-500 transition-transform", isExpanded && "rotate-180")} />
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 space-y-3">
              <pre className="text-xs text-zinc-400 bg-zinc-900/50 p-3 rounded-lg overflow-auto max-h-48 font-mono">
                {formatJson(args)}
              </pre>
              <div className="flex gap-2">
                <button
                  onClick={() => onDeny(approvalId)}
                  className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors"
                >
                  Deny (N)
                </button>
                <button
                  onClick={() => onApprove(approvalId)}
                  className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm text-white transition-colors"
                >
                  Approve (Y)
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ============ SESSION ITEM ============
interface SessionItemProps {
  session: Session;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

const SessionItem = ({ session, isActive, onSelect, onDelete }: SessionItemProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all",
        isActive
          ? "bg-cyan-500/10 border border-cyan-500/30"
          : "hover:bg-zinc-800/50 border border-transparent"
      )}
      onClick={onSelect}
    >
      {isActive && <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-cyan-400 rounded-full" />}

      <MessageSquare className={cn("w-4 h-4 shrink-0", isActive ? "text-cyan-400" : "text-zinc-500")} />

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate text-zinc-200">
          {session.metadata?.title || 'Untitled Session'}
        </div>
        <div className="text-[10px] text-zinc-600">
          {session.messageCount} messages
        </div>
      </div>

      {session.id !== 'default' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-600 transition-all"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </motion.div>
  );
};

// ============ SESSION SIDEBAR ============
interface SessionSidebarProps {
  sessions: Session[];
  currentSessionId: string;
  isLoading: boolean;
  onSessionSelect: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onClose: () => void;
}

const SessionSidebar = ({
  sessions,
  currentSessionId,
  isLoading,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
  onClose,
}: SessionSidebarProps) => {
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />
      <aside className="fixed top-0 left-0 bottom-0 w-72 bg-zinc-900 border-r border-zinc-800 z-50 lg:static lg:z-0 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-zinc-400" />
            <h2 className="text-sm font-medium text-zinc-200">Sessions</h2>
          </div>
          <button
            onClick={onNewSession}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-zinc-600 animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-xs text-zinc-600">No sessions yet</p>
            </div>
          ) : (
            <div className="space-y-1">
              {sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === currentSessionId}
                  onSelect={() => {
                    onSessionSelect(session.id);
                    onClose();
                  }}
                  onDelete={() => onDeleteSession(session.id)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

// ============ CHAT MESSAGE ============
interface ChatMessageProps {
  message: any;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onAgentStatusUpdate?: (update: Partial<AgentStatus>) => void;
}

const ChatMessage = ({ message, onApprove, onDeny, onAgentStatusUpdate }: ChatMessageProps) => {
  const isUser = message.role === 'user';
  const parts = (message as any).parts || [];
  const isEmptyAssistant = !isUser && parts.length === 0;
  if (isEmptyAssistant) return null;

  const seenToolApprovals = new Set<string>();
  const seenToolResults = new Set<string>();

  // Process agent data parts for status updates
  useEffect(() => {
    if (!isUser && onAgentStatusUpdate) {
      parts.forEach((part: any) => {
        if (part.type === 'data') {
          const data = part;
          if (data.type === 'data-reasoning_mode') {
            onAgentStatusUpdate({ reasoningMode: data.data?.mode || data.mode || 'react' });
          } else if (data.type === 'data-status') {
            const msg = data.data?.message || data.message || '';
            if (msg.includes('Lesson saved')) {
              onAgentStatusUpdate({ lessonsLearned: 1 });
            }
            if (msg.includes('Fact remembered')) {
              onAgentStatusUpdate({ factsStored: 1 });
            }
            if (msg.includes('Pattern saved')) {
              onAgentStatusUpdate({ patternsCount: 1 });
            }
          }
        }
      });
    }
  }, [parts, isUser, onAgentStatusUpdate]);

  return (
    <div className={cn("flex gap-3 mb-6", isUser && "flex-row-reverse")}>
      <div className={cn(
        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
        isUser ? "bg-zinc-800" : "bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/20"
      )}>
        {isUser ? <User className="w-4 h-4 text-zinc-400" /> : <Bot className="w-4 h-4 text-cyan-400" />}
      </div>

      <div className={cn("flex-1 space-y-2 min-w-0", isUser && "flex flex-col items-end")}>
        {parts.map((part: any, partIndex: number) => {
          // Text content
          if (part.type === 'text') {
            return (
              <div
                key={`text-${partIndex}`}
                className={cn(
                  "rounded-xl px-4 py-2.5 text-sm streamdown",
                  isUser
                    ? "bg-cyan-500 text-white"
                    : "bg-zinc-800/50 border border-zinc-800 text-zinc-200"
                )}
              >
                <Streamdown>{part.text}</Streamdown>
              </div>
            );
          }

          // Thinking/reasoning
          if (part.type === 'reasoning' || part.type === 'thinking') {
            return (
              <details key={`reasoning-${partIndex}`} className="group">
                <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-800/50 rounded-lg transition-colors select-none text-xs">
                  <Brain className="w-3.5 h-3.5 text-violet-400" />
                  <span className="text-zinc-400">Thinking</span>
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-500 ml-auto group-open:rotate-180 transition-transform" />
                </summary>
                <div className="mt-2 px-3 py-2 bg-violet-500/5 border border-violet-500/10 rounded-lg">
                  <pre className="text-xs text-zinc-500 whitespace-pre-wrap font-mono">
                    {part.text || ''}
                  </pre>
                </div>
              </details>
            );
          }

          // Data type: Status
          if (part.type === 'data' && part.data?.type === 'data-status') {
            const data = part.data;
            return (
              <div key={`status-${partIndex}`} className="inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-800/50 rounded-lg text-xs text-zinc-400">
                <Clock className="w-3 h-3" />
                {data.data?.message || data.message || 'Working...'}
              </div>
            );
          }

          // Data type: Task Update
          if (part.type === 'data' && part.data?.type === 'data-task_update') {
            const task = part.data.data;
            const getStatusColor = (status: string) => {
              switch (status) {
                case 'completed': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
                case 'failed': return 'bg-red-500/10 text-red-400 border-red-500/20';
                case 'in_progress': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
                default: return 'bg-zinc-800/50 text-zinc-400 border-zinc-700';
              }
            };
            const getStatusIcon = (status: string) => {
              switch (status) {
                case 'completed': return <CheckCircle2 className="w-3.5 h-3.5" />;
                case 'failed': return <X className="w-3.5 h-3.5" />;
                case 'in_progress': return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
                default: return <Clock className="w-3.5 h-3.5" />;
              }
            };
            return (
              <div key={`task-${partIndex}`} className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs",
                getStatusColor(task.status)
              )}>
                {getStatusIcon(task.status)}
                <span className="font-medium">{task.title}</span>
                {task.priority && (
                  <span className="ml-auto text-[9px] uppercase px-1.5 py-0.5 rounded bg-zinc-700/50">
                    {task.priority}
                  </span>
                )}
              </div>
            );
          }

          // Data type: Tool Progress
          if (part.type === 'data' && part.data?.type === 'data-tool_progress') {
            const data = part.data;
            return (
              <div key={`progress-${partIndex}`} className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                {data.data?.toolName || data.toolName || 'Working'}...
              </div>
            );
          }

          // Data type: Summarization
          if (part.type === 'data' && part.data?.type === 'data-summarization') {
            const data = part.data;
            return (
              <div key={`summary-${partIndex}`} className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-lg text-xs text-purple-400">
                <Database className="w-3 h-3" />
                Context compressed (saved {data.data?.saved || data.saved || 0} tokens)
              </div>
            );
          }

          // Data type: Error
          if (part.type === 'data' && part.data?.type === 'data-error') {
            const data = part.data;
            return (
              <div key={`error-${partIndex}`} className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="text-sm text-red-400">
                    {data.data?.error || data.error || 'An error occurred'}
                  </span>
                </div>
              </div>
            );
          }

          // Tool approvals
          const needsApproval = part.state === 'call' || part.state === 'approval-requested' || part.state === 'input-available';
          if (needsApproval && part.toolCallId && !seenToolApprovals.has(part.toolCallId) && part.approval?.id) {
            seenToolApprovals.add(part.toolCallId);
            return (
              <ApprovalCard
                key={`approval-${part.toolCallId}`}
                toolName={part.toolName || part.name || 'Unknown Tool'}
                args={part.args || part.input || {}}
                approvalId={part.approval.id}
                onApprove={onApprove}
                onDeny={onDeny}
              />
            );
          }

          // Tool results
          const isToolPart = part.type?.startsWith('tool-') || part.type === 'dynamic-tool';
          const isComplete = ['output-available', 'output-error', 'output-denied'].includes(part.state);
          if (isToolPart && isComplete && part.toolCallId && !seenToolResults.has(part.toolCallId)) {
            seenToolResults.add(part.toolCallId);
            const isError = part.state === 'output-error' || part.state === 'output-denied';

            return (
              <div
                key={`result-${part.toolCallId}`}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs",
                  isError
                    ? "bg-red-500/10 border-red-500/20 text-red-400"
                    : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                )}
              >
                {isError ? <X className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                <span className="font-mono">{part.toolName || part.name}</span>
              </div>
            );
          }

          return null;
        })}

        {!isUser && (message as any).usage && (
          <div className="text-[9px] text-zinc-600 font-mono">
            {(message as any).usage.promptTokens + (message as any).usage.completionTokens} tokens
          </div>
        )}
      </div>
    </div>
  );
};

// ============ MAIN CHAT AREA ============
interface ChatAreaProps {
  sessionId: string;
  onSessionUpdate: () => void;
  onAgentStatusUpdate: (update: Partial<AgentStatus>) => void;
  agentStatus: AgentStatus;
}

const ChatArea = ({ sessionId, onSessionUpdate, onAgentStatusUpdate, agentStatus }: ChatAreaProps) => {
  const [input, setInput] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  const { messages, sendMessage, status, addToolApprovalResponse, error, stop, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/mimo-code/stream',
      headers: { 'Content-Type': 'application/json' },
      body: { session_id: sessionId },
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  console.log(messages)

  // Load session history
  useEffect(() => {
    const fetchHistory = async () => {
      setIsLoadingHistory(true);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/messages`);
        const data = await res.json();
        if (data.success && data.messages?.length > 0) {
          setMessages(data.messages.map((msg: any) => ({
            id: msg.id,
            role: msg.role,
            parts: msg.parts || [],
          })));
        }
      } catch (err) {
        console.error('Failed to fetch history:', err);
      } finally {
        setIsLoadingHistory(false);
      }
    };
    fetchHistory();
  }, [sessionId, setMessages]);

  // Update session list when messages change
  useEffect(() => {
    if (!isLoadingHistory && status !== 'streaming') {
      onSessionUpdate();
    }
  }, [messages, status, isLoadingHistory, onSessionUpdate]);

  // Track agent state from messages
  useEffect(() => {
    let tokenCount = 0;
    const tasks: Task[] = [];
    let reasoningMode: AgentStatus['reasoningMode'] = 'react';
    let lessonsLearned = 0;
    let factsStored = 0;
    let patternsCount = 0;

    messages.forEach((msg: any) => {
      if (msg.role === 'assistant') {
        msg.parts?.forEach((part: any) => {
          if (part.type === 'data') {
            const data = part;
            if (data.type === 'data-reasoning_mode') {
              reasoningMode = data.data?.mode || data.mode || 'react';
            } else if (data.type === 'data-task_update') {
              const task = data.data;
              const exists = tasks.find(t => t.id === task.id);
              if (exists) {
                Object.assign(exists, task);
              } else {
                tasks.push(task as Task);
              }
            } else if (data.type === 'data-status') {
              const msg = data.data?.message || data.message || '';
              if (msg.includes('Lesson saved')) lessonsLearned++;
              if (msg.includes('Fact remembered')) factsStored++;
              if (msg.includes('Pattern saved')) patternsCount++;
            }
          }
        });
      }

      // Count tokens
      const usage = (msg as any).usage;
      if (usage) {
        tokenCount += usage.promptTokens + usage.completionTokens;
      }
    });

    onAgentStatusUpdate({
      reasoningMode,
      tokenCount,
      tasks,
      isProcessing: status === 'streaming',
    });
  }, [messages, status, onAgentStatusUpdate]);

  const isLoading = status === 'streaming' || status === 'submitted' || isLoadingHistory;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage({ text: input });
      setInput('');
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {isLoadingHistory ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-5 h-5 text-zinc-600 animate-spin mr-2" />
              <span className="text-sm text-zinc-500">Loading...</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/20 flex items-center justify-center mb-4">
                <Bot className="w-6 h-6 text-cyan-400" />
              </div>
              <h2 className="text-lg font-medium text-white mb-1">Vibes</h2>
              <p className="text-sm text-zinc-500">Your Deep Agent assistant</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {['Planning', 'Tree-of-Thoughts', 'Memory', 'Reflexion', 'Swarm'].map((cap) => (
                  <span key={cap} className="px-2 py-1 text-[10px] rounded-full bg-zinc-800 text-zinc-500">
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  onApprove={(id) => addToolApprovalResponse({ id, approved: true, reason: 'Approved' })}
                  onDeny={(id) => addToolApprovalResponse({ id, approved: false, reason: 'user denied' })}
                  onAgentStatusUpdate={onAgentStatusUpdate}
                />
              ))}
            </AnimatePresence>
          )}

          {/* Loading indicator */}
          {isLoading && !isLoadingHistory && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
            <div className="flex items-center gap-3 py-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/20 flex items-center justify-center">
                <Bot className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="flex items-center gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 bg-cyan-400 rounded-full"
                    animate={{ scale: [1, 1.3, 1], opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 rounded-lg border border-red-500/20 bg-red-500/5 text-sm text-red-400">
              {error.message || 'An error occurred'}
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-zinc-800 bg-zinc-950/50 p-4">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
          <div className={cn(
            "flex items-end gap-2 bg-zinc-900 rounded-xl border p-2 transition-colors",
            document.activeElement?.tagName === 'TEXTAREA' ? "border-cyan-500/50" : "border-zinc-800"
          )}>
            <textarea
              className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-zinc-600 resize-none px-3 py-2 max-h-32 min-h-[40px]"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="What would you like to build?"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <button
              type={isLoading ? "button" : "submit"}
              onClick={isLoading ? () => stop?.() : undefined}
              disabled={!isLoading && !input.trim()}
              className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center transition-all",
                !isLoading && !input.trim()
                  ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                  : isLoading
                    ? "bg-red-500 text-white hover:bg-red-400"
                    : "bg-cyan-500 text-white hover:bg-cyan-400"
              )}
            >
              {isLoading ? <Square className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          {agentStatus.tokenCount > 0 && (
            <div className="text-[10px] text-zinc-600 text-center mt-2">
              {agentStatus.tokenCount.toLocaleString()} tokens used
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

// ============ MAIN APP ============
export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
    return localStorage.getItem('vibes_session_id') || 'default';
  });
  const [isSessionSidebarOpen, setIsSessionSidebarOpen] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(true);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    reasoningMode: 'react',
    isProcessing: false,
    tokenCount: 0,
    tasks: [],
    lessonsLearned: 0,
    factsStored: 0,
    patternsCount: 0,
  });

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

  const handleAgentStatusUpdate = useCallback((update: Partial<AgentStatus>) => {
    setAgentStatus(prev => {
      const updated = { ...prev, ...update };

      // Handle incremental updates for counters
      if (update.lessonsLearned && typeof update.lessonsLearned === 'number') {
        updated.lessonsLearned = prev.lessonsLearned + update.lessonsLearned;
      }
      if (update.factsStored && typeof update.factsStored === 'number') {
        updated.factsStored = prev.factsStored + update.factsStored;
      }
      if (update.patternsCount && typeof update.patternsCount === 'number') {
        updated.patternsCount = prev.patternsCount + update.patternsCount;
      }

      // Merge tasks if provided
      if (update.tasks) {
        updated.tasks = update.tasks;
      }

      return updated;
    });
  }, []);

  useEffect(() => {
    localStorage.setItem('vibes_session_id', currentSessionId);
  }, [currentSessionId]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Reset agent status when session changes
  useEffect(() => {
    setAgentStatus({
      reasoningMode: 'react',
      isProcessing: false,
      tokenCount: 0,
      tasks: [],
      lessonsLearned: 0,
      factsStored: 0,
      patternsCount: 0,
    });
  }, [currentSessionId]);

  const currentSession = sessions.find(s => s.id === currentSessionId);

  return (
    <div className="flex h-screen bg-[#09090b] text-zinc-100">
      {/* Session Sidebar */}
      <AnimatePresence>
        {(isSessionSidebarOpen || window.innerWidth >= 1024) && (
          <SessionSidebar
            sessions={sessions}
            currentSessionId={currentSessionId}
            isLoading={isLoadingSessions}
            onSessionSelect={setCurrentSessionId}
            onNewSession={() => {
              const title = prompt('Session name:');
              if (title) createSession(title);
            }}
            onDeleteSession={deleteSession}
            onClose={() => setIsSessionSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950/50">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSessionSidebarOpen(!isSessionSidebarOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <History className="w-5 h-5 text-zinc-400" />
            </button>

            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-white">Vibes</h1>
                <p className="text-[10px] text-zinc-500 truncate max-w-[120px]">
                  {currentSession?.metadata?.title || currentSessionId}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Reasoning Mode Indicator */}
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-zinc-800/50">
              <span className="text-xs">
                {agentStatus.reasoningMode === 'tot' ? '🌳' :
                 agentStatus.reasoningMode === 'plan-execute' ? '📋' : '🔄'}
              </span>
              <span className="text-[10px] text-zinc-500 capitalize">
                {agentStatus.reasoningMode === 'tot' ? 'Tree-of-Thoughts' :
                 agentStatus.reasoningMode === 'plan-execute' ? 'Plan-Execute' : 'ReAct'}
              </span>
              {agentStatus.isProcessing && (
                <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse" />
              )}
            </div>

            {sessions.length > 1 && (
              <span className="text-[10px] text-zinc-600 hidden sm:inline">
                {sessions.length} sessions
              </span>
            )}
          </div>
        </header>

        {/* Chat Area */}
        <ChatArea
          key={currentSessionId}
          sessionId={currentSessionId}
          onSessionUpdate={fetchSessions}
          onAgentStatusUpdate={handleAgentStatusUpdate}
          agentStatus={agentStatus}
        />
      </div>

      {/* Agent Status Panel */}
      <AgentStatusPanel
        status={agentStatus}
        isOpen={isAgentPanelOpen}
        onToggle={() => setIsAgentPanelOpen(!isAgentPanelOpen)}
      />
    </div>
  );
}
