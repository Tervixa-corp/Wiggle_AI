mod tui;

use clap::{Parser, Subcommand};
use std::path::PathBuf;
use wiggle_core::{
    agents::{AgentRole, SwarmOrchestrator, SwarmTaskInput},
    config::{builtin_provider_presets, WiggleConfig},
    identity::{IdentityGuard, TERVIXA_WIGGLE_IDENTITY},
    mcp::McpConfigFile,
    plugins::hooks::HookRunner,
    prompt_compiler::PromptCompiler,
    skills::{importer, SkillRegistry},
    undo::SnapshotEngine,
};
use wiggle_memory::{MemoryCategory, MemoryStore};

#[derive(Parser)]
#[command(
    name = "wiggle",
    version = "1.0.0",
    about = "Tervixa Wiggle CLI & TUI — Autonomous AI Software Engineering Agent by Tervixa Corporation"
)]
struct Cli {
    #[arg(long, default_value = ".")]
    workspace: PathBuf,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Print Tervixa Wiggle immutable identity directive
    Identity,
    /// Launch the minimal monochrome terminal workbench (Ratatui TUI)
    Tui,
    /// Compile and inspect the 7-stage prompt pipeline for a query
    Compile { prompt: String },
    /// Execute a parallel multi-agent swarm task on the active workspace
    Swarm { goal: String },
    /// List or import SKILL.md packages
    Skills {
        #[arg(long)]
        import_claude: bool,
        #[arg(long)]
        import_opencode: bool,
    },
    /// Inspect configured MCP servers
    Mcp,
    /// Query or add entries to personal memory
    Memory {
        #[arg(long)]
        query: Option<String>,
        #[arg(long)]
        add: Option<String>,
    },
    /// Roll back the last file mutation snapshot
    Undo,
    /// Re-apply the last undone snapshot
    Redo,
    /// List built-in BYOK & local model provider presets
    Providers,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let workspace = std::fs::canonicalize(&cli.workspace).unwrap_or(cli.workspace);

    match cli.command {
        None | Some(Commands::Tui) => {
            tui::run_tui(&workspace).await?;
        }
        Some(Commands::Identity) => {
            println!("{TERVIXA_WIGGLE_IDENTITY}");
        }
        Some(Commands::Compile { prompt }) => {
            let skills = SkillRegistry::load_workspace(&workspace);
            let mem = MemoryStore::open(workspace.join(".wiggle").join("memory.db")).ok();
            let identity = IdentityGuard::for_workspace(workspace.to_string_lossy(), None);
            let compiled = PromptCompiler::compile(
                &workspace,
                &prompt,
                &identity,
                mem.as_ref(),
                &skills,
                &[],
                &HookRunner::default(),
            )
            .await;
            println!("{}", serde_json::to_string_pretty(&compiled)?);
        }
        Some(Commands::Swarm { goal }) => {
            let cfg = WiggleConfig::load_merged(&workspace);
            let identity = IdentityGuard::for_workspace(workspace.to_string_lossy(), None);
            let orchestrator = SwarmOrchestrator::new(&workspace);
            let tasks = vec![
                SwarmTaskInput { id: "t1".into(), role: AgentRole::Explorer, goal: format!("Explore codebase for: {goal}") },
                SwarmTaskInput { id: "t2".into(), role: AgentRole::Architect, goal: format!("Design implementation plan for: {goal}") },
                SwarmTaskInput { id: "t3".into(), role: AgentRole::Reviewer, goal: format!("Prepare risk & test checklist for: {goal}") },
            ];
            let results = orchestrator
                .execute_parallel(&cfg, &identity.build_header(), tasks, HookRunner::default())
                .await;
            println!("{}", serde_json::to_string_pretty(&results)?);
        }
        Some(Commands::Skills {
            import_claude,
            import_opencode,
        }) => {
            let target = dirs::home_dir()
                .map(|h| h.join(".wiggle").join("skills"))
                .unwrap_or_else(|| workspace.join(".wiggle").join("skills"));
            if import_claude {
                if let Some(src) = importer::default_claude_skills_dir() {
                    let res = importer::import_skills_from_dir(&src, &target, "claude")?;
                    println!("Imported {} Claude skills: {:?}", res.imported_count, res.imported_names);
                }
            }
            if import_opencode {
                if let Some(src) = importer::default_opencode_skills_dir() {
                    let res = importer::import_skills_from_dir(&src, &target, "opencode")?;
                    println!("Imported {} OpenCode skills: {:?}", res.imported_count, res.imported_names);
                }
            }
            let reg = SkillRegistry::load_workspace(&workspace);
            for s in reg.all() {
                println!("- {} [{}]: {}", s.name, s.source, s.description);
            }
        }
        Some(Commands::Mcp) => {
            let cfg = McpConfigFile::load_from(&workspace.join(".wiggle").join("mcp.json"));
            println!("{}", serde_json::to_string_pretty(&cfg)?);
        }
        Some(Commands::Memory { query, add }) => {
            let store = MemoryStore::open(workspace.join(".wiggle").join("memory.db"))?;
            if let Some(fact) = add {
                let entry = store.upsert_fact(MemoryCategory::Fact, &fact, vec!["cli".into()], None, true, 0.9)?;
                println!("Stored memory {}: {}", entry.id, entry.content);
            } else if let Some(q) = query {
                let hits = store.query_relevant_context(&q, 10)?;
                for h in hits {
                    println!("[{:.2}] ({}) {}", h.score, h.entry.category.as_str(), h.entry.content);
                }
            } else {
                for e in store.list_all(50)? {
                    println!("- [{}] {}", e.category.as_str(), e.content);
                }
            }
        }
        Some(Commands::Undo) => {
            let rec = SnapshotEngine::new(&workspace).undo()?;
            println!("Undid snapshot {} ({} files)", rec.id, rec.files.len());
        }
        Some(Commands::Redo) => {
            let rec = SnapshotEngine::new(&workspace).redo()?;
            println!("Redid snapshot {} ({} files)", rec.id, rec.files.len());
        }
        Some(Commands::Providers) => {
            for p in builtin_provider_presets() {
                println!("{:<12} | {:<28} | {} | {}", p.id, p.name, p.default_model, p.base_url);
            }
        }
    }

    Ok(())
}
