import React, { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Send, Square, Bot } from 'lucide-react';
import { cn } from './lib/utils';
import { Streamdown } from 'streamdown';
import { Button, Textarea } from './components/ui';
import { Avatar, TypingIndicator } from './components/chat';
import { Card } from './components/ui';

export default function SimpleChat() {
  const [input, setInput] = useState('');
  const [dataReceived, setDataReceived] = useState<any[]>([]);

  const { messages, sendMessage, status, stop, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/simple/stream',
    }),
    onData: (data) => {
      setDataReceived(prev => [...prev, data]);
    }
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage({ text: input });
      setInput('');
    }
  };

  const getMessageContent = (message: any) => {
    const parts = message.parts || [];
    if (parts.length === 0) return '';

    const hasActualContent = parts.some((part: any) => {
      if (part.type === 'text' && part.text) return true;
      if ((part.type === 'reasoning' || part.type === 'thinking') && part.text) return true;
      return false;
    });

    if (!hasActualContent) return '';

    const textParts = parts.filter((p: any) => p.type === 'text' && p.text);

    if (textParts.length > 0) {
      return textParts.map((p: any) => p.text).join('');
    }

    if (typeof message.content === 'string') {
      return message.content;
    }

    return '';
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="shrink-0 px-6 py-4 border-b border-zinc-800/50 bg-zinc-900/30 backdrop-blur-sm">
        <div className="flex items-center gap-3 max-w-2xl mx-auto">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">Simple Chat</h1>
            <p className="text-xs text-zinc-500">
              {dataReceived.length > 0 ? `${dataReceived.length} data parts received` : 'Start a conversation'}
            </p>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-8">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/20 flex items-center justify-center mb-6">
                <Bot className="w-8 h-8 text-cyan-400" />
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">Simple Chat</h2>
              <p className="text-sm text-zinc-500 max-w-md">
                Send a message to start chatting with the AI assistant
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {messages.map((message) => {
                const content = getMessageContent(message);
                if (!content && message.role !== 'user') return null;

                return (
                  <div key={message.id} className={cn("flex gap-3 mb-6", message.role === 'user' && "flex-row-reverse")}>
                    <Avatar type={message.role === 'user' ? 'user' : 'bot'} size="md" />
                    <div
                      className={cn(
                        'px-4 py-3 rounded-2xl max-w-[80%]',
                        message.role === 'user'
                          ? 'bg-gradient-to-r from-cyan-600 to-violet-600 text-white rounded-tr-sm'
                          : 'bg-zinc-800/50 text-zinc-100 border border-zinc-700/50 rounded-tl-sm'
                      )}
                    >
                      <Streamdown>{content || (message.role === 'user' ? input : '...')}</Streamdown>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
            <TypingIndicator />
          )}

          {/* Error */}
          {error && (
            <Card className="p-4 my-4 border border-red-500/20 bg-red-500/5">
              <p className="text-sm text-red-400">{error.message || 'An error occurred'}</p>
            </Card>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-zinc-800/50 bg-zinc-900/30 backdrop-blur-sm p-4">
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
          <div className={cn(
            "flex items-end gap-2 bg-zinc-900 rounded-2xl border p-2 transition-all duration-200",
            document.activeElement?.tagName === 'TEXTAREA' ? "border-cyan-500/50 shadow-lg shadow-cyan-500/5" : "border-zinc-800"
          )}>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <Button
              type={isLoading ? "button" : "submit"}
              onClick={isLoading ? () => stop?.() : undefined}
              disabled={!isLoading && !input.trim()}
              variant={isLoading ? 'danger' : 'primary'}
              size="md"
              isLoading={isLoading}
            >
              {isLoading ? <Square className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
