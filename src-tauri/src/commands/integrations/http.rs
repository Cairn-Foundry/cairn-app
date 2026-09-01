// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Authenticated HTTP client shared by the adapters: one per connection, with
//! redirects confined to the connection's host, capped pagination, an ETag
//! cache and the mapping of HTTP failures to `IntegrationError`.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use base64::Engine;
use reqwest::header::{HeaderMap, HeaderValue};
use reqwest::{Method, StatusCode};
use serde_json::Value;
use super::model::IntegrationError;

pub const MAX_PAGES: usize = 5;
pub const DEFAULT_PER_PAGE: u32 = 50;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_SAME_HOST_REDIRECTS: usize = 3;
const ERROR_BODY_MAX_CHARS: usize = 200;
/// How long a stored response stays usable as the body of a 304, and how many
/// of them a connection may hold. The key is the full URL with its query, so
/// pagination, filters and ticket ids each mint their own entry: without a
/// bound, a session polling a forge all day never stops growing.
const ETAG_TTL: Duration = Duration::from_secs(30 * 60);
const ETAG_MAX_ENTRIES: usize = 256;

#[derive(Clone)]
pub enum Auth {
    None,
    PrivateToken(String),
    Bearer(String),
    Basic { user: String, secret: String },
}

pub struct HttpResponse {
    pub status: u16,
    pub headers: HeaderMap,
    pub body: String,
}

pub struct HttpClient {
    client: reqwest::Client,
    api_base: String,
    auth: Auth,
    is_etag_enabled: bool,
    etags: Mutex<HashMap<String, EtagEntry>>,
}

struct EtagEntry {
    etag: String,
    body: Value,
    stored_at: Instant,
}

fn user_agent() -> String {
    format!("cairn/{}", env!("CARGO_PKG_VERSION"))
}

fn build_client() -> Result<reqwest::Client, IntegrationError> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(user_agent())
        .build()
        .map_err(|e| IntegrationError::network(e.to_string()))
}

pub fn host_of(url: &str) -> Option<String> {
    let rest = url.split_once("://").map(|(_, r)| r)?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?.split(':').next()?;
    if host.is_empty() { None } else { Some(host.to_ascii_lowercase()) }
}

fn resolve_location(current: &str, location: &str) -> String {
    if location.contains("://") {
        return location.to_string();
    }
    if let Some((scheme, rest)) = current.split_once("://") {
        let authority = rest.split('/').next().unwrap_or("");
        if location.starts_with('/') {
            return format!("{scheme}://{authority}{location}");
        }
        let base = current.rsplit_once('/').map(|(b, _)| b).unwrap_or(current);
        return format!("{base}/{location}");
    }
    location.to_string()
}

impl HttpClient {
    pub fn new(api_base: &str, auth: Auth, is_etag_enabled: bool) -> Result<Self, IntegrationError> {
        Ok(HttpClient {
            client: build_client()?,
            api_base: api_base.trim_end_matches('/').to_string(),
            auth,
            is_etag_enabled,
            etags: Mutex::new(HashMap::new()),
        })
    }

    /// Drops what expired, then the oldest entries until the cap holds. Run on
    /// insert only: a cache nobody writes to is a cache nobody has to sweep.
    fn evict_etags(map: &mut HashMap<String, EtagEntry>, incoming: &str) {
        map.retain(|_, entry| entry.stored_at.elapsed() < ETAG_TTL);
        let room = usize::from(!map.contains_key(incoming));
        while map.len() + room > ETAG_MAX_ENTRIES {
            let Some(oldest) = map
                .iter()
                .min_by_key(|(_, entry)| entry.stored_at)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            map.remove(&oldest);
        }
    }

    pub fn api_base(&self) -> &str {
        &self.api_base
    }

    pub fn url(&self, path: &str) -> String {
        if path.contains("://") {
            path.to_string()
        } else {
            format!("{}/{}", self.api_base, path.trim_start_matches('/'))
        }
    }

    fn apply_auth(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.auth {
            Auth::None => request,
            Auth::PrivateToken(token) => request.header("PRIVATE-TOKEN", token),
            Auth::Bearer(token) => request.bearer_auth(token),
            Auth::Basic { user, secret } => {
                let encoded = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{secret}"));
                request.header("Authorization", format!("Basic {encoded}"))
            }
        }
    }

