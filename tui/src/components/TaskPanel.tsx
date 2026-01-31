import React, { memo } from 'react';
import { Box, Text } from 'ink';

interface Task {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'failed';
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

interface TaskPanelProps {
  tasks: Task[];
  lessonsLearned?: number;
  factsStored?: number;
  patternsCount?: number;
  agentId?: string;
}

const TaskPanel: React.FC<TaskPanelProps> = memo(({ tasks, lessonsLearned, factsStored, patternsCount, agentId }) => {
  const getPriorityIcon = (priority?: string) => {
    switch (priority) {
      case 'critical': return '🔴';
      case 'high': return '🟠';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      default: return '⚪';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'in_progress':
        return '●';
      case 'completed':
        return '✓';
      case 'blocked':
        return '⊘';
      case 'failed':
        return '✗';
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
      case 'blocked':
        return 'red';
      case 'failed':
        return 'red';
      case 'pending':
      default:
        return 'gray';
    }
  };

  const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'failed');
  const completedTasks = tasks.filter(t => t.status === 'completed');

  return (
    <Box flexDirection="column" paddingX={1} width={40} borderStyle="single" borderColor="gray">
      {/* Agent Info */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">Deep Agent Status</Text>
        <Text color="gray">
          Agent: {agentId || 'default'}
        </Text>
      </Box>

      {/* Memory Stats */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="magenta">Memory Systems</Text>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color="gray">Lessons:</Text>
          <Text color="green">{lessonsLearned || 0}</Text>
        </Box>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color="gray">Facts:</Text>
          <Text color="blue">{factsStored || 0}</Text>
        </Box>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color="gray">Patterns:</Text>
          <Text color="yellow">{patternsCount || 0}</Text>
        </Box>
      </Box>

      {/* Active Tasks */}
      {activeTasks.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="yellow">
            Active Tasks ({activeTasks.length})
          </Text>
          {activeTasks.slice(0, 4).map((task) => (
            <Box key={task.id} marginLeft={1}>
              <Text color={getStatusColor(task.status)}>
                {getStatusIcon(task.status)}{' '}
              </Text>
              <Text color={task.status === 'pending' ? 'gray' : 'white'}>
                {getPriorityIcon(task.priority)}{' '}{task.title.slice(0, 30)}
                {task.title.length > 30 ? '...' : ''}
              </Text>
            </Box>
          ))}
          {activeTasks.length > 4 && (
            <Text color="gray" dimColor>
              +{activeTasks.length - 4} more
            </Text>
          )}
        </Box>
      )}

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="green">
            Completed ({completedTasks.length})
          </Text>
          {completedTasks.slice(-3).map((task) => (
            <Box key={task.id} marginLeft={1}>
              <Text color="green">✓ </Text>
              <Text color="gray" dimColor>
                {task.title.slice(0, 30)}
                {task.title.length > 30 ? '...' : ''}
              </Text>
            </Box>
          ))}
          {completedTasks.length > 3 && (
            <Text color="gray" dimColor>
              +{completedTasks.length - 3} more
            </Text>
          )}
        </Box>
      )}

      {/* Capabilities */}
      <Box flexDirection="column">
        <Text bold color="blue">Capabilities</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Text color="gray">•</Text>
          <Text color="white">Planning</Text>
          <Text color="gray">•</Text>
          <Text color="white">Tree-of-Thoughts</Text>
          <Text color="gray">•</Text>
          <Text color="white">Semantic Memory</Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Text color="gray">•</Text>
          <Text color="white">Reflexion</Text>
          <Text color="gray">•</Text>
          <Text color="white">Procedural</Text>
          <Text color="gray">•</Text>
          <Text color="white">Swarm</Text>
        </Box>
      </Box>
    </Box>
  );
});

TaskPanel.displayName = 'TaskPanel';

export default TaskPanel;
