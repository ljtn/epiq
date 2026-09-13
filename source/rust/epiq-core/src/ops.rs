use serde_json::json;

/// Every answer is a JSON document. A failure is `{"error": "<message>"}`, so
/// the host maps it onto its own `Result` type without inspecting a status
/// code — the same shape whether the op was unknown or its input was not.
pub fn call(op: &str, input: &[u8]) -> Vec<u8> {
    let answer = match op {
        "ping" => ping(input),
        _ => Err(format!("unknown op: {op}")),
    };

    match answer {
        Ok(bytes) => bytes,
        Err(message) => serde_json::to_vec(&json!({ "error": message }))
            .expect("an error document serialises"),
    }
}

/// Round trip: proves the boundary carries bytes both ways intact, including
/// ones that grow the module's memory.
fn ping(input: &[u8]) -> Result<Vec<u8>, String> {
    let text = std::str::from_utf8(input).map_err(|e| format!("ping: {e}"))?;

    serde_json::to_vec(&json!({ "pong": text, "bytes": input.len() }))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_echoes_its_input() {
        let out = call("ping", b"hello");
        let doc: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(doc["pong"], "hello");
        assert_eq!(doc["bytes"], 5);
    }

    #[test]
    fn unknown_op_is_an_error_document() {
        let out = call("nope", b"");
        let doc: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(doc["error"], "unknown op: nope");
    }
}