    /// Sends the request, following redirects only while they stay on the
    /// connection's host: the token never travels anywhere else. A redirect to
    /// another host comes back as `Ok` with its 3xx status so callers that
    /// expect one (the GitHub job log) can follow it themselves without auth.
    pub async fn send(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<&Value>,
        extra_headers: &[(&str, String)],
    ) -> Result<HttpResponse, IntegrationError> {
        let mut url = self.url(path);
        let own_host = host_of(&self.api_base);
        for _ in 0..=MAX_SAME_HOST_REDIRECTS {
            if host_of(&url) != own_host {
                return Err(IntegrationError::provider(format!("Refusing to send credentials to {url}")));
            }
            let mut request = self.client.request(method.clone(), &url).query(query);
            request = self.apply_auth(request);
            request = request.header("Accept", "application/json");
            for (name, value) in extra_headers {
                request = request.header(*name, value);
            }
            if let Some(body) = body {
                request = request.json(body);
            }
            let response = request.send().await.map_err(|e| IntegrationError::network(e.to_string()))?;
            let status = response.status();
            let headers = response.headers().clone();
            if status.is_redirection() {
                let Some(location) = headers.get("location").and_then(|v| v.to_str().ok()) else {
                    return Err(IntegrationError::provider(format!("HTTP {status} without a Location header")));
                };
                let next = resolve_location(&url, location);
                if host_of(&next) != own_host {
                    return Ok(HttpResponse { status: status.as_u16(), headers, body: next });
                }
                url = next;
                continue;
            }
            let body = response.text().await.map_err(|e| IntegrationError::network(e.to_string()))?;
            return Ok(HttpResponse { status: status.as_u16(), headers, body });
        }
        Err(IntegrationError::provider("Too many redirects"))
    }

    async fn send_checked(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<&Value>,
    ) -> Result<HttpResponse, IntegrationError> {
        let response = self.send(method, path, query, body, &[]).await?;
        if response.status >= 300 {
            return Err(error_from_response(response.status, &response.headers, &response.body));
        }
        Ok(response)
    }

    pub async fn get_with_headers(&self, path: &str, query: &[(&str, String)]) -> Result<(Value, HeaderMap), IntegrationError> {
        let cache_key = format!("{}?{}", self.url(path), serde_urlencoded(query));
        let etag_header = if self.is_etag_enabled {
            self.etags
                .lock()
                .ok()
                .and_then(|m| m.get(&cache_key).map(|entry| ("If-None-Match", entry.etag.clone())))
        } else {
            None
        };
        let extra: Vec<(&str, String)> = etag_header.into_iter().collect();
        let response = self.send(Method::GET, path, query, None, &extra).await?;
        if response.status == StatusCode::NOT_MODIFIED.as_u16()
            && let Ok(mut map) = self.etags.lock()
            && let Some(entry) = map.get_mut(&cache_key)
        {
            // A confirmed entry is a live one: its age restarts here, so a key
            // polled all session long is never the one eviction picks.
            entry.stored_at = Instant::now();
            return Ok((entry.body.clone(), response.headers));
        }
        if response.status >= 300 {
            return Err(error_from_response(response.status, &response.headers, &response.body));
        }
        let value = parse_json_body(&response.body)?;
        if self.is_etag_enabled
            && let Some(etag) = response.headers.get("etag").and_then(|v| v.to_str().ok())
            && let Ok(mut map) = self.etags.lock()
        {
            Self::evict_etags(&mut map, &cache_key);
            map.insert(
                cache_key,
                EtagEntry { etag: etag.to_string(), body: value.clone(), stored_at: Instant::now() },
            );
        }
        Ok((value, response.headers))
    }

    pub async fn get_json(&self, path: &str, query: &[(&str, String)]) -> Result<Value, IntegrationError> {
        Ok(self.get_with_headers(path, query).await?.0)
    }

    pub async fn get_text(&self, path: &str, query: &[(&str, String)]) -> Result<String, IntegrationError> {
        Ok(self.send_checked(Method::GET, path, query, None).await?.body)
    }

