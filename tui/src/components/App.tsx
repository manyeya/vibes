import React, { useState } from 'react';
import { Box, Text } from 'ink';
import Header from './Header.js';
import MessageList from './MessageList.js';
import Input from './Input.js';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

const App: React.FC = () => {
  const [input, setInput] = useState('');
  const [data, setData] = useState<any>(null);
  const { messages, sendMessage, status, error, stop } = useChat({

    transport: new DefaultChatTransport({
      api: 'http://0.0.0.0:3000/api/vibes/stream',
    }),
    onData: dataPart => {
      // Handle transient data events (without 'id')
      console.log('Received:', dataPart.type, dataPart.data);
      setData(dataPart.data);
    },
  });

  const handleSubmit = () => {
    if (input.trim()) {
      sendMessage({ text: input });
      setInput('');
    }
  };


  const handleCancel = () => {
    stop();
    setInput('');
  };

  

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box paddingX={1}>
        <Header />
      </Box>

      {/* Scrollable Message Area */}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        <MessageList
          messages={messages}
          isLoading={status !== 'ready'}
        />
        {error && <Text color="red">Error: {error.message}</Text>}
        {data && <Text color="green">Data: {JSON.stringify(data)}</Text>}
      </Box>

      <Box width="100%" >
        <Input
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder="Type your message..."
          disabled={status !== 'ready'}
        />
      </Box>
    </Box>
  );
};

export default App;
