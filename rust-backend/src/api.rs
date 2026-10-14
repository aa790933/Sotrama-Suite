//! Bounded, database-independent HTTPS requests for ERPNext and error telemetry.
//! The protocol is newline-delimited JSON; stdout contains protocol frames only.

use std::collections::BTreeMap;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{Client, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tokio::io::{AsyncBufRead, AsyncWriteExt, BufReader, Stdout};
use tokio::sync::{Mutex, Semaphore};
use tracing::warn;

const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 12 * 1024 * 1024;
const MAX_HEADERS: usize = 64;
const MAX_CONCURRENT_REQUESTS: usize = 32;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ApiRequest {
    id: u64,
    #[serde(default)]
    purpose: ApiPurpose,
    endpoint: String,
    #[serde(default)]
    options: RequestOptions,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ApiPurpose {
    #[default]
    Erpnext,
    Telemetry,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestOptions {
    method: Option<String>,
    headers: Option<BTreeMap<String, String>>,
    body: Option<String>,
}

#[derive(Serialize)]
struct ApiResponse {
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ApiWireError>,
}

#[derive(Serialize)]
struct ApiWireError {
    message: &'static str,
}

pub async fn serve() -> std::io::Result<()> {
    let client = Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        // Prevent an allowed integration endpoint redirecting credentials or
        // request bodies to a different host or an unapproved path.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(std::io::Error::other)?;

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let stdout = Arc::new(Mutex::new(tokio::io::stdout()));
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_REQUESTS));
    let mut line = Vec::new();

    while let Some(oversized) = read_bounded_line(&mut reader, &mut line).await? {
        if oversized {
            warn!("rejecting oversized HTTPS request frame");
            continue;
        }
        if line.iter().all(|byte| byte.is_ascii_whitespace()) {
            continue;
        }

        let raw: Value = match serde_json::from_slice(&line) {
            Ok(value) => value,
            Err(_) => {
                warn!("ignoring malformed HTTPS request frame");
                continue;
            }
        };
        let Some(id) = raw.get("id").and_then(Value::as_u64) else {
            warn!("ignoring ERPNext API request without a valid ID");
            continue;
        };
        let request = match serde_json::from_value::<ApiRequest>(raw) {
            Ok(request) => request,
            Err(_) => {
                write_response(
                    &stdout,
                    ApiResponse {
                        id,
                        result: None,
                        error: Some(ApiWireError {
                            message: "Invalid API request",
                        }),
                    },
                )
                .await?;
                continue;
            }
        };
        // Acquire before spawning so queued tasks are bounded too, not just
        // active HTTP requests. Backpressure stdin while all slots are busy.
        let permit = match semaphore.clone().acquire_owned().await {
            Ok(permit) => permit,
            Err(_) => {
                write_response(
                    &stdout,
                    ApiResponse {
                        id: request.id,
                        result: None,
                        error: Some(ApiWireError {
                            message: "HTTPS service is shutting down",
                        }),
                    },
                )
                .await?;
                continue;
            }
        };
        let client = client.clone();
        let stdout = stdout.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let response = match execute(&client, request).await {
                Ok((id, value)) => ApiResponse {
                    id,
                    result: Some(value),
                    error: None,
                },
                Err((id, message)) => ApiResponse {
                    id,
                    result: None,
                    error: Some(ApiWireError { message }),
                },
            };
            if let Err(error) = write_response(&stdout, response).await {
                warn!("could not write ERPNext API response: {error}");
            }
        });
    }
    Ok(())
}

async fn write_response(stdout: &Mutex<Stdout>, response: ApiResponse) -> std::io::Result<()> {
    let encoded = serde_json::to_vec(&response).map_err(std::io::Error::other)?;
    let mut stdout = stdout.lock().await;
    stdout.write_all(&encoded).await?;
    stdout.write_all(b"\n").await?;
    stdout.flush().await
}

