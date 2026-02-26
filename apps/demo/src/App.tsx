import React, { useState, useEffect, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import {
  Loader2,
  Send,
  User,
  Bot,
  Shield,
  Square,
  Plus,
  MessageSquare,
  History,
  Activity,
  Database,
  Lightbulb,
  Network,
  Settings2,
  Zap,
  FileText,
  RefreshCw,
  TreePine,
  ClipboardList,
  CheckCircle2,
  ChevronDown,
  X,
  Brain,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from './lib/utils';
import { DataPartRenderer, isDataPart, reasoningConfig, ReasoningModePart } from './components/data-parts';
import { TextPart, ReasoningPart, ToolResultPart } from './components/message-parts';

// Import new Vercel-style UI components
import { Button } from './components/ui/Button';
import { Textarea } from './components/ui/Input';
import { Card } from './components/ui/Card';
import { Badge } from './components/ui/Badge';
import { Avatar } from './components/ui/Avatar';
import { IconButton } from './components/ui/IconButton';
import { Skeleton } from './components/ui/Skeleton';
import { Divider } from './components/ui/Divider';
import { ChatBubble } from './components/chat/ChatBubble';
import { TypingIndicator } from './components/chat/TypingIndicator';
import { SessionCard } from './components/chat/SessionCard';

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
      case 'tot': return <TreePine className="w-4 h-4 text-violet-400" />;
      case 'plan-execute': return <ClipboardList className="w-4 h-4 text-amber-400" />;
      case 'react': return <RefreshCw className="w-4 h-4 text-cyan-400" />;
      default: return <RefreshCw className="w-4 h-4 text-cyan-400" />;
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

  const getModeBadgeVariant = (mode: string): 'cyan' | 'violet' | 'amber' => {
    switch (mode) {
      case 'tot': return 'violet';
      case 'plan-execute': return 'amber';
      case 'react': return 'cyan';
      default: return 'cyan';
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

  const getStatusBadgeVariant = (taskStatus: string): 'zinc' | 'amber' | 'emerald' | 'red' => {
    switch (taskStatus) {
      case 'in_progress': return 'amber';
      case 'completed': return 'emerald';
      case 'blocked': return 'red';
      case 'failed': return 'red';
      case 'pending':
      default: return 'zinc';
    }
  };

  const getPriorityBadgeVariant = (priority?: string): 'red' | 'amber' | 'emerald' | 'zinc' => {
    switch (priority) {
      case 'critical': return 'red';
      case 'high': return 'amber';
      case 'medium': return 'amber';
      case 'low': return 'emerald';
      default: return 'zinc';
    }
  };

  const getPriorityColor = (priority?: string): string => {
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
        <IconButton
          icon={<Settings2 className={cn("w-4 h-4 transition-transform", isOpen && "rotate-90")} />}
          label="Toggle panel"
          onClick={onToggle}
        />
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
              <Card gradient hover>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-zinc-500">Reasoning Mode</span>
                  {status.isProcessing && (
                    <Badge variant="cyan" size="sm">
                      <span className="w-1 h-1 bg-cyan-400 rounded-full animate-pulse mr-1" />
                      Processing
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg">{getModeIcon(status.reasoningMode)}</span>
                  <Badge variant={getModeBadgeVariant(status.reasoningMode)} size="md">
                    {getModeLabel(status.reasoningMode)}
                  </Badge>
                </div>
              </Card>

              {/* Memory Systems */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Database className="w-3.5 h-3.5 text-violet-400" />
                  <span className="text-xs font-medium text-zinc-400">Memory Systems</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Card hover className="p-2 text-center">
                    <Lightbulb className="w-3.5 h-3.5 text-amber-400 mx-auto mb-1" />
                    <div className="text-lg font-semibold text-white">{status.lessonsLearned}</div>
                    <div className="text-[9px] text-zinc-500">Lessons</div>
                  </Card>
                  <Card hover className="p-2 text-center">
                    <FileText className="w-3.5 h-3.5 text-blue-400 mx-auto mb-1" />
                    <div className="text-lg font-semibold text-white">{status.factsStored}</div>
                    <div className="text-[9px] text-zinc-500">Facts</div>
                  </Card>
                  <Card hover className="p-2 text-center">
                    <Network className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1" />
                    <div className="text-lg font-semibold text-white">{status.patternsCount}</div>
                    <div className="text-[9px] text-zinc-500">Patterns</div>
                  </Card>
                </div>
              </div>

              {/* Active Tasks */}
              {activeTasks.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-3.5 h-3.5 text-yellow-400" />
                    <span className="text-xs font-medium text-zinc-400">
                      Active Tasks
                    </span>
                    <Badge variant="amber" size="sm">{activeTasks.length}</Badge>
                  </div>
                  <div className="space-y-1.5">
                    {activeTasks.slice(0, 5).map((task) => (
                      <Card key={task.id} hover className="p-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={getStatusBadgeVariant(task.status)} size="sm">
                            {getStatusIcon(task.status)}
                          </Badge>
                          <span className={cn("text-xs truncate flex-1",
                            task.status === 'pending' ? 'text-zinc-500' : 'text-zinc-300'
                          )}>
                            {task.title.length > 28 ? task.title.slice(0, 28) + '...' : task.title}
                          </span>
                          {task.priority && (
                            <span className={cn("w-1.5 h-1.5 rounded-full", getPriorityColor(task.priority))} />
                          )}
                        </div>
                      </Card>
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
                      Completed
                    </span>
                    <Badge variant="emerald" size="sm">{completedTasks.length}</Badge>
                  </div>
                  <div className="space-y-1">
                    {completedTasks.slice(-3).map((task) => (
                      <Card key={task.id} hover className="p-2">
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-400 text-xs">✓</span>
                          <span className="text-xs text-zinc-500 truncate">
                            {task.title.length > 30 ? task.title.slice(0, 30) + '...' : task.title}
                          </span>
                        </div>
                      </Card>
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
                    <Badge key={cap} variant="cyan" size="sm">
                      {cap}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Token Usage */}
              {status.tokenCount > 0 && (
                <>
                  <Divider />
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500">Total Tokens</span>
                    <span className="text-zinc-300 font-mono">
                      {status.tokenCount.toLocaleString()}
                    </span>
                  </div>
                </>
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
            <Badge variant="amber" size="sm" className="ml-2">{toolName}</Badge>
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
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => onDeny(approvalId)}
                >
                  Deny (N)
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => onApprove(approvalId)}
                >
                  Approve (Y)
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
          <IconButton
            icon={<Plus className="w-4 h-4" />}
            label="New session"
            onClick={onNewSession}
          />
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
                <SessionCard
                  key={session.id}
                  id={session.id}
                  title={session.metadata?.title}
                  isActive={session.id === currentSessionId}
                  messageCount={session.messageCount}
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
}

const ChatMessage = ({ message, onApprove, onDeny }: ChatMessageProps) => {
  const isUser = message.role === 'user';
  const parts = (message as any).parts || [];

  const seenToolApprovals = new Set<string>();
  const seenToolResults = new Set<string>();

  // Render parts and collect results
  const renderedParts = parts.map((part: any, partIndex: number) => {
    // Text content
    if (part.type === 'text') {
      return <TextPart key={`text-${partIndex}`} text={part.text} isUser={isUser} />;
    }

    // Thinking/reasoning
    if (part.type === 'reasoning' || part.type === 'thinking') {
      return <ReasoningPart key={`reasoning-${partIndex}`} text={part.text} />;
    }

    // Data parts - handle both wrapped and direct formats
    if (isDataPart(part)) {
      return <DataPartRenderer key={`data-${partIndex}`} part={part} />;
    }
    if (part.type === 'data' && isDataPart(part.data)) {
      return <DataPartRenderer key={`data-${partIndex}`} part={part.data} />;
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
      return (
        <ToolResultPart
          key={`result-${part.toolCallId}`}
          toolName={part.toolName || part.name}
          isError={part.state === 'output-error' || part.state === 'output-denied'}
        />
      );
    }

    return null;
  });

  // Filter out null parts and check if any content was rendered
  const hasContent = renderedParts.some((part: React.ReactNode) => part !== null) ||
    (!isUser && (message as any).usage);

  // Filter out empty assistant messages (no rendered content)
  if (!isUser && !hasContent) return null;

  // Use ChatBubble for simple text messages, custom layout for complex ones
  const hasComplexContent = renderedParts.some((part: React.ReactNode) =>
    part && (React.isValidElement(part) && part.type !== TextPart)
  );

  if (!hasComplexContent) {
    // Simple text message - use ChatBubble
    const textContent = parts.find((p: any) => p.type === 'text')?.text || '';
    return (
      <ChatBubble role={isUser ? 'user' : 'assistant'}>
        {renderedParts}
      </ChatBubble>
    );
  }

  // Complex message with tool results/approvals - use custom layout
  return (
    <div className={cn("flex gap-3 mb-6", isUser && "flex-row-reverse")}>
      <Avatar type={isUser ? 'user' : 'bot'} size="md" />

      <div className={cn("flex-1 space-y-2 min-w-0", isUser && "flex flex-col items-end")}>
        {renderedParts}

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
  onAgentStatusChange: (status: AgentStatus) => void;
  agentStatus: AgentStatus;
}

const ChatArea = ({ sessionId, onSessionUpdate, onAgentStatusChange, agentStatus }: ChatAreaProps) => {
  const [input, setInput] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [dataParts, setDataParts] = useState<Array<{ id: string; type: string; data: unknown }>>([]);

  const { messages, sendMessage, status, addToolApprovalResponse, error, stop, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/mimo-code/stream',
      headers: { 'Content-Type': 'application/json' },
      body: { session_id: sessionId },
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,

    onData: (dataPart: any) => {
      const id = `${dataPart.type}-${Date.now()}`;
      const { type, data } = dataPart;
      console.log("dataPart no fucking data:",dataPart);
      switch (type) {

        // Reasoning mode updates - update agent status
        case 'data-reasoning_mode':
          onAgentStatusChange({ ...agentStatus, reasoningMode: data.mode });
          setDataParts(prev => [...prev, { id, type, data }]);
          break;

        // Reasoning/thought process
        case 'data-reasoning':
          setDataParts(prev => [...prev, { id, type, data }]);
          break;

        // Status updates - also track memory counts
        case 'data-status':
          const msg = data.message;
          if (msg.includes('Lesson saved')) {
            onAgentStatusChange({ ...agentStatus, lessonsLearned: agentStatus.lessonsLearned + 1 });
          }
          if (msg.includes('Fact remembered')) {
            onAgentStatusChange({ ...agentStatus, factsStored: agentStatus.factsStored + 1 });
          }
          if (msg.includes('Pattern saved')) {
            onAgentStatusChange({ ...agentStatus, patternsCount: agentStatus.patternsCount + 1 });
          }
          setDataParts(prev => [...prev, { id, type, data }]);
          break;

        // Task updates - sync with agent status
        case 'data-task_update':
          onAgentStatusChange({
            ...agentStatus,
            tasks: agentStatus.tasks.some(t => t.id === data.id)
              ? agentStatus.tasks.map(t => t.id === data.id ? { ...t, ...data } : t)
              : [...agentStatus.tasks, { id: data.id, title: data.title || data.id, ...data }],
          });
          setDataParts(prev => [...prev, { id, type, data }]);
          break;

        // Task graph visualization
        case 'data-task_graph':
          setDataParts(prev => [...prev, { id, type, data }]);
          break;

        // Todo updates
        case 'data-todo_update':
          setDataParts(prev => [...prev, { id, type, data }]);
          break;

        // Context summarization
        case 'data-summarization':
          setDataParts(prev => [...prev, { id, type, data }]);
          break;

        // Tool execution progress
        case 'data-tool_progress':
          setDataParts(prev => [...prev, { id, type, data }]);
          break;

        // Error notifications
        case 'data-error':
          setDataParts(prev => [...prev, { id, type, data }]);
          break;

        // Memory system updates
        case 'data-memory_update':
          if (data.type === 'lesson' && data.action === 'saved') {
            onAgentStatusChange({ ...agentStatus, lessonsLearned: agentStatus.lessonsLearned + 1 });
          }
          if (data.type === 'fact' && data.action === 'saved') {
            onAgentStatusChange({ ...agentStatus, factsStored: agentStatus.factsStored + 1 });
          }
          if (data.type === 'pattern' && data.action === 'saved') {
            onAgentStatusChange({ ...agentStatus, patternsCount: agentStatus.patternsCount + 1 });
          }
          setDataParts(prev => [...prev, { id, type, data }]);
          break;

        // Swarm coordination signals
        case 'data-swarm_signal':
          setDataParts(prev => [...prev, { id, type, data }]);
          break;

        // Sub-agent delegation updates
        case 'data-delegation':
          setDataParts(prev => [...prev, { id, type, data }]);
          break;

        // General notifications
        case 'data-notification':
          setDataParts(prev => [...prev, { id, type, data }]);
          break;

        default:
          console.log('Unhandled data part:', type, data);
      }
    },
  });

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

  // Update processing state
  useEffect(() => {
    if (agentStatus.isProcessing !== (status === 'streaming')) {
      onAgentStatusChange({ ...agentStatus, isProcessing: status === 'streaming' });
    }
  }, [status, agentStatus.isProcessing, onAgentStatusChange]);

  // Calculate token count from messages (only done once when messages change)
  useEffect(() => {
    const tokenCount = messages.reduce((acc: number, msg: any) => {
      const usage = (msg as any).usage;
      if (usage) acc += usage.promptTokens + usage.completionTokens;
      return acc;
    }, 0);

    if (tokenCount !== agentStatus.tokenCount) {
      onAgentStatusChange({ ...agentStatus, tokenCount });
    }
  }, [messages, agentStatus.tokenCount, onAgentStatusChange]);

  const isLoading = status === 'streaming' || status === 'submitted' || isLoadingHistory;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      setDataParts([]); // Clear previous data parts
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
              <Avatar type="bot" size="lg" className="mb-4" />
              <h2 className="text-lg font-medium text-white mb-1">Vibes</h2>
              <p className="text-sm text-zinc-500">Your Deep Agent assistant</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {['Planning', 'Tree-of-Thoughts', 'Memory', 'Reflexion', 'Swarm'].map((cap) => (
                  <Badge key={cap} variant="zinc" size="sm">
                    {cap}
                  </Badge>
                ))}
              </div>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {messages.map((message) => {
                // Pre-filter messages: skip assistant messages with no parts or empty parts
                const parts = message.parts || [];
                const isUser = message.role === 'user';

                if (!isUser && parts.length === 0) {
                  return null;
                }

                // Check if any part has actual content
                const hasActualContent = parts.some((part: any) => {
                  // Text with content
                  if (part.type === 'text' && part.text) return true;
                  // Reasoning with content
                  if ((part.type === 'reasoning' || part.type === 'thinking') && part.text) return true;
                  // Data parts
                  if (part.type?.startsWith('data-')) return true;
                  // Tool approvals with id
                  if (part.approval?.id) return true;
                  // Completed tool parts
                  if ((part.type?.startsWith('tool-') || part.type === 'dynamic-tool') &&
                      ['output-available', 'output-error', 'output-denied'].includes(part.state)) {
                    return true;
                  }
                  return false;
                });

                if (!isUser && !hasActualContent) {
                  return null;
                }

                return (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    onApprove={(id) => addToolApprovalResponse({ id, approved: true, reason: 'Approved' })}
                    onDeny={(id) => addToolApprovalResponse({ id, approved: false, reason: 'user denied' })}
                  />
                );
              })}
            </AnimatePresence>
          )}

          {/* Loading indicator */}
          {(() => {
            const lastMessage = messages[messages.length - 1];
            if (!lastMessage) return false;

            const lastMessageParts = lastMessage.parts || [];

            // Check if last message has actual content (matches the filter in messages.map)
            const lastMessageHasActualContent = lastMessageParts.some((part: any) => {
              // Text with content
              if (part.type === 'text' && part.text) return true;
              // Reasoning with content
              if ((part.type === 'reasoning' || part.type === 'thinking') && part.text) return true;
              // Data parts
              if (part.type?.startsWith('data-')) return true;
              // Tool approvals with id
              if (part.approval?.id) return true;
              // Completed tool parts
              if ((part.type?.startsWith('tool-') || part.type === 'dynamic-tool') &&
                  ['output-available', 'output-error', 'output-denied'].includes(part.state)) {
                return true;
              }
              return false;
            });

            const shouldShowLoading = isLoading && !isLoadingHistory && messages.length > 0 && (
              lastMessage.role === 'user' ||
              (lastMessage.role === 'assistant' && !lastMessageHasActualContent)
            );

            return shouldShowLoading;
          })() && (
            <TypingIndicator />
          )}

          {/* Streaming data parts */}
          {dataParts.length > 0 && (
            <div className="flex items-start gap-3 py-2">
              <Avatar type="bot" size="md" />
              <div className="flex-1 space-y-2">
                <AnimatePresence mode="popLayout">
                  {dataParts.map((part) => (
                    <motion.div
                      key={part.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                    >
                      <DataPartRenderer part={part} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <Card className="mb-4 border-red-500/20 bg-red-500/5">
              <p className="text-sm text-red-400">{error.message || 'An error occurred'}</p>
            </Card>
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
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="What would you like to build?"
              autoResize
              maxLength={5000}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <IconButton
              icon={isLoading ? <Square className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              label={isLoading ? "Stop" : "Send"}
              onClick={isLoading ? () => stop?.() : undefined}
              disabled={!isLoading && !input.trim()}
              variant={isLoading ? "ghost" : "ghost"}
              className={cn(
                "shrink-0",
                !isLoading && !input.trim() && "opacity-50 cursor-not-allowed",
                isLoading && "text-red-400 hover:bg-red-500/20",
                !isLoading && input.trim() && "text-cyan-400 hover:bg-cyan-500/20"
              )}
            />
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
            <IconButton
              icon={<History className="w-5 h-5 text-zinc-400" />}
              label="Toggle sessions"
              onClick={() => setIsSessionSidebarOpen(!isSessionSidebarOpen)}
              className="lg:hidden"
            />

            <div className="flex items-center gap-2">
              <Avatar type="custom" size="md" icon={<Bot className="w-4 h-4 text-white" />} className="bg-gradient-to-br from-cyan-500 to-violet-500 border-0" />
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
              {reasoningConfig[agentStatus.reasoningMode]?.icon}
              <span className="text-[10px] text-zinc-500 capitalize">
                {reasoningConfig[agentStatus.reasoningMode]?.label || 'ReAct'}
              </span>
              {agentStatus.isProcessing && (
                <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse" />
              )}
            </div>

            {sessions.length > 1 && (
              <Badge variant="zinc" size="sm">{sessions.length} sessions</Badge>
            )}
          </div>
        </header>

        {/* Chat Area */}
        <ChatArea
          key={currentSessionId}
          sessionId={currentSessionId}
          onSessionUpdate={fetchSessions}
          onAgentStatusChange={setAgentStatus}
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
