use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph, Wrap},
    Terminal,
};
use std::io;
use std::path::Path;
use wiggle_core::{
    config::WiggleConfig,
    identity::IdentityGuard,
    plugins::hooks::HookRunner,
    prompt_compiler::PromptCompiler,
    providers::{ChatMessage, MessageRole, ProviderRouter},
    skills::SkillRegistry,
    undo::SnapshotEngine,
};
use wiggle_memory::{MemoryExtractor, MemoryStore};

pub async fn run_tui(workspace: &Path) -> anyhow::Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let cfg = WiggleConfig::load_merged(workspace);
    let skills = SkillRegistry::load_workspace(workspace);
    let snapshots = SnapshotEngine::new(workspace);
    let mem_path = workspace.join(".wiggle").join("memory.db");
    let memory = MemoryStore::open(&mem_path).ok();

    let mut input = String::new();
    let mut transcript: Vec<(String, String)> = vec![(
        "Wiggle".into(),
        format!(
            "Tervixa Wiggle v1.0.0 ready in {}. Provider: {} ({}). Type a prompt or /undo, /redo, /skills, /quit.",
            workspace.display(),
            cfg.active_provider,
            cfg.active_model
        ),
    )];

    loop {
        let (undo_cnt, redo_cnt) = snapshots.counts();
        terminal.draw(|f| {
            let chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Length(3),
                    Constraint::Min(8),
                    Constraint::Length(4),
                    Constraint::Length(1),
                ])
                .split(f.area());

            let header = Paragraph::new(Line::from(vec![
                Span::styled(" TERVIXA WIGGLE ", Style::default().fg(Color::White).add_modifier(Modifier::BOLD)),
                Span::styled(
                    format!("| {} | {} | Skills: {} | Undo: {}/{}", cfg.active_provider, cfg.active_model, skills.all().len(), undo_cnt, redo_cnt),
                    Style::default().fg(Color::DarkGray),
                ),
            ]))
            .block(Block::default().borders(Borders::ALL).border_style(Style::default().fg(Color::DarkGray)));
            f.render_widget(header, chunks[0]);

            let items: Vec<ListItem> = transcript
                .iter()
                .map(|(who, text)| {
                    ListItem::new(vec![
                        Line::from(Span::styled(
                            format!("[{who}]"),
                            Style::default().fg(if who == "You" { Color::Gray } else { Color::White }).add_modifier(Modifier::BOLD),
                        )),
                        Line::from(Span::styled(text.clone(), Style::default().fg(Color::Gray))),
                        Line::from(""),
                    ])
                })
                .collect();
            let log = List::new(items)
                .block(Block::default().title(" Session ").borders(Borders::ALL).border_style(Style::default().fg(Color::DarkGray)));
            f.render_widget(log, chunks[1]);

            let prompt_box = Paragraph::new(input.as_str())
                .wrap(Wrap { trim: false })
                .block(Block::default().title(" Prompt (Enter send, Esc/Ctrl+C quit) ").borders(Borders::ALL).border_style(Style::default().fg(Color::Gray)));
            f.render_widget(prompt_box, chunks[2]);

            let footer = Paragraph::new(" Mode: Agent | /undo | /redo | /skills | /quit")
                .style(Style::default().fg(Color::DarkGray));
            f.render_widget(footer, chunks[3]);
        })?;

        if event::poll(std::time::Duration::from_millis(80))? {
            if let Event::Key(key) = event::read()? {
                if key.code == KeyCode::Esc
                    || (key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL))
                {
                    break;
                }
                match key.code {
                    KeyCode::Char(c) => input.push(c),
                    KeyCode::Backspace => {
                        input.pop();
                    }
                    KeyCode::Enter => {
                        let cmd = input.trim().to_string();
                        input.clear();
                        if cmd.is_empty() {
                            continue;
                        }
                        if cmd == "/quit" || cmd == "/exit" {
                            break;
                        }
                        transcript.push(("You".into(), cmd.clone()));
                        if cmd == "/undo" {
                            match snapshots.undo() {
                                Ok(rec) => transcript.push(("Wiggle".into(), format!("Undid snapshot '{}' ({} files).", rec.label, rec.files.len()))),
                                Err(e) => transcript.push(("Wiggle".into(), e.to_string())),
                            }
                            continue;
                        }
                        if cmd == "/redo" {
                            match snapshots.redo() {
                                Ok(rec) => transcript.push(("Wiggle".into(), format!("Redid snapshot '{}'.", rec.label))),
                                Err(e) => transcript.push(("Wiggle".into(), e.to_string())),
                            }
                            continue;
                        }
                        if cmd == "/skills" {
                            let names: Vec<String> = skills.all().iter().map(|s| s.name.clone()).collect();
                            transcript.push(("Wiggle".into(), format!("Loaded skills: {}", names.join(", "))));
                            continue;
                        }

                        let identity = IdentityGuard::for_workspace(workspace.to_string_lossy(), None);
                        let hooks = HookRunner::default();
                        let compiled = PromptCompiler::compile(
                            workspace,
                            &cmd,
                            &identity,
                            memory.as_ref(),
                            &skills,
                            &[],
                            &hooks,
                        )
                        .await;

                        match ProviderRouter::build_provider(&cfg, None) {
                            Ok(provider) => {
                                let req = wiggle_core::providers::LlmRequest {
                                    model: cfg.active_model.clone(),
                                    system_prompt: compiled.system_prompt,
                                    messages: vec![ChatMessage {
                                        role: MessageRole::User,
                                        content: compiled.user_prompt.clone(),
                                        tool_call_id: None,
                                        tool_calls: vec![],
                                    }],
                                    tools: compiled.tools,
                                    temperature: Some(0.2),
                                    max_tokens: Some(2048),
                                    extended_thinking: false,
                                };
                                match provider.complete(&req).await {
                                    Ok(resp) => {
                                        if let Some(mem) = &memory {
                                            let _ = MemoryExtractor::record_turn(mem, "tui", &cmd, &resp.content);
                                        }
                                        transcript.push(("Wiggle".into(), resp.content));
                                    }
                                    Err(e) => transcript.push(("Wiggle".into(), format!("Provider error: {e}"))),
                                }
                            }
                            Err(e) => {
                                transcript.push(("Wiggle".into(), format!("7-stage prompt compiled (memories={}, skills={:?}). Configure an API key to send: {e}", compiled.injected_memories, compiled.matched_skills)));
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    Ok(())
}
