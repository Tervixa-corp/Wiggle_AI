//! Tervixa Wiggle core engine: identity, prompt compilation, skills, and workspace permissions.
//! Provider routing, MCP, memory, hooks and agent orchestration are not implemented yet.

pub mod identity;
pub mod permissions;
pub mod prompt_compiler;
pub mod skills;

pub use identity::IDENTITY;

/// Assemble the system identity and user request. Kept for compatibility with earlier callers.
pub fn compile_prompt(user_prompt: &str) -> String {
    format!("{IDENTITY}\n\nUser request:\n{user_prompt}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_identity_and_user_request() {
        let prompt = compile_prompt("hello");
        assert!(prompt.starts_with(IDENTITY));
        assert!(prompt.ends_with("hello"));
    }
}
