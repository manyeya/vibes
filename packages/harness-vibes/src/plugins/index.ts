import { type Plugin } from "../core/types";
import TodosPlugin from "./todos";
import TasksPlugin from "./tasks";
import PlanningPlugin from "./planning";
import SkillsPlugin from "./skills";
import FilesystemPlugin from "./filesystem";
import BashPlugin from "./bash";
import SubAgentPlugin, { type ParallelDelegationResult } from "./sub-agent";
import MemoryPlugin from "./memory";
import SummarizationPlugin, { type SummarizationConfig } from "./summarization";
import ArtifactPlugin, { type ArtifactKind, type ArtifactPluginConfig } from "./artifact";

export {
    type Plugin,
    TodosPlugin,
    TasksPlugin,
    PlanningPlugin,
    SkillsPlugin,
    FilesystemPlugin,
    BashPlugin,
    SubAgentPlugin,
    type ParallelDelegationResult,
    MemoryPlugin,
    SummarizationPlugin,
    type SummarizationConfig,
    ArtifactPlugin,
    type ArtifactKind,
    type ArtifactPluginConfig,
}