    pub async fn post_json(&self, path: &str, body: &Value) -> Result<Value, IntegrationError> {
        let response = self.send_checked(Method::POST, path, &[], Some(body)).await?;
        parse_json_body_or_null(&response.body)
    }

    pub async fn put_json(&self, path: &str, body: &Value) -> Result<Value, IntegrationError> {
        let response = self.send_checked(Method::PUT, path, &[], Some(body)).await?;
        parse_json_body_or_null(&response.body)
    }

    pub async fn patch_json(&self, path: &str, body: &Value) -> Result<Value, IntegrationError> {
        let response = self.send_checked(Method::PATCH, path, &[], Some(body)).await?;
        parse_json_body_or_null(&response.body)
    }

    pub async fn delete(&self, path: &str) -> Result<(), IntegrationError> {
        self.send_checked(Method::DELETE, path, &[], None).await.map(|_| ())
    }

    /// Follows `Link: <...>; rel="next"` up to `MAX_PAGES`; `has_more` says
    /// whether the service still had pages after that.
    pub async fn get_paged(&self, path: &str, query: &[(&str, String)]) -> Result<(Vec<Value>, bool), IntegrationError> {
        let mut items = Vec::new();
        let mut next: Option<String> = None;
        for page in 0..MAX_PAGES {
            let (value, headers) = match &next {
                None => self.get_with_headers(path, query).await?,
                Some(url) => self.get_with_headers(url, &[]).await?,
            };
            if let Value::Array(chunk) = value {
                items.extend(chunk);
            } else {
                return Err(IntegrationError::provider("Expected a JSON array"));
            }
            next = headers
                .get("link")
                .and_then(|v| v.to_str().ok())
                .and_then(parse_link_next);
            match next {
                None => return Ok((items, false)),
                Some(_) if page + 1 == MAX_PAGES => return Ok((items, true)),
                Some(_) => {}
            }
        }
        Ok((items, next.is_some()))
    }

    /// Jira-style pagination: `startAt` / `maxResults` with items under `field`.
    pub async fn get_paged_start_at(
        &self,
        path: &str,
        query: &[(&str, String)],
        field: &str,
        max_results: u32,
    ) -> Result<(Vec<Value>, bool), IntegrationError> {
        let mut items = Vec::new();
        let mut start_at: u64 = 0;
        for _ in 0..MAX_PAGES {
            let mut q: Vec<(&str, String)> = query.to_vec();
            q.push(("startAt", start_at.to_string()));
            q.push(("maxResults", max_results.to_string()));
            let value = self.get_json(path, &q).await?;
            let chunk = value.get(field).and_then(Value::as_array).cloned().unwrap_or_default();
            let received = chunk.len() as u64;
            items.extend(chunk);
            let total = value.get("total").and_then(Value::as_u64);
            let is_last = value.get("isLast").and_then(Value::as_bool);
            start_at += received;
            let has_more = match (is_last, total) {
                (Some(last), _) => !last,
                (None, Some(total)) => start_at < total,
                (None, None) => received == max_results as u64 && received > 0,
            };
            if !has_more {
                return Ok((items, false));
            }
        }
        Ok((items, true))
    }

    /// GET whose answer may redirect to another host (a signed blob): the
    /// redirect is then followed once, with a plain client and no credentials.
    pub async fn get_text_following_foreign_redirect(&self, path: &str) -> Result<String, IntegrationError> {
        let response = self.send(Method::GET, path, &[], None, &[]).await?;
        if response.status >= 300 && response.status < 400 {
            let plain = build_client()?;
            let followed = plain
                .get(&response.body)
                .send()
                .await
                .map_err(|e| IntegrationError::network(e.to_string()))?;
            let status = followed.status().as_u16();
            let headers = followed.headers().clone();
            let body = followed.text().await.map_err(|e| IntegrationError::network(e.to_string()))?;
            if status >= 300 {
                return Err(error_from_response(status, &headers, &body));
            }
            return Ok(body);
        }
        if response.status >= 300 {
            return Err(error_from_response(response.status, &response.headers, &response.body));
        }
        Ok(response.body)
    }
}

