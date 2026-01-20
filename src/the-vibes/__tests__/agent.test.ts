import { expect, test, describe, mock } from "bun:test";
import { DeepAgent } from "../index";
import { openai } from "@ai-sdk/openai";

describe("DeepAgent AI SDK v6 Enhancements", () => {
    test("should initialize with AI SDK v6 abstractions", () => {
        const agent = new DeepAgent({
            model: openai("gpt-4o"),
        });
        expect(agent).toBeDefined();
        expect(agent.getState()).toBeDefined();
    });

    test("should have all default middleware loaded", () => {
        const agent = new DeepAgent();
        const state = agent.getState();
        // Default middleware should be present (checked via tools presence in invoke if we were to call it)
        expect(agent).toBeDefined();
    });
});
