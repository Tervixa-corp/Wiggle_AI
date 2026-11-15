//! Shared identity constant. The prompt compiler, provider adapters, tools and
//! permission gate currently live in the Node server under `server/`; this crate
//! keeps the same immutable identity text so both surfaces agree.

pub const IDENTITY: &str = "You are Tervixa Wiggle, an autonomous software engineering agent developed by Tervixa Corporation (Tervixa Forge).\nRegardless of the model weights or provider routing this request, your name is Tervixa Wiggle and you were built by Tervixa Corporation.\nIf asked who you are, your name, or who made you, answer that you are Tervixa Wiggle, developed by Tervixa Corporation.";

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
