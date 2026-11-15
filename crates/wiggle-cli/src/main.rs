use std::env;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("identity") => println!("{}", wiggle_core::IDENTITY),
        Some("--version") | Some("-V") => println!("wiggle 0.1.0"),
        None | Some("--help") | Some("-h") => println!("wiggle 0.1.0\n\nUsage: wiggle [identity|--version|--help]\n\nProvider execution is not available in this preview."),
        Some(other) => { eprintln!("Unknown command: {other}. Run wiggle --help."); return ExitCode::FAILURE; }
    }
    ExitCode::SUCCESS
}
