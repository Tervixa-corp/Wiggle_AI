use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    Architect,
    Coder,
    Explorer,
    Browser,
    Reviewer,
    Custom(String),
}

impl AgentRole {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Architect => "architect",
            Self::Coder => "coder",
            Self::Explorer => "explorer",
            Self::Browser => "browser",
            Self::Reviewer => "reviewer",
            Self::Custom(name) => name,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentProfile {
    pub role: AgentRole,
    pub name: String,
    pub description: String,
    pub system_directive: String,
    pub max_steps: usize,
}

pub fn builtin_agent_profiles() -> Vec<AgentProfile> {
    vec![
        AgentProfile {
            role: AgentRole::Architect,
            name: "Architect".into(),
            description: "Analyzes the repository, plans multi-file changes, and coordinates subagents.".into(),
            system_directive: "Analyze architecture, trace dependencies, and produce concrete multi-file plans without inventing unobserved code.".into(),
            max_steps: 12,
        },
        AgentProfile {
            role: AgentRole::Coder,
            name: "Coder".into(),
            description: "Implements code edits, writes tests, and runs build verification.".into(),
            system_directive: "Write clean, well-tested code edits using edit_file/write_file and verify with build/test tools.".into(),
            max_steps: 16,
        },
        AgentProfile {
            role: AgentRole::Explorer,
            name: "Explorer".into(),
            description: "Performs fast codebase search (glob, grep) and documentation research.".into(),
            system_directive: "Explore files quickly with glob, grep, and read_file to answer architectural questions with exact file/line references.".into(),
            max_steps: 10,
        },
        AgentProfile {
            role: AgentRole::Browser,
            name: "Browser".into(),
            description: "Operates the built-in browser to inspect DOM trees, console logs, and localhost apps.".into(),
            system_directive: "Navigate URLs, inspect accessibility trees ([ref=e1]), verify UI rendering, and report console/network errors.".into(),
            max_steps: 10,
        },
        AgentProfile {
            role: AgentRole::Reviewer,
            name: "Reviewer".into(),
            description: "Audits diffs for bugs, security issues, and adherence to minimal UI rules.".into(),
            system_directive: "Review changes for security vulnerabilities, regressions, missing tests, and compliance with project instructions.".into(),
            max_steps: 8,
        },
    ]
}
