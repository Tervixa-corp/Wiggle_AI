use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

#[derive(Debug, Error)]
pub enum TransportError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("mcp protocol error ({code}): {message}")]
    Rpc { code: i64, message: String },
    #[error("transport closed")]
    Closed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Option<u64>,
    pub result: Option<serde_json::Value>,
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
}

#[async_trait]
pub trait McpTransport: Send + Sync {
    async fn request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, TransportError>;
    async fn notify(&self, method: &str, params: Option<serde_json::Value>) -> Result<(), TransportError>;
}

pub struct StdioTransport {
    next_id: AtomicU64,
    _child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    stdout: Arc<Mutex<BufReader<ChildStdout>>>,
}

impl StdioTransport {
    pub fn spawn(
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
    ) -> Result<Self, TransportError> {
        let mut cmd = Command::new(command);
        cmd.args(args)
            .envs(env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = cmd.spawn()?;
        let stdin = child.stdin.take().ok_or(TransportError::Closed)?;
        let stdout = child.stdout.take().ok_or(TransportError::Closed)?;
        Ok(Self {
            next_id: AtomicU64::new(1),
            _child: Arc::new(Mutex::new(child)),
            stdin: Arc::new(Mutex::new(stdin)),
            stdout: Arc::new(Mutex::new(BufReader::new(stdout))),
        })
    }
}

#[async_trait]
impl McpTransport for StdioTransport {
    async fn request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, TransportError> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.to_string(),
            params,
        };
        let mut line = serde_json::to_string(&req)?;
        line.push('\n');

        {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(line.as_bytes()).await?;
            stdin.flush().await?;
        }

        let mut reader = self.stdout.lock().await;
        let mut buf = String::new();
        loop {
            buf.clear();
            let read = reader.read_line(&mut buf).await?;
            if read == 0 {
                return Err(TransportError::Closed);
            }
            let trimmed = buf.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(resp) = serde_json::from_str::<JsonRpcResponse>(trimmed) {
                if resp.id == Some(id) {
                    if let Some(err) = resp.error {
                        return Err(TransportError::Rpc {
                            code: err.code,
                            message: err.message,
                        });
                    }
                    return Ok(resp.result.unwrap_or(serde_json::Value::Null));
                }
            }
        }
    }

    async fn notify(&self, method: &str, params: Option<serde_json::Value>) -> Result<(), TransportError> {
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });
        let mut line = serde_json::to_string(&payload)?;
        line.push('\n');
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(line.as_bytes()).await?;
        stdin.flush().await?;
        Ok(())
    }
}

pub struct StreamableHttpTransport {
    client: Client,
    endpoint: String,
    headers: HashMap<String, String>,
    next_id: AtomicU64,
}

impl StreamableHttpTransport {
    pub fn new(endpoint: impl Into<String>, headers: HashMap<String, String>) -> Self {
        Self {
            client: Client::new(),
            endpoint: endpoint.into(),
            headers,
            next_id: AtomicU64::new(1),
        }
    }
}

#[async_trait]
impl McpTransport for StreamableHttpTransport {
    async fn request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, TransportError> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.to_string(),
            params,
        };
        let mut builder = self
            .client
            .post(&self.endpoint)
            .header("Accept", "application/json, text/event-stream");
        for (k, v) in &self.headers {
            builder = builder.header(k, v);
        }
        let resp = builder.json(&req).send().await?;
        let text = resp.text().await?;

        // Handle either plain JSON or SSE `data:` frame responses.
        let json_payload = text
            .lines()
            .filter_map(|l| l.strip_prefix("data:"))
            .map(str::trim)
            .last()
            .unwrap_or(text.trim());
        let parsed: JsonRpcResponse = serde_json::from_str(json_payload)?;
        if let Some(err) = parsed.error {
            return Err(TransportError::Rpc {
                code: err.code,
                message: err.message,
            });
        }
        Ok(parsed.result.unwrap_or(serde_json::Value::Null))
    }

    async fn notify(&self, method: &str, params: Option<serde_json::Value>) -> Result<(), TransportError> {
        let payload = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });
        let mut builder = self.client.post(&self.endpoint);
        for (k, v) in &self.headers {
            builder = builder.header(k, v);
        }
        let _ = builder.json(&payload).send().await?;
        Ok(())
    }
}

pub struct SseTransport {
    inner: StreamableHttpTransport,
}

impl SseTransport {
    pub fn new(endpoint: impl Into<String>, headers: HashMap<String, String>) -> Self {
        Self {
            inner: StreamableHttpTransport::new(endpoint, headers),
        }
    }
}

#[async_trait]
impl McpTransport for SseTransport {
    async fn request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, TransportError> {
        self.inner.request(method, params).await
    }

    async fn notify(&self, method: &str, params: Option<serde_json::Value>) -> Result<(), TransportError> {
        self.inner.notify(method, params).await
    }
}
