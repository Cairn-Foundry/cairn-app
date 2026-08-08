pub mod api_chat;
pub mod claude_cli;

pub use api_chat::{ApiChatProvider, ApiFlavor};
pub use claude_cli::ClaudeCliProvider;

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
