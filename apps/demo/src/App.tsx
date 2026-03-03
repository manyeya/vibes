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
  RefreshCw,
  TreePine,
  ClipboardList,
  CheckCircle2,
  ChevronDown,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from './lib/utils';
import { DataPartRenderer, isDataPart } from './components/data-parts';
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
      className="border border-amber-300 dark:border-amber-900/50 rounded-lg overflow-hidden bg-amber-50 dark:bg-amber-950/20"
    >
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-950/30 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <div>
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Permission Required</span>
            <Badge variant="amber" size="sm" className="ml-2">{toolName}</Badge>
          </div>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-zinc-500 dark:text-zinc-500 transition-transform", isExpanded && "rotate-180")} />
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
              <pre className="text-xs text-zinc-700 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-900/50 p-3 rounded-md overflow-auto max-h-48 font-mono">
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
      <aside className="fixed top-0 left-0 bottom-0 w-72 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 z-50 lg:static lg:z-0 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-200">Sessions</h2>
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
              <Loader2 className="w-5 h-5 text-zinc-400 dark:text-zinc-600 animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-xs text-zinc-500 dark:text-zinc-600">No sessions yet</p>
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
}

const ChatArea = ({ sessionId, onSessionUpdate }: ChatAreaProps) => {
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
      console.log("dataPart:", dataPart);
      switch (type) {
        // All data parts go to the chat display
        case 'data-reasoning_mode':
        case 'data-reasoning':
        case 'data-status':
        case 'data-task_update':
        case 'data-task_graph':
        case 'data-todo_update':
        case 'data-summarization':

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
              <Loader2 className="w-5 h-5 text-zinc-400 dark:text-zinc-600 animate-spin mr-2" />
              <span className="text-sm text-zinc-600 dark:text-zinc-500">Loading...</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Avatar type="bot" size="lg" className="mb-4" />
              <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-1">Vibes</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-500">Your Deep Agent assistant</p>
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
            <Card className="mb-4 border-red-300 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20">
              <p className="text-sm text-red-700 dark:text-red-400">{error.message || 'An error occurred'}</p>
            </Card>
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 p-4">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
          <div className={cn(
            "flex items-end gap-2 bg-white dark:bg-zinc-900 rounded-lg border p-2 transition-colors",
            document.activeElement?.tagName === 'TEXTAREA' ? "border-zinc-400 dark:border-zinc-600" : "border-zinc-300 dark:border-zinc-700"
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
                isLoading && "text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/30",
                !isLoading && input.trim() && "text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              )}
            />
          </div>
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

  const currentSession = sessions.find(s => s.id === currentSessionId);

  return (
    <div className="flex h-screen bg-white dark:bg-[#0a0a0a] text-zinc-900 dark:text-zinc-100">
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
        <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/50">
          <div className="flex items-center gap-3">
            <IconButton
              icon={<History className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />}
              label="Toggle sessions"
              onClick={() => setIsSessionSidebarOpen(!isSessionSidebarOpen)}
              className="lg:hidden"
            />

            <div className="flex items-center gap-2">
              <Avatar type="custom" size="md" icon={<Bot className="w-4 h-4 text-zinc-700 dark:text-zinc-300" />} className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700" />
              <div>
                <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Vibes</h1>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-500 truncate max-w-[120px]">
                  {currentSession?.metadata?.title || currentSessionId}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
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
        />
      </div>
    </div>
  );
}
