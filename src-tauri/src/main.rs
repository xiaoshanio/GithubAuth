// Release builds are GUI apps: without this, Windows attaches a console window
// to the process and a stray cmd window appears next to the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    github_auth_lib::run();
}
