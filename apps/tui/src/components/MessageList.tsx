import React, { useMemo } from 'react';
import { Box, Text, Static } from 'ink';
import Message from './Message.js';
import { UIMessage, UIDataTypes, UITools } from 'ai';
import Spinner from 'ink-spinner';

interface MessageListProps {
  messages: UIMessage<unknown, UIDataTypes, UITools>[];
  isLoading: boolean;
}

const MessageList: React.FC<MessageListProps> = ({ messages, isLoading }) => {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {messages.map((msg, index) => (
        <Message key={msg.id || index} role={msg.role} parts={msg.parts} />
      ))}

      {/* Loading Indicator */}
      {isLoading && (
        <Box paddingY={1} paddingX={1}>
          <Text color="green">
            <Spinner type="dots" /> Thinking...
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default MessageList;
