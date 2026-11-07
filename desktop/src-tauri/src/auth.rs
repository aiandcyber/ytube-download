use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::Duration;
use url::form_urlencoded;

const DOMAIN: &str = "dev-tvq4tbikhbet8orb.us.auth0.com";
const CLIENT_ID: &str = "YX6isR6f4VdTViqA7tcVxlKUeWyk4ITY";
const AUDIENCE: &str = "https://api.ai-forall.org";
const REDIRECT: &str = "http://127.0.0.1:54821/callback";

#[derive(Default)]
pub struct AuthState {
    pub access_token: Option<String>,
    pub email: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct AuthInfo {
    pub signed_in: bool,
    pub email: Option<String>,
}

fn random_url_safe(n: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hash)
}

pub fn auth_status(state: &AuthState) -> AuthInfo {
    AuthInfo {
        signed_in: state
            .access_token
            .as_ref()
            .map(|t| !t.is_empty())
            .unwrap_or(false),
        email: state.email.clone(),
    }
}

pub fn sign_out(state: &mut AuthState) {
    state.access_token = None;
    state.email = None;
}

pub fn sign_in(state: &Mutex<AuthState>) -> Result<AuthInfo, String> {
    let verifier = random_url_safe(64);
    let challenge = pkce_challenge(&verifier);
    let csrf = random_url_safe(24);

    let auth_url = format!(
        "https://{DOMAIN}/authorize?{}",
        form_urlencoded::Serializer::new(String::new())
            .append_pair("response_type", "code")
            .append_pair("client_id", CLIENT_ID)
            .append_pair("redirect_uri", REDIRECT)
            .append_pair("scope", "openid profile email offline_access")
            .append_pair("audience", AUDIENCE)
            .append_pair("state", &csrf)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .finish()
    );

    let listener = TcpListener::bind("127.0.0.1:54821")
        .map_err(|e| format!("Could not start login listener: {e}"))?;

    opener::open(&auth_url).map_err(|e| format!("Could not open browser: {e}"))?;

    let (mut stream, _) = listener
        .accept()
        .map_err(|e| format!("Login cancelled or failed: {e}"))?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(120)));

    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
    let req = String::from_utf8_lossy(&buf[..n]);
    let first = req.lines().next().unwrap_or("");
    let path = first.split_whitespace().nth(1).unwrap_or("/");
    let parsed = url::Url::parse(&format!("http://127.0.0.1{path}")).map_err(|e| e.to_string())?;

    let mut code = None;
    let mut state_q = None;
    let mut err = None;
    for (k, v) in parsed.query_pairs() {
        match k.as_ref() {
            "code" => code = Some(v.to_string()),
            "state" => state_q = Some(v.to_string()),
            "error" | "error_description" => err = Some(v.to_string()),
            _ => {}
        }
    }

    let body = b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<html><body><h2>Signed in. You can close this window.</h2></body></html>";
    let _ = stream.write_all(body);

    if let Some(e) = err {
        return Err(e);
    }
    if state_q.as_deref() != Some(csrf.as_str()) {
        return Err("Login state mismatch.".into());
    }
    let code = code.ok_or_else(|| "No authorization code.".to_string())?;

    let client = reqwest::blocking::Client::new();
    let token_res = client
        .post(format!("https://{DOMAIN}/oauth/token"))
        .json(&serde_json::json!({
            "grant_type": "authorization_code",
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
            "code": code,
            "redirect_uri": REDIRECT,
        }))
        .send()
        .map_err(|e| format!("Token request failed: {e}"))?;
    if !token_res.status().is_success() {
        return Err(format!("Token exchange failed ({})", token_res.status()));
    }
    let token_json: serde_json::Value = token_res.json().map_err(|e| e.to_string())?;
    let access = token_json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "No access token".to_string())?
        .to_string();

    let email = client
        .get(format!("https://{DOMAIN}/userinfo"))
        .bearer_auth(&access)
        .send()
        .ok()
        .and_then(|r| r.json::<serde_json::Value>().ok())
        .and_then(|v| {
            v.get("email")
                .or_else(|| v.get("name"))
                .and_then(|x| x.as_str())
                .map(|s| s.to_string())
        });

    let mut g = state.lock().map_err(|_| "Auth lock poisoned".to_string())?;
    g.access_token = Some(access);
    g.email = email;
    Ok(auth_status(&g))
}
