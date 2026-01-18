import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import Message from './Message.js';
import Spinner from 'ink-spinner';
import { UIMessage, UIDataTypes, UITools } from 'ai';

interface VirtualizedMessageListProps {
  messages: UIMessage<unknown, UIDataTypes, UITools>[];
  isLoading: boolean;
  maxHeight?: number;
}

export const VirtualizedMessageList: React.FC<VirtualizedMessageListProps> = React.memo(
  ({ messages, isLoading, maxHeight = 20 }) => {
    const visibleMessages = useMemo(() => {
      return messages.slice(-maxHeight);
    }, [messages, maxHeight]);

    const stableKeys = useMemo(() => {
      return messages.map((msg, idx) => msg.id || `msg-${idx}-${msg.role}-${JSON.stringify(msg.parts).slice(0, 20)}`);
    }, [messages]);

    return (
      <Box flexDirection="column" flexGrow={1}>
        {visibleMessages.map((msg, index) => (
          <Message key={stableKeys[index]} role={msg.role} parts={msg.parts} />
        ))}
        {isLoading && (
          <Box paddingY={1} paddingX={1}>
            <Text color="green">
              <Spinner type="dots" /> Thinking...
            </Text>
          </Box>
        )}
      </Box>
    );
  }
);

VirtualizedMessageList.displayName = 'VirtualizedMessageList';