fn serde_urlencoded(query: &[(&str, String)]) -> String {
    query.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&")
}

fn parse_json_body(body: &str) -> Result<Value, IntegrationError> {
    serde_json::from_str(body).map_err(|e| IntegrationError::provider(format!("Invalid JSON answer: {e}")))
}

fn parse_json_body_or_null(body: &str) -> Result<Value, IntegrationError> {
    if body.trim().is_empty() {
        return Ok(Value::Null);
    }
    parse_json_body(body)
}

pub fn parse_link_next(header: &str) -> Option<String> {
    header.split(',').find_map(|part| {
        let (url, params) = part.split_once(';')?;
        let is_next = params.split(';').any(|p| {
            let p = p.trim();
            p == "rel=\"next\"" || p == "rel=next"
        });
        if !is_next {
            return None;
        }
        Some(url.trim().trim_start_matches('<').trim_end_matches('>').to_string())
    })
}

fn header_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v: &HeaderValue| v.to_str().ok())
}

fn retry_after_ms(headers: &HeaderMap) -> Option<u64> {
    if let Some(seconds) = header_str(headers, "retry-after").and_then(|v| v.trim().parse::<u64>().ok()) {
        return Some(seconds * 1000);
    }
    if let Some(reset) = header_str(headers, "x-ratelimit-reset").and_then(|v| v.trim().parse::<u64>().ok()) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        return Some(reset.saturating_sub(now) * 1000);
    }
    None
}

fn truncated_body(body: &str) -> String {
    body.trim().chars().take(ERROR_BODY_MAX_CHARS).collect()
}

fn provider_message(status: u16, body: &str) -> String {
    let detail = truncated_body(body);
    if detail.is_empty() { format!("HTTP {status}") } else { format!("HTTP {status}: {detail}") }
}

