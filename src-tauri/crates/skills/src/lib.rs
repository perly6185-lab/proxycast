//! ProxyCast Skills Crate
//!
//! 包含 Skills 系统的 trait 定义和纯逻辑部分。
//! Tauri 相关实现（TauriExecutionCallback）保留在主 crate。

#![allow(clippy::redundant_closure)]

mod execution_callback;
mod llm_provider;
mod proxycast_llm_provider;
mod skill_loader;
mod skill_matcher;

// 电商 Skill 模块
pub mod ecommerce_review_reply;

pub use execution_callback::{
    events, ExecutionCallback, ExecutionCompletePayload, StepCompletePayload, StepErrorPayload,
    StepStartPayload,
};
pub use llm_provider::{LlmProvider, SkillError};
pub use proxycast_llm_provider::ProxyCastLlmProvider;
pub use skill_loader::{
    find_skill_by_name, get_project_skills_dir, get_proxycast_skills_dir, get_skill_roots,
    load_skill_from_file, load_skills_from_directory, parse_allowed_tools, parse_boolean,
    parse_skill_frontmatter, parse_workflow_steps, LoadedSkillDefinition, SkillFrontmatter,
    SkillTriggerConfig, WorkflowStep,
};
pub use skill_matcher::{SkillMatch, SkillMatcher};
