import React from 'react';
import {
  NotificationPart,
  StatusPart,
  CommandPart,
  FileOperationPart,
  SkillPart,
  TodoUpdatePart,
  TaskUpdatePart,
  TaskGraphPart,
  SummarizationPart,
  ToolProgressPart,
  ErrorPart,
  MemoryUpdatePart,
  DelegationPart,
  ArtifactPart,
  AgentMessagePart,
  AgentThoughtPart,
} from './index';

// Type for data part wrapper that comes from the stream
export interface DataPartWrapper {
  type: string;
  data?: unknown;
}

// Map of data part types to their renderers
const dataPartRenderers: Record<string, React.FC<{ data: unknown }>> = {
  'data-notification': NotificationPart as React.FC<{ data: unknown }>,
  'data-status': StatusPart as React.FC<{ data: unknown }>,
  'data-command': CommandPart as React.FC<{ data: unknown }>,
  'data-file_operation': FileOperationPart as React.FC<{ data: unknown }>,
  'data-skill': SkillPart as React.FC<{ data: unknown }>,
  'data-todo_update': TodoUpdatePart as React.FC<{ data: unknown }>,
  'data-task_update': TaskUpdatePart as React.FC<{ data: unknown }>,
  'data-task_graph': TaskGraphPart as React.FC<{ data: unknown }>,
  'data-summarization': SummarizationPart as React.FC<{ data: unknown }>,
  'data-tool_progress': ToolProgressPart as React.FC<{ data: unknown }>,
  'data-error': ErrorPart as React.FC<{ data: unknown }>,
  'data-memory_update': MemoryUpdatePart as React.FC<{ data: unknown }>,
  'data-delegation': DelegationPart as React.FC<{ data: unknown }>,
  'data-artifact': ArtifactPart as React.FC<{ data: unknown }>,
  'data-agent_message': AgentMessagePart as React.FC<{ data: unknown }>,
  'data-agent_thought': AgentThoughtPart as React.FC<{ data: unknown }>,
};

export interface DataPartRendererProps {
  part: DataPartWrapper;
}

export const DataPartRenderer: React.FC<DataPartRendererProps> = ({ part }) => {
  // Extract the actual data from the wrapper
  // The data can be directly in part.data or nested in part.data.data
  const data = (part.data as Record<string, unknown>)?.data ?? part.data;
  
  const Renderer = dataPartRenderers[part.type];
  
  if (!Renderer) {
    // Unknown data part type - could log for debugging
    console.warn(`Unknown data part type: ${part.type}`);
    return null;
  }
  
  return <Renderer data={data} />;
};

// Helper to check if a part is a data part
export const isDataPart = (part: unknown): part is DataPartWrapper => {
  if (typeof part !== 'object' || part === null) return false;
  const p = part as Record<string, unknown>;
  return typeof p.type === 'string' && p.type.startsWith('data-');
};

// Get all supported data part types
export const supportedDataPartTypes = Object.keys(dataPartRenderers);
