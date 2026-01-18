import React, { useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import { marked } from 'marked';
import { TitledBox, titleStyles } from "@mishieck/ink-titled-box";
import TodoList from './TodoList';

interface MessageProps {
  role: string;
  parts: any[];
}

interface Todo {
  content: string;
  status: 'in_progress' | 'pending' | 'completed';
}

const Message: React.FC<MessageProps> = React.memo(({ role, parts }) => {

  const renderMarkdown = useCallback((content: string) => {
    const tokens = marked.lexer(content);

    return tokens.map((token, index) => {
      switch (token.type) {
        case 'code':
          return (
            <Box key={index} flexDirection="column" marginY={1}>
              <Box>
                <Text dimColor color="gray">
                  {token.lang || 'code'}
                </Text>
              </Box>
              <Box
                paddingX={1}
                borderColor="gray"
                borderStyle="single"
                flexGrow={1}
              >
                <Text color="yellow">
                  {token.text}
                </Text>
              </Box>
            </Box>
          );
        case 'list':
          return (
            <Box key={index} flexDirection="column" marginY={1}>
              {token.items?.map((item: any, i: number) => (
                <Box key={i} flexDirection="column">
                  <Text>{item.text}</Text>
                </Box>
              ))}
            </Box>
          );
        case 'link':
          return (
            <Box key={index} flexDirection="column" marginY={1}>
              <Text color="blue" underline>
                {token.text}
              </Text>
            </Box>
          );

        case 'quote':
          return (
            <Box key={index} flexDirection="column" marginY={1}>
              <Text color="blue" underline>
                {token.text}
              </Text>
            </Box>
          );
        case 'heading':
          return (
            <Box key={index} flexDirection="column" marginY={1}>
              <Text dimColor>
                {token.text}
              </Text>
            </Box>
          );

        case 'bold':
          return (
            <Box key={index} flexDirection="column" marginY={1}>
              <Text bold>
                {token.text}
              </Text>
            </Box>
          );
        case 'italic':
          return (
            <Box key={index} flexDirection="column" marginY={1}>
              <Text italic>
                {token.text}
              </Text>
            </Box>
          );
        case 'paragraph':
          return (
            <Box key={index} marginBottom={1}>
              <Text>
                {token.tokens?.map((t: any, i: number) => {
                  if (t.type === 'strong') return <Text key={i} bold>{t.text}</Text>;
                  if (t.type === 'em') return <Text key={i} italic>{t.text}</Text>;
                  if (t.type === 'codespan') return <Text key={i} color="yellow" backgroundColor="#333">{` ${t.text} `}</Text>;
                  return <Text key={i}>{t.text}</Text>;
                })}
              </Text>
            </Box>
          );
        case 'space':
          return null;

        default:
          return (
            <Box key={index}>
              <Text>{token.raw}</Text>
            </Box>
          );
      }
    });
  }, []);

  const renderToolOutput = useCallback((part: any) => {
    if (part.toolName === 'write_todos' && part.output?.update?.todos) {
      const todos: Todo[] = part.output.update.todos.map((todo: any) => ({
        content: todo.content,
        status: todo.status || 'pending'
      }));
      return <TodoList todos={todos} />;
    }

    const toolName = part.toolName || part.type;
    const content = part.output?.update?.messages?.[0]?.kwargs?.content ||
      part.output?.content ||
      JSON.stringify(part.output, null, 2);

    return (
      <Box flexDirection="column" marginY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">┌─ Tool: {toolName}</Text>
        </Box>
        <Box marginLeft={2}>
          <Text dimColor>{content}</Text>
        </Box>
        <Box>
          <Text bold color="cyan">└─</Text>
        </Box>
      </Box>
    );
  }, []);

  const content = useMemo(() => {
    return parts.map((part, index) => {
      if (part.type === 'text') {
        return (
          <Box key={index} flexDirection="column">
            {renderMarkdown(part.text)}
          </Box>
        );
      }

      if (part.type === 'dynamic-tool') {
        return (
          <Box key={index} flexDirection="column">
            {renderToolOutput(part)}
          </Box>
        );
      }

      return (
        <Box key={index} flexDirection="column" marginY={1}>
          <Text dimColor>Unknown part type: {part.type}</Text>
        </Box>
      );
    });
  }, [parts, renderMarkdown, renderToolOutput]);

  return (
    <TitledBox
      borderStyle={role === 'assistant' ? "round" : "single"}
      borderColor={role === 'assistant' ? "white" : "gray"}
      titles={[role === 'assistant' ? "Vibes" : role === 'user' ? "You" : role]}
      titleStyles={titleStyles.rectangle}
      padding={1}
    >
      {content}
    </TitledBox>
  );
});

export default Message;
