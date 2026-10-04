// Thin client: the window only renders the shared web client. No commands, no plugins, no secrets.
// Every decision the agent makes happens on the Hono server.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Tapak Support");
}
