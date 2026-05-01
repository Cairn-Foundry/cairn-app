pub mod claude_cli;

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
        Self { map }
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn AgentProvider>> {
        self.map.get(id).cloned()
    }
}
