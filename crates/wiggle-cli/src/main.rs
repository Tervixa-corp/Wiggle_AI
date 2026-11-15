use std::env;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("identity") => println!("{}", wiggle_core::IDENTITY),
        Some("--version") | Some("-V") => println!("wiggle {}", env!("CARGO_PKG_VERSION")),
        None | Some("--help") | Some("-h") => println!("wiggle {}\n\nUsage: wiggle [identity|--version|--help]\n\nThe agent core runs from the Node server in this build; see README.", env!("CARGO_PKG_VERSION")),
        Some(other) => { eprintln!("Unknown command: {other}. Run wiggle --help."); return ExitCode::FAILURE; }
    }
    ExitCode::SUCCESS
}