/// Maps a failed HTTP answer to the normalized error the frontend understands.
pub fn error_from_response(status: u16, headers: &HeaderMap, body: &str) -> IntegrationError {
    let is_rate_limited = header_str(headers, "x-ratelimit-remaining").map(str::trim) == Some("0")
        || header_str(headers, "retry-after").is_some();
    match status {
        401 => IntegrationError::unauthenticated(provider_message(status, body)),
        403 if is_rate_limited => IntegrationError::rate_limited(retry_after_ms(headers)),
        403 => IntegrationError::forbidden(provider_message(status, body)),
        404 => IntegrationError::not_found(provider_message(status, body)),
        429 => IntegrationError::rate_limited(retry_after_ms(headers)),
        _ => IntegrationError::provider(provider_message(status, body)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::integrations::model::IntegrationErrorCode;

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (k, v) in pairs {
            map.insert(
                reqwest::header::HeaderName::from_bytes(k.as_bytes()).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        map
    }

    #[test]
    fn maps_401_to_unauthenticated() {
        let e = error_from_response(401, &HeaderMap::new(), "{\"message\":\"401 Unauthorized\"}");
        assert_eq!(e.code, IntegrationErrorCode::Unauthenticated);
    }

    #[test]
    fn maps_403_to_forbidden_unless_rate_limited() {
        assert_eq!(error_from_response(403, &HeaderMap::new(), "").code, IntegrationErrorCode::Forbidden);
        let h = headers(&[("x-ratelimit-remaining", "0")]);
        assert_eq!(error_from_response(403, &h, "").code, IntegrationErrorCode::RateLimited);
        let h = headers(&[("retry-after", "12")]);
        let e = error_from_response(403, &h, "");
        assert_eq!(e.code, IntegrationErrorCode::RateLimited);
        assert_eq!(e.retry_after_ms, Some(12_000));
    }

    #[test]
    fn maps_404_and_429() {
        assert_eq!(error_from_response(404, &HeaderMap::new(), "").code, IntegrationErrorCode::NotFound);
        let h = headers(&[("retry-after", "3")]);
        let e = error_from_response(429, &h, "");
        assert_eq!(e.code, IntegrationErrorCode::RateLimited);
        assert_eq!(e.retry_after_ms, Some(3000));
    }

    #[test]
    fn maps_others_to_provider_with_truncated_body() {
        let body = "x".repeat(500);
        let e = error_from_response(500, &HeaderMap::new(), &body);
        assert_eq!(e.code, IntegrationErrorCode::Provider);
        assert!(e.message.starts_with("HTTP 500: "));
        assert_eq!(e.message.len(), "HTTP 500: ".len() + ERROR_BODY_MAX_CHARS);
    }

    #[test]
    fn parses_link_header_next() {
        let link = "<https://gitlab.com/api/v4/projects/1/issues?page=2&per_page=20>; rel=\"next\", <https://gitlab.com/api/v4/projects/1/issues?page=1&per_page=20>; rel=\"first\", <https://gitlab.com/api/v4/projects/1/issues?page=9&per_page=20>; rel=\"last\"";
        assert_eq!(
            parse_link_next(link).as_deref(),
            Some("https://gitlab.com/api/v4/projects/1/issues?page=2&per_page=20")
        );
    }

    #[test]
    fn link_header_without_next_is_none() {
        let link = "<https://api.github.com/repositories/1/issues?page=1>; rel=\"first\", <https://api.github.com/repositories/1/issues?page=1>; rel=\"prev\"";
        assert!(parse_link_next(link).is_none());
        assert!(parse_link_next("").is_none());
    }

    #[test]
    fn host_extraction_ignores_port_and_userinfo() {
        assert_eq!(host_of("https://user:pw@gitlab.acme.io:8443/api/v4").as_deref(), Some("gitlab.acme.io"));
        assert_eq!(host_of("https://API.GitHub.com").as_deref(), Some("api.github.com"));
        assert!(host_of("no-scheme").is_none());
    }

    #[test]
    fn relative_locations_resolve_against_the_current_url() {
        assert_eq!(resolve_location("https://a.io/api/v4/x", "/api/v4/y"), "https://a.io/api/v4/y");
        assert_eq!(resolve_location("https://a.io/api/v4/x", "y"), "https://a.io/api/v4/y");
        assert_eq!(resolve_location("https://a.io/x", "https://b.io/z"), "https://b.io/z");
    }

    fn entry(age: Duration) -> EtagEntry {
        EtagEntry {
            etag: "W/\"x\"".into(),
            body: Value::Null,
            stored_at: Instant::now() - age,
        }
    }

    #[test]
    fn expired_etag_entries_are_dropped_on_the_next_insert() {
        let mut map = HashMap::new();
        map.insert("fresh".to_string(), entry(Duration::from_secs(60)));
        map.insert("stale".to_string(), entry(ETAG_TTL + Duration::from_secs(1)));
        HttpClient::evict_etags(&mut map, "incoming");
        assert!(map.contains_key("fresh"));
        assert!(!map.contains_key("stale"));
    }

    #[test]
    fn the_cap_holds_and_sheds_the_oldest_first() {
        let mut map = HashMap::new();
        for i in 0..ETAG_MAX_ENTRIES {
            map.insert(format!("k{i}"), entry(Duration::from_secs((ETAG_MAX_ENTRIES - i) as u64)));
        }
        HttpClient::evict_etags(&mut map, "incoming");
        assert_eq!(map.len(), ETAG_MAX_ENTRIES - 1);
        assert!(!map.contains_key("k0"), "the oldest entry is the one that goes");
    }

    #[test]
    fn refreshing_a_key_already_held_costs_no_other_entry() {
        let mut map = HashMap::new();
        for i in 0..ETAG_MAX_ENTRIES {
            map.insert(format!("k{i}"), entry(Duration::from_secs((ETAG_MAX_ENTRIES - i) as u64)));
        }
        HttpClient::evict_etags(&mut map, "k0");
        assert_eq!(map.len(), ETAG_MAX_ENTRIES);
    }

    #[test]
    fn client_urls_join_relative_paths_and_keep_absolute_ones() {
        let c = HttpClient::new("https://gitlab.com/api/v4/", Auth::None, false).unwrap();
        assert_eq!(c.url("projects/1"), "https://gitlab.com/api/v4/projects/1");
        assert_eq!(c.url("/projects/1"), "https://gitlab.com/api/v4/projects/1");
        assert_eq!(c.url("https://gitlab.com/api/v4/user"), "https://gitlab.com/api/v4/user");
    }
}
