pub mod antigravity_cli;
pub mod api_chat;
pub mod claude_cli;
pub mod cli_common;
pub mod codex_cli;
pub mod copilot_cli;
pub mod vibe_cli;

pub use antigravity_cli::AntigravityCliProvider;
pub use api_chat::{ApiChatProvider, ApiFlavor};
pub use claude_cli::ClaudeCliProvider;
pub use codex_cli::CodexCliProvider;
pub use copilot_cli::CopilotCliProvider;
pub use vibe_cli::VibeCliProvider;

use std::collections::HashMap;
use std::sync::Arc;
use super::AgentProvider;

pub struct ProviderRegistry {
    map: HashMap<String, Arc<dyn AgentProvider>>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        let mut map: HashMap<String, Arc<dyn AgentProvider>> = HashMap::new();
        map.insert("claude-code-cli".into(), Arc::new(ClaudeCliProvider));
        map.insert("codex-cli".into(), Arc::new(CodexCliProvider));
        map.insert("copilot-cli".into(), Arc::new(CopilotCliProvider));
        map.insert("antigravity-cli".into(), Arc::new(AntigravityCliProvider));
        map.insert("mistral-vibe".into(), Arc::new(VibeCliProvider));
        map.insert("anthropic".into(), Arc::new(ApiChatProvider {
            flavor: ApiFlavor::Anthropic,
            default_base_url: "https://api.anthropic.com",
            requires_key: true,
        }));
        map.insert("openai".into(), Arc::new(ApiChatProvider {
            flavor: ApiFlavor::OpenAiCompatible,
            default_base_url: "https://api.openai.com/v1",
            requires_key: true,
        }));
        map.insert("mistral".into(), Arc::new(ApiChatProvider {
            flavor: ApiFlavor::OpenAiCompatible,
            default_base_url: "https://api.mistral.ai/v1",
            requires_key: true,
        }));
        map.insert("gemini".into(), Arc::new(ApiChatProvider {
            flavor: ApiFlavor::Gemini,
            default_base_url: "https://generativelanguage.googleapis.com",
            requires_key: true,
        }));
        map.insert("ollama".into(), Arc::new(ApiChatProvider {
            flavor: ApiFlavor::OpenAiCompatible,
            default_base_url: "http://localhost:11434/v1",
            requires_key: false,
        }));
        Self { map }
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn AgentProvider>> {
        self.map.get(id).cloned()
    }
}
