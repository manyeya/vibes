import { useState, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

export interface UseInputHandlerReturn {
  input: string;
  messages: any[];
  setInput: (value: string) => void;
  handleSubmit: () => void;
  handleCancel: () => void;
  status: 'ready' | 'streaming' | 'error' | 'paused';
  error: Error | null;
}

export function useInputHandler(): UseInputHandlerReturn {
  const [input, setInput] = useState('');

  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({
      api: 'http://0.0.0.0:3000/api/vibes/stream',
    }),
    onData: (dataPart) => {
      console.log('Received:', dataPart.type, dataPart.data);
    },
  });

  const handleSubmit = useCallback(() => {
    if (input.trim()) {
      sendMessage({ text: input });
      setInput('');
    }
  }, [input, sendMessage]);

  const handleCancel = useCallback(() => {
    stop();
    setInput('');
  }, [stop]);

  return {
    input,
    messages,
    setInput,
    handleSubmit,
    handleCancel,
    status: status as 'ready' | 'streaming' | 'error' | 'paused',
    error: error || null,
  };
}
