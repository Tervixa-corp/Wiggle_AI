// Tervixa Wiggle Tauri shell.
//
// The product ships as one self-contained desktop application: the bundled Node
// runtime starts the loopback gateway from the bundled resources, and the window
// loads that gateway origin so the workbench's relative /api calls resolve.
//
// The gateway is always torn down with the app. There is no IPC command layer:
// server/ is the single runtime.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent};

const GATEWAY_PORT: u16 = 4317;

/// Owns the bundled gateway child process for the lifetime of the app.
struct Gateway(Mutex<Option<Child>>);

fn resource_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().resource_dir().ok().map(|dir| dir.join("resources"))
}

fn workspace_dir(app: &tauri::AppHandle) -> PathBuf {
    let base = app
        .path()
        .home_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("Tervixa Wiggle Workspace");
    let _ = std::fs::create_dir_all(&base);
    base
}

fn spawn_gateway(app: &tauri::AppHandle) -> Option<Child> {
    let root = resource_root(app)?;
    let node = root.join("node").join("node.exe");
    let script = root.join("app").join("server").join("main.mjs");
    if !node.exists() || !script.exists() {
        return None;
    }

    let workspace = workspace_dir(app);
    let mut cmd = Command::new(node);
    cmd.arg(script)
        .current_dir(&workspace)
        .env("WIGGLE_PORT", GATEWAY_PORT.to_string())
        .env("WIGGLE_WORKSPACE", &workspace)
        .env("NODE_ENV", "production")
        .env_remove("NODE_OPTIONS")
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn().ok()
}

fn wait_for_gateway(timeout: Duration) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], GATEWAY_PORT));
    let start = Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn main() {
    tauri::Builder::default()
        .manage(Gateway(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            if let Some(child) = spawn_gateway(&handle) {
                wait_for_gateway(Duration::from_secs(45));
                if let Ok(mut slot) = app.state::<Gateway>().0.lock() {
                    *slot = Some(child);
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the Tervixa Wiggle desktop shell")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Ok(mut slot) = app.state::<Gateway>().0.lock() {
                    if let Some(mut child) = slot.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        });
}
