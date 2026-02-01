import React from 'react';
import { Box, Text } from 'ink';

interface Todo {
  content: string;
  status: 'in_progress' | 'pending' | 'completed';
}

interface TodoListProps {
  todos: Todo[];
}

const TodoItem: React.FC<{ todo: Todo; index: number }> = ({ todo, index }) => {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'in_progress':
        return '●';
      case 'completed':
        return '✓';
      case 'pending':
      default:
        return '○';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'in_progress':
        return 'yellow';
      case 'completed':
        return 'green';
      case 'pending':
      default:
        return 'gray';
    }
  };

  return (
    <Box key={index} marginLeft={2}>
      <Text color={getStatusColor(todo.status)}>
        {getStatusIcon(todo.status)}{' '}
      </Text>
      <Text color={todo.status === 'pending' ? 'gray' : undefined}>
        {todo.content}
      </Text>
    </Box>
  );
};

const TodoList: React.FC<TodoListProps> = React.memo(({ todos }) => {
  if (!todos || todos.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginY={1}>
      <Box marginBottom={1}>
        <Text bold>Todo List</Text>
      </Box>
      {todos.map((todo, index) => (
        <TodoItem key={todo.content || index} todo={todo} index={index} />
      ))}
    </Box>
  );
});

export default TodoList;
