use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("toml parse error: {0}")]
    TomlParse(#[from] toml::de::Error),
    #[error("toml serialize error: {0}")]
    TomlSerialize(#[from] toml::ser::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderProtocol {
    Anthropic,
    OpenAiCompat,
    Gemini,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderPreset {
    pub id: String,
    pub name: String,
    pub protocol: ProviderProtocol,
    pub base_url: String,
    pub env_key: String,
    pub default_model: String,
    pub local: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleModelBinding {
    pub orchestrator: Option<String>,
    pub coder: Option<String>,
    pub explorer: Option<String>,
    pub browser: Option<String>,
    pub reviewer: Option<String>,
    pub memory_extractor: Option<String>,
}

impl Default for RoleModelBinding {
    fn default() -> Self {
        Self {
            orchestrator: None,
            coder: None,
            explorer: None,
            browser: None,
            reviewer: None,
            memory_extractor: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalMode {
    Suggest,
    AutoEdit,
    FullAuto,
}

impl Default for ApprovalMode {
    fn default() -> Self {
        Self::Suggest
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WiggleConfig {
    pub active_provider: String,
    pub active_model: String,
    pub base_url: Option<String>,
    #[serde(default)]
    pub api_keys: HashMap<String, String>,
    #[serde(default)]
    pub role_models: RoleModelBinding,
    #[serde(default)]
    pub approval_mode: ApprovalMode,
    #[serde(default = "default_max_swarm")]
    pub max_parallel_agents: usize,
    #[serde(default)]
    pub custom_identity_instructions: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_true")]
    pub memory_auto_extract: bool,
    #[serde(default = "default_true")]
    pub browser_headless: bool,
    #[serde(default)]
    pub shell_allowlist: Vec<String>,
}

fn default_max_swarm() -> usize {
    4
}
fn default_theme() -> String {
    "dark".to_string()
}
fn default_true() -> bool {
    true
}

impl Default for WiggleConfig {
    fn default() -> Self {
        Self {
            active_provider: "openai".to_string(),
            active_model: std::env::var("WIGGLE_MODEL").unwrap_or_else(|_| "gpt-4.1".to_string()),
            base_url: std::env::var("WIGGLE_BASE_URL").ok(),
            api_keys: HashMap::new(),
            role_models: RoleModelBinding::default(),
            approval_mode: ApprovalMode::Suggest,
            max_parallel_agents: 4,
            custom_identity_instructions: String::new(),
            theme: "dark".to_string(),
            memory_auto_extract: true,
            browser_headless: true,
            shell_allowlist: vec![
                "git status".into(),
                "git diff".into(),
                "cargo test".into(),
                "npm test".into(),
                "npm run build".into(),
                "ls".into(),
            ],
        }
    }
}

impl WiggleConfig {
    pub fn global_path() -> Option<PathBuf> {
        dirs::home_dir().map(|h| h.join(".wiggle").join("config.toml"))
    }

    pub fn project_path(workspace: &Path) -> PathBuf {
        workspace.join(".wiggle").join("config.toml")
    }

    pub fn load_merged(workspace: &Path) -> Self {
        let mut cfg = Self::default();
        if let Some(global) = Self::global_path() {
            if let Ok(raw) = std::fs::read_to_string(global) {
                if let Ok(parsed) = toml::from_str::<WiggleConfig>(&raw) {
                    cfg = parsed;
                }
            }
        }
        let proj = Self::project_path(workspace);
        if let Ok(raw) = std::fs::read_to_string(proj) {
            if let Ok(parsed) = toml::from_str::<WiggleConfig>(&raw) {
                cfg = parsed;
            }
        }
        if let Ok(model) = std::env::var("WIGGLE_MODEL") {
            if !model.trim().is_empty() {
                cfg.active_model = model;
            }
        }
        if let Ok(base) = std::env::var("WIGGLE_BASE_URL") {
            if !base.trim().is_empty() {
                cfg.base_url = Some(base);
            }
        }
        cfg
    }

    pub fn save_to(&self, path: &Path) -> Result<(), ConfigError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let toml_str = toml::to_string_pretty(self)?;
        std::fs::write(path, toml_str)?;
        Ok(())
    }

    pub fn resolve_api_key(&self, provider_id: &str) -> Option<String> {
        if let Some(k) = self.api_keys.get(provider_id).filter(|v| !v.trim().is_empty()) {
            return Some(k.clone());
        }
        if let Ok(k) = std::env::var("WIGGLE_API_KEY") {
            if !k.trim().is_empty() {
                return Some(k);
            }
        }
        if let Some(preset) = builtin_provider_presets().into_iter().find(|p| p.id == provider_id) {
            if !preset.env_key.is_empty() {
                if let Ok(v) = std::env::var(&preset.env_key) {
                    if !v.trim().is_empty() {
                        return Some(v);
                    }
                }
            }
        }
        None
    }
}

/// Built-in BYOK + local provider presets (plus dynamic Models.dev 200+ gateway support).
pub fn builtin_provider_presets() -> Vec<ProviderPreset> {
    vec![
        ProviderPreset { id: "anthropic".into(), name: "Anthropic".into(), protocol: ProviderProtocol::Anthropic, base_url: "https://api.anthropic.com/v1".into(), env_key: "ANTHROPIC_API_KEY".into(), default_model: "claude-sonnet-4-5".into(), local: false },
        ProviderPreset { id: "openai".into(), name: "OpenAI / Codex".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "https://api.openai.com/v1".into(), env_key: "OPENAI_API_KEY".into(), default_model: "gpt-4.1".into(), local: false },
        ProviderPreset { id: "gemini".into(), name: "Google Gemini".into(), protocol: ProviderProtocol::Gemini, base_url: "https://generativelanguage.googleapis.com/v1beta".into(), env_key: "GEMINI_API_KEY".into(), default_model: "gemini-2.5-pro".into(), local: false },
        ProviderPreset { id: "openrouter".into(), name: "OpenRouter".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "https://openrouter.ai/api/v1".into(), env_key: "OPENROUTER_API_KEY".into(), default_model: "anthropic/claude-sonnet-4.5".into(), local: false },
        ProviderPreset { id: "modelsdev".into(), name: "Models.dev (200+ Registry)".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "https://models.dev/api/v1".into(), env_key: "MODELSDEV_API_KEY".into(), default_model: "auto".into(), local: false },
        ProviderPreset { id: "deepseek".into(), name: "DeepSeek".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "https://api.deepseek.com/v1".into(), env_key: "DEEPSEEK_API_KEY".into(), default_model: "deepseek-reasoner".into(), local: false },
        ProviderPreset { id: "zhipu".into(), name: "Zhipu GLM".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "https://open.bigmodel.cn/api/paas/v4".into(), env_key: "ZHIPU_API_KEY".into(), default_model: "glm-4-plus".into(), local: false },
        ProviderPreset { id: "mistral".into(), name: "Mistral AI".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "https://api.mistral.ai/v1".into(), env_key: "MISTRAL_API_KEY".into(), default_model: "codestral-latest".into(), local: false },
        ProviderPreset { id: "qwen".into(), name: "Alibaba Qwen".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1".into(), env_key: "DASHSCOPE_API_KEY".into(), default_model: "qwen3-coder-plus".into(), local: false },
        ProviderPreset { id: "minimax".into(), name: "MiniMax".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "https://api.minimax.chat/v1".into(), env_key: "MINIMAX_API_KEY".into(), default_model: "MiniMax-M1".into(), local: false },
        ProviderPreset { id: "moonshot".into(), name: "Moonshot Kimi".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "https://api.moonshot.ai/v1".into(), env_key: "MOONSHOT_API_KEY".into(), default_model: "kimi-k2".into(), local: false },
        ProviderPreset { id: "groq".into(), name: "Groq".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "https://api.groq.com/openai/v1".into(), env_key: "GROQ_API_KEY".into(), default_model: "llama-3.3-70b-versatile".into(), local: false },
        ProviderPreset { id: "together".into(), name: "Together AI".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "https://api.together.xyz/v1".into(), env_key: "TOGETHER_API_KEY".into(), default_model: "Qwen/Qwen2.5-Coder-32B-Instruct".into(), local: false },
        ProviderPreset { id: "fireworks".into(), name: "Fireworks AI".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "https://api.fireworks.ai/inference/v1".into(), env_key: "FIREWORKS_API_KEY".into(), default_model: "accounts/fireworks/models/deepseek-v3".into(), local: false },
        ProviderPreset { id: "cerebras".into(), name: "Cerebras".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "https://api.cerebras.ai/v1".into(), env_key: "CEREBRAS_API_KEY".into(), default_model: "qwen-3-32b".into(), local: false },
        ProviderPreset { id: "xai".into(), name: "xAI Grok".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "https://api.x.ai/v1".into(), env_key: "XAI_API_KEY".into(), default_model: "grok-3".into(), local: false },
        ProviderPreset { id: "cohere".into(), name: "Cohere".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "https://api.cohere.com/compatibility/v1".into(), env_key: "COHERE_API_KEY".into(), default_model: "command-a-03-2025".into(), local: false },
        ProviderPreset { id: "perplexity".into(), name: "Perplexity".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "https://api.perplexity.ai".into(), env_key: "PERPLEXITY_API_KEY".into(), default_model: "sonar-pro".into(), local: false },
        ProviderPreset { id: "omniroute".into(), name: "OmniRoute / LiteLLM Gateway".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "http://127.0.0.1:4000/v1".into(), env_key: "OMNIROUTE_API_KEY".into(), default_model: "default".into(), local: true },
        ProviderPreset { id: "ollama".into(), name: "Ollama (Local)".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "http://127.0.0.1:11434/v1".into(), env_key: "".into(), default_model: "qwen2.5-coder:14b".into(), local: true },
        ProviderPreset { id: "lmstudio".into(), name: "LM Studio (Local)".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "http://127.0.0.1:1234/v1".into(), env_key: "".into(), default_model: "local-model".into(), local: true },
        ProviderPreset { id: "llamacpp".into(), name: "llama.cpp Server (Local)".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "http://127.0.0.1:8080/v1".into(), env_key: "".into(), default_model: "local-gguf".into(), local: true },
        ProviderPreset { id: "vllm".into(), name: "vLLM (Local)".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "http://127.0.0.1:8000/v1".into(), env_key: "".into(), default_model: "local-vllm".into(), local: true },
        ProviderPreset { id: "colibri".into(), name: "Colibri (Local)".into(), protocol: ProviderProtocol::OpenAiCompat, base_url: "http://127.0.0.1:8899/v1".into(), env_key: "".into(), default_model: "colibri-local".into(), local: true },
    ]
}