async fn execute(
    client: &Client,
    request: ApiRequest,
) -> Result<(u64, Value), (u64, &'static str)> {
    let id = request.id;
    let url =
        validate_endpoint(&request.endpoint, request.purpose).map_err(|message| (id, message))?;
    let method = match request.options.method.as_deref().unwrap_or("GET") {
        "GET" => Method::GET,
        "POST" => Method::POST,
        _ => return Err((id, "Unsupported API request method")),
    };
    if request
        .options
        .body
        .as_ref()
        .is_some_and(|body| body.len() > MAX_BODY_BYTES)
    {
        return Err((id, "API request body exceeds the 4 MiB limit"));
    }
    if method == Method::GET && request.options.body.is_some() {
        return Err((id, "GET API requests cannot include a body"));
    }
    if request.purpose == ApiPurpose::Telemetry && method != Method::POST {
        return Err((id, "Telemetry requests must use POST"));
    }

    let mut headers = HeaderMap::new();
    if let Some(values) = request.options.headers {
        if values.len() > MAX_HEADERS {
            return Err((id, "API request has too many headers"));
        }
        let mut header_bytes = 0_usize;
        for (name, value) in values {
            let name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| (id, "Invalid API request header"))?;
            if matches!(
                name.as_str(),
                "host"
                    | "content-length"
                    | "connection"
                    | "transfer-encoding"
                    | "proxy-authorization"
            ) {
                return Err((id, "API request contains a restricted header"));
            }
            let current_header_bytes = name.as_str().len().saturating_add(value.len());
            header_bytes = header_bytes.saturating_add(current_header_bytes);
            if current_header_bytes > 16 * 1024 || header_bytes > 64 * 1024 {
                return Err((id, "API request headers exceed the size limit"));
            }
            let value =
                HeaderValue::from_str(&value).map_err(|_| (id, "Invalid API request header"))?;
            headers.insert(name, value);
        }
    }
    if request.purpose == ApiPurpose::Telemetry
        && headers
            .get("authorization")
            .is_none_or(|value| value.as_bytes().is_empty())
    {
        return Err((id, "Telemetry requests require an authorization header"));
    }

    let mut builder = client.request(method, url).headers(headers);
    if let Some(body) = request.options.body {
        builder = builder.body(body);
    }
    let mut response = builder
        .send()
        .await
        .map_err(|_| (id, "HTTPS request failed or timed out"))?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err((id, "HTTPS response exceeds the 12 MiB limit"));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| (id, "Could not read HTTPS response"))?
    {
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err((id, "HTTPS response exceeds the 12 MiB limit"));
        }
        body.extend_from_slice(&chunk);
    }
    let value = match request.purpose {
        ApiPurpose::Erpnext => {
            serde_json::from_slice(&body).map_err(|_| (id, "ERPNext API returned invalid JSON"))?
        }
        // The legacy error reporter only awaited fetch and intentionally did
        // not parse the response body or reject non-2xx status codes.
        ApiPurpose::Telemetry => Value::Null,
    };
    Ok((id, value))
}

fn validate_endpoint(endpoint: &str, purpose: ApiPurpose) -> Result<Url, &'static str> {
    let url = Url::parse(endpoint).map_err(|_| "Invalid ERPNext API URL")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("HTTPS requests require a valid HTTPS URL");
    }
    if purpose == ApiPurpose::Erpnext
        && !url.path().starts_with("/api/method/books_integration.api.")
    {
        return Err("ERPNext API endpoint is not allowed");
    }
    if url.fragment().is_some() {
        return Err("ERPNext API URL fragments are not allowed");
    }
    Ok(url)
}

async fn read_bounded_line<R>(reader: &mut R, line: &mut Vec<u8>) -> std::io::Result<Option<bool>>
where
    R: AsyncBufRead + Unpin,
{
    line.clear();
    let mut read_any = false;
    let mut oversized = false;
    loop {
        let (consumed, ended) = {
            let available = reader.fill_buf().await?;
            if available.is_empty() {
                return Ok(if read_any { Some(oversized) } else { None });
            }
            let newline = available.iter().position(|byte| *byte == b'\n');
            let consumed = newline.map_or(available.len(), |index| index + 1);
            let content_len = newline.unwrap_or(consumed);
            if !oversized {
                if content_len > MAX_REQUEST_BYTES.saturating_sub(line.len()) {
                    line.clear();
                    oversized = true;
                } else {
                    line.extend_from_slice(&available[..content_len]);
                }
            }
            (consumed, newline.is_some())
        };
        reader.consume(consumed);
        read_any = true;
        if ended {
            return Ok(Some(oversized));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_endpoint, ApiPurpose};

    #[test]
    fn endpoint_requires_https_and_the_exact_integration_path() {
        assert!(validate_endpoint(
            "https://erp.example/api/method/books_integration.api.sync",
            ApiPurpose::Erpnext
        )
        .is_ok());
        assert!(validate_endpoint(
            "http://erp.example/api/method/books_integration.api.sync",
            ApiPurpose::Erpnext
        )
        .is_err());
        assert!(validate_endpoint(
            "https://erp.example/other/api/method/books_integration.api.sync",
            ApiPurpose::Erpnext
        )
        .is_err());
        assert!(validate_endpoint(
            "https://user:secret@erp.example/api/method/books_integration.api.sync",
            ApiPurpose::Erpnext
        )
        .is_err());
        assert!(validate_endpoint(
            "https://erp.example/api/method/books_integration.api.sync#fragment",
            ApiPurpose::Erpnext
        )
        .is_err());
        assert!(validate_endpoint("https://logs.example/submit", ApiPurpose::Telemetry).is_ok());
        assert!(validate_endpoint("http://logs.example/submit", ApiPurpose::Telemetry).is_err());
    }
}
