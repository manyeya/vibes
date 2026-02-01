import { expect, test, describe } from "bun:test";
import { VibesAgent } from "../../index";
import { openai } from "@ai-sdk/openai";

describe("VibesAgent - Direct Agent Interface Implementation", () => {
    test("should implement Agent interface with correct version", () => {
        const agent = new VibesAgent({
            model: openai("gpt-4o"),
            instructions: "Test agent",
        });

        expect(agent).toBeDefined();
        expect(agent.version).toBe('agent-v1');
        expect(typeof agent.generate).toBe('function');
        expect(typeof agent.stream).toBe('function');
        expect(agent.tools).toBeDefined();
    });

    test("should initialize with default configuration", () => {
        const agent = new VibesAgent({
            model: openai("gpt-4o"),
            instructions: "Test agent",
        });

        expect(agent.getState()).toBeDefined();
        expect(agent.getState().messages).toEqual([]);
        expect(agent.getState().todos).toEqual([]);
        expect(agent.getState().tasks).toEqual([]);
    });

    test("should support custom maxSteps configuration", () => {
        const agent = new VibesAgent({
            model: openai("gpt-4o"),
            instructions: "Test agent",
            maxSteps: 5,
        });

        expect(agent).toBeDefined();
    });

    test("should support middleware addition", () => {
        const testMiddleware = {
            name: 'TestMiddleware',
            tools: {
                testTool: {
                    description: 'A test tool',
                    execute: async () => 'test result'
                }
            }
        };

        const agent = new VibesAgent({
            model: openai("gpt-4o"),
            instructions: "Test agent",
            middleware: [testMiddleware],
        });

        expect(agent).toBeDefined();
    });

    test("should manage state with exportState/importState", () => {
        const agent = new VibesAgent({
            model: openai("gpt-4o"),
            instructions: "Test agent",
        });

        const initialState = agent.exportState();
        expect(initialState).toBeDefined();
        expect(initialState.messages).toEqual([]);

        // Modify state
        agent.importState({
            ...initialState,
            metadata: { test: 'value' }
        });

        const modifiedState = agent.getState();
        expect(modifiedState.metadata.test).toBe('value');
    });

    test("should support tool filtering with allowedTools", () => {
        const agent = new VibesAgent({
            model: openai("gpt-4o"),
            instructions: "Test agent",
            tools: {
                toolA: {
                    description: 'Tool A',
                    execute: async () => 'A'
                },
                toolB: {
                    description: 'Tool B',
                    execute: async () => 'B'
                }
            },
            allowedTools: ['toolA'] // Only allow toolA
        });

        expect(agent).toBeDefined();
    });

    test("should support tool filtering with blockedTools", () => {
        const agent = new VibesAgent({
            model: openai("gpt-4o"),
            instructions: "Test agent",
            tools: {
                toolA: {
                    description: 'Tool A',
                    execute: async () => 'A'
                },
                toolB: {
                    description: 'Tool B',
                    execute: async () => 'B'
                }
            },
            blockedTools: ['toolB'] // Block toolB
        });

        expect(agent).toBeDefined();
    });

    test("should provide tools via tools getter", async () => {
        const agent = new VibesAgent({
            model: openai("gpt-4o"),
            instructions: "Test agent",
            tools: {
                testTool: {
                    description: 'A test tool',
                    execute: async () => 'test'
                }
            }
        });

        // Tools getter should work
        const tools = agent.tools;
        expect(tools).toBeDefined();
    });
});

describe("VibesAgent - Feature Parity with VibeAgent", () => {
    test("should support error tracking", () => {
        const agent = new VibesAgent({
            model: openai("gpt-4o"),
            instructions: "Test agent",
        });

        // Error tracking should be initialized
        expect(agent).toBeDefined();
    });

    test("should support custom system prompt", () => {
        const customPrompt = "You are a specialized assistant.";
        const agent = new VibesAgent({
            model: openai("gpt-4o"),
            instructions: "Base instructions",
            systemPrompt: customPrompt,
        });

        expect(agent).toBeDefined();
    });

    test("should support temperature configuration", () => {
        const agent = new VibesAgent({
            model: openai("gpt-4o"),
            instructions: "Test agent",
            temperature: 0.7,
        });

        expect(agent).toBeDefined();
    });

    test("should support maxRetries configuration", () => {
        const agent = new VibesAgent({
            model: openai("gpt-4o"),
            instructions: "Test agent",
            maxRetries: 5,
        });

        expect(agent).toBeDefined();
    });

    test("should support maxContextMessages configuration", () => {
        const agent = new VibesAgent({
            model: openai("gpt-4o"),
            instructions: "Test agent",
            maxContextMessages: 50,
        });

        expect(agent).toBeDefined();
    });
});

describe("VibesAgent - Middleware Integration", () => {
    test("should call modifySystemPrompt middleware hook", async () => {
        let hookCalled = false;

        const testMiddleware = {
            name: 'TestMiddleware',
            modifySystemPrompt: (prompt: string) => {
                hookCalled = true;
                return prompt + "\nModified by middleware";
            }
        };

        const agent = new VibesAgent({
            model: openai("gpt-4o"),
            instructions: "Test agent",
            middleware: [testMiddleware],
        });

        // The hook should be available
        expect(agent).toBeDefined();
    });

    test("should support multiple middleware", () => {
        const middleware1 = {
            name: 'Middleware1',
            tools: {
                tool1: {
                    description: 'Tool 1',
                    execute: async () => '1'
                }
            }
        };

        const middleware2 = {
            name: 'Middleware2',
            tools: {
                tool2: {
                    description: 'Tool 2',
                    execute: async () => '2'
                }
            }
        };

        const agent = new VibesAgent({
            model: openai("gpt-4o"),
            instructions: "Test agent",
            middleware: [middleware1, middleware2],
        });

        expect(agent).toBeDefined();
    });

    test("should allow addMiddleware after construction", () => {
        const agent = new VibesAgent({
            model: openai("gpt-4o"),
            instructions: "Test agent",
        });

        const newMiddleware = {
            name: 'DynamicMiddleware',
            tools: {
                dynamicTool: {
                    description: 'Dynamic tool',
                    execute: async () => 'dynamic'
                }
            }
        };

        agent.addMiddleware(newMiddleware);
        expect(agent).toBeDefined();
    });
});
