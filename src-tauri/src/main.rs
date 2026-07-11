#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ino_agent_lib::run()
}
