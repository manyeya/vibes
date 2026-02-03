import React, { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Send, User, Bot, Square } from 'lucide-react';
import { cn } from './lib/utils';
import { Streamdown } from 'streamdown';

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

    // Find text parts
    const textParts = parts.filter((p: any) => p.type === 'text');
    
    if (textParts.length > 0) {
      return textParts.map((p: any) => p.text).join('');
    }

    // Fallback to content string
    if (typeof message.content === 'string') {
      return message.content;
    }

    return '';
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="shrink-0 px-6 py-4 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-linear-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">Simple Chat</h1>
            <p className="text-xs text-zinc-500">
              Basic AI assistant {dataReceived.length > 0 && `• ${dataReceived.length} data parts received`}
            </p>
          </div>
        </div>
        {/* Data received indicator */}
        {dataReceived.length > 0 && (
          <div className="mt-2 text-xs text-emerald-400">
            Latest: {JSON.stringify(dataReceived[dataReceived.length - 1])}
          </div>
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-12 h-12 rounded-2xl bg-linear-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/20 flex items-center justify-center mb-4">
                <Bot className="w-6 h-6 text-emerald-400" />
              </div>
              <h2 className="text-lg font-medium text-white mb-1">Simple Chat</h2>
              <p className="text-sm text-zinc-500">Start a conversation</p>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((message) => {
                const isUser = message.role === 'user';
                const content = getMessageContent(message);
                // console.log(message.parts);
                if (!content && !isUser) return null;

                return (
                  <div key={message.id} className={cn("flex gap-3", isUser && "flex-row-reverse")}>
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                      isUser ? "bg-zinc-800" : "bg-linear-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/20"
                    )}>
                      {isUser ? <User className="w-4 h-4 text-zinc-400" /> : <Bot className="w-4 h-4 text-emerald-400" />}
                    </div>

                    <div className={cn(
                      "px-4 py-3 rounded-2xl max-w-[80%]",
                      isUser
                        ? "bg-cyan-600 text-white rounded-tr-sm"
                        : "bg-zinc-800 text-zinc-200 rounded-tl-sm"
                    )}>
                      <Streamdown>{content || (isUser ? '' : '...')}</Streamdown>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
            <div className="flex items-center gap-3 py-4">
              <div className="w-8 h-8 rounded-lg bg-linear-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/20 flex items-center justify-center">
                <Bot className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-zinc-800">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="my-4 p-3 rounded-lg border border-red-500/20 bg-red-500/5 text-sm text-red-400">
              {error.message || 'An error occurred'}
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-zinc-800 bg-zinc-900/50 p-4">
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
          <div className={cn(
            "flex items-end gap-2 bg-zinc-900 rounded-xl border p-2 transition-colors",
            document.activeElement?.tagName === 'TEXTAREA' ? "border-emerald-500/50" : "border-zinc-800"
          )}>
            <textarea
              className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-zinc-600 resize-none px-3 py-2 max-h-32 min-h-[40px]"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
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
                    : "bg-emerald-500 text-white hover:bg-emerald-400"
              )}
            >
              {isLoading ? <Square className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
