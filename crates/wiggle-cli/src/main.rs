use std::env;
use std::path::PathBuf;
use std::process::ExitCode;

use wiggle_core::prompt_compiler::{compile, context_for};
use wiggle_core::skills::load_skills;

const USAGE: &str = "wiggle 0.1.0

Usage:
  wiggle identity                      Print the immutable identity header
  wiggle prompt <text> [--dir DIR]     Print the compiled system prompt and request
  wiggle skills [--dir DIR]            List SKILL.md skills found in DIR
  wiggle --version | --help

Provider execution, the agent loop and MCP are not available in this build.";

fn dir_arg(args: &[String]) -> Result<PathBuf, String> {
    match args.iter().position(|a| a == "--dir") {
        Some(i) => args
            .get(i + 1)
            .map(PathBuf::from)
            .ok_or_else(|| "--dir needs a path".to_string()),
        None => env::current_dir().map_err(|e| e.to_string()),
    }
}

fn run(args: &[String]) -> Result<(), String> {
    match args.first().map(String::as_str) {
        Some("identity") => println!("{}", wiggle_core::IDENTITY),
        Some("prompt") => {
            let text: Vec<&str> = args[1..]
                .iter()
                .take_while(|a| *a != "--dir")
                .map(String::as_str)
                .filter(|a| !a.trim().is_empty())
                .collect();
            if text.is_empty() {
                return Err("prompt needs text".into());
            }
            let dir = dir_arg(args)?;
            // Skills come from the project's .wiggle/skills and from the bundled-skills folder beside it.
            let mut skills = load_skills(&dir.join(".wiggle").join("skills"));
            skills.extend(load_skills(&dir.join("bundled-skills")));
            let compiled = compile(&context_for(&dir, &text.join(" "), skills));
            println!("{}\n\n--- user ---\n{}", compiled.system, compiled.user);
        }
        Some("skills") => {
            let dir = dir_arg(args)?;
            let skills = load_skills(&dir);
            if skills.is_empty() {
                println!("No skills found in {}", dir.display());
            }
            for skill in skills {
                println!("{}\t{}", skill.name, skill.description);
            }
        }
        Some("--version") | Some("-V") => println!("wiggle 0.1.0"),
        None | Some("--help") | Some("-h") => println!("{USAGE}"),
        Some(other) => return Err(format!("Unknown command: {other}. Run wiggle --help.")),
    }
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}
