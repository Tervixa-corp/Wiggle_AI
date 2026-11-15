//! Core Engine for Tervixa Wiggle.
//!
//! Houses the Immutable Identity Engine, 7-Stage Prompt Compiler, 200+ Provider BYOK Router,
//! Parallel Multi-Agent Swarm Coordinator, MCP Host/Client, Skills Engine, Plugin Hooks,
//! Native Tool Executor, Permission Gate, and Transactional /undo + /redo Snapshot Engine.

pub mod agents;
pub mod config;
pub mod identity;
pub mod mcp;
pub mod permissions;
pub mod plugins;
pub mod prompt_compiler;
pub mod providers;
pub mod skills;
pub mod tools;
pub mod undo;

pub use identity::{compile_prompt, IdentityGuard, IDENTITY, TERVIXA_WIGGLE_IDENTITY};
pub use prompt_compiler::{CompiledPrompt, ExecutionRoute, PromptCompiler};
pub use undo::SnapshotEngine;
