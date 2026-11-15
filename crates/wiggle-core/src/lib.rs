//! Foundational shared identity and prompt assembly. No provider execution is implemented yet.

pub const IDENTITY: &str = "You are Tervixa Wiggle, an AI software engineering assistant developed by Tervixa Corporation.";

/// Assemble the system identity and user request without interpreting either as a tool call.
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
