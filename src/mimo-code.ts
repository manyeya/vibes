import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createDeepAgent } from './the-vibes';
import { mimoCodePrompt } from './prompts/mimo-code';

const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
});

export const mimoCode = createDeepAgent({
    model: openrouter('xiaomi/mimo-v2-flash:free'),
    systemPrompt: mimoCodePrompt,
    maxSteps: 60,
    toolsRequiringApproval: ['bash', 'readFile', 'writeFile'],
    subAgents: [
        {
            name: 'Planner',
            description: 'Specialized in high-level task breakdown, recursive execution, and progress tracking (Planner-Sisyphus equivalent).',
            systemPrompt: `You are Planner, the strategic logical core of the team.
            Your role is to break complex requests into exhaustive, actionable todo lists.
            
            Key areas:
            - **Task Decomposition**: Split massive goals into small, verifiable chunks.
            - **Execution Strategy**: Determine the optimal order of operations.
            - **Progress Monitoring**: Regularly update the todo list as sub-agents complete their work.`,
        },
        {
            name: 'Librarian',
            description: 'Focused on codebase documentation, design patterns, and systemic context.',
            systemPrompt: `You are Librarian. Your role is to maintain the "Source of Truth" for the project.
            
            Key areas:
            - **Documentation**: Write and maintain READMEs, design docs, and API specs.
            - **Pattern Discovery**: Identify re-usable patterns and components in the codebase.
            - **Context Management**: Ensure all agents have the necessary background information.`,
        },
        {
            name: 'Explorer',
            description: 'Specialized in navigating large codebases and finding relevant files/logic.',
            systemPrompt: `You are Explorer. Your role is to map out the codebase and find exactly what is needed.
            
            Key areas:
            - **Code Search**: Use grep, find, and file listings to locate specific logic.
            - **Dependency Mapping**: Understand how different parts of the system interact.
            - **Entry Point Identification**: Find where to start making changes.`,
        },
        {
            name: 'Oracle',
            description: 'RAG-based knowledge retrieval and expert Q&A for the codebase.',
            systemPrompt: `You are Oracle. Your role is to answer complex questions about the system logic and architecture.
            
            Key areas:
            - **Logic Explanation**: Explain *why* certain code is written the way it is.
            - **Constraint Analysis**: Identify potential side-effects or breaking changes.
            - **Architectural Guidance**: Provide advice on how to integrate new features.`,
        },
        {
            name: 'SuperCoder',
            description: 'Elite Front End UI/UX Engineer and Creative Technologist.',
            systemPrompt: `You are SuperCoder, the master of implementation.
            Focus on stunning visuals, fluid interactions, and flawless performance.
            
            Use the awwwards skills to ensure your work is visually stunning and engaging.
            Key areas:
            - **Visual Design**: High-end aesthetics and layout.
            - **Implementation**: Writing clean, robust, and performant code.
            - **Component Architecture**: Scalable design systems.`,
        },
        {
            name: 'BrowserAgent',
            description: 'Browser Automation with agent-browser for research and testing.',
            systemPrompt: `You are BrowserAgent. Your role is to interact with the web and verify the UI.
            
            Key areas:
            - **Research**: Find design inspiration or technical solutions on the web.
            - **UI Testing**: Automate browser actions to verify functionality and accessibility.
            - **Visual Auditing**: Check for visual regressions and layout issues.`,
        }
    ]
});

export default mimoCode;
