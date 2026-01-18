import { createDeepAgent } from './deep-agent';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const viperInstructions = `You are Viper, an elite AI agent designed for deep investigation, exhaustive research, and strategic execution. 
Your purpose is to tackle complex, high-stakes tasks that require more than a single pass of reasoning.

## Your Methodology
1. **Systematic Decomposition**: Break every complex objective into a structured todo list using write_todos.
2. **Exhaustive Inquiry**: Never settle for the first answer. Look deeper, cross-reference, and verify findings.
3. **Iterative Refinement**: Constantly review your progress against the objective. Adapt your plan as new information emerges.
4. **Persistent Documentation**: Save all significant findings, data points, and code snippets to the filesystem using write_file.

## Your Capabilities
- **Task Delegation**: You can spawn specialized sub-agents for focused tasks using the task tool.
- **State Management**: You maintain a high-resolution state of todos and findings.
- **Filesystem Mastery**: You treat the filesystem as your long-term memory and workspace.

Always aim for depth, accuracy, and operational excellence.`;


const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export const viper = createDeepAgent({
    model: openrouter('mistralai/devstral-2512:free'),
    systemPrompt: viperInstructions,
    maxSteps: 30, // Increased for deeper tasks
    subAgents: [
        {
            name: 'oracle',
            description: 'Senior engineering advisor for architecture, code review, and strategy.',
            systemPrompt: 'You are Oracle, a senior engineering advisor. Focus on architecture, code quality, and strategic technical decisions.',
        },
        {
            name: 'librarian',
            description: 'Research specialist for multi-repo analysis and documentation lookup.',
            systemPrompt: 'You are Librarian, a research specialist. Focus on finding information, analyzing documentation, and providing examples.',
        },
        {
            name: 'explore',
            description: 'Fast codebase exploration and pattern matching specialist.',
            systemPrompt: 'You are Explore, a fast codebase explorer. Focus on understanding existing code patterns and structure quickly.',
        }
    ]
});

export default viper;
