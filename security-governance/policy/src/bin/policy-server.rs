use daemon_policy::{Effect, PolicyEngine};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};

fn handle(mut stream: TcpStream, engine: &PolicyEngine) {
    let mut buf = String::new();
    let _ = stream.read_to_string(&mut buf);
    let req: serde_json::Value = serde_json::from_str(&buf).unwrap_or_default();
    let action = req["action"].as_str().unwrap_or("");
    let resource = req["resource"].as_str().unwrap_or("");
    let decision = engine.evaluate(action, resource);
    let effect = match decision.effect {
        Effect::Allow => "allow",
        Effect::Deny => "deny",
    };
    let body = serde_json::json!({ "effect": effect, "reason": decision.reason });
    let _ = writeln!(stream, "{}", body);
}

fn main() {
    let yaml = std::env::var("POLICY_RULES_YAML").unwrap_or_else(|_| {
        "- action: read\n  resource: entity\n  effect: allow\n- action: write\n  resource: entity\n  effect: allow\n".into()
    });
    let engine = PolicyEngine::load_yaml(&yaml).expect("policy rules");
    let addr = std::env::var("POLICY_ENGINE_ADDR").unwrap_or_else(|_| "127.0.0.1:8082".into());
    let listener = TcpListener::bind(&addr).expect("bind");
    eprintln!("policy-server on {}", addr);
    for stream in listener.incoming().flatten() {
        handle(stream, &engine);
    }
}
