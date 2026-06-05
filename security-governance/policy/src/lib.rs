use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Effect {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyDecision {
    pub effect: Effect,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PolicyRule {
    pub action: String,
    pub resource: String,
    pub effect: Effect,
}

#[derive(Debug, Clone, Default)]
pub struct PolicyEngine {
    rules: Vec<PolicyRule>,
}

impl PolicyEngine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn load_yaml(yaml: &str) -> Result<Self, PolicyError> {
        let rules: Vec<PolicyRule> = serde_yaml::from_str(yaml).map_err(PolicyError::Yaml)?;
        Ok(Self { rules })
    }

    pub fn evaluate(&self, action: &str, resource: &str) -> PolicyDecision {
        for rule in &self.rules {
            if rule.action == action && rule.resource == resource {
                return PolicyDecision {
                    effect: rule.effect.clone(),
                    reason: Some(format!("matched rule {}:{}", action, resource)),
                };
            }
        }
        PolicyDecision {
            effect: Effect::Deny,
            reason: Some("no matching rule".into()),
        }
    }
}

#[derive(Error, Debug)]
pub enum PolicyError {
    #[error("yaml: {0}")]
    Yaml(#[from] serde_yaml::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_matching_rule() {
        let yaml = r#"
- action: read
  resource: entity
  effect: allow
"#;
        let engine = PolicyEngine::load_yaml(yaml).unwrap();
        let d = engine.evaluate("read", "entity");
        assert_eq!(d.effect, Effect::Allow);
    }

    #[test]
    fn denies_unknown() {
        let engine = PolicyEngine::new();
        let d = engine.evaluate("write", "entity");
        assert_eq!(d.effect, Effect::Deny);
    }
}
