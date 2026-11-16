//! Allow / Ask / Deny gate for tools, and a workspace path validator.

use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Ask,
    Deny,
}

/// Default policy: reads are allowed, writes and shell need approval, anything unknown is denied.
pub fn decide(tool: &str) -> Decision {
    match tool {
        "read_file" | "list_dir" | "glob" | "grep" => Decision::Allow,
        "write_file" | "edit_file" | "multi_edit" | "bash" => Decision::Ask,
        _ => Decision::Deny,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum PathError {
    Empty,
    NulByte,
    Absolute,
    ParentSegment,
    NotFound,
    OutsideWorkspace,
    Io(String),
}

/// Resolve a relative path inside `root`. Rejects absolute paths, `..`, NUL bytes, and any
/// existing path whose canonical location leaves the workspace (including symlinks).
pub fn resolve_in_workspace(root: &Path, relative: &str) -> Result<PathBuf, PathError> {
    if relative.is_empty() {
        return Err(PathError::Empty);
    }
    if relative.contains('\0') {
        return Err(PathError::NulByte);
    }
    let candidate = Path::new(relative);
    if candidate.is_absolute() || relative.starts_with('\\') || relative.starts_with('/') {
        return Err(PathError::Absolute);
    }
    for component in candidate.components() {
        match component {
            Component::ParentDir => return Err(PathError::ParentSegment),
            Component::Prefix(_) | Component::RootDir => return Err(PathError::Absolute),
            _ => {}
        }
    }
    let root_real = root
        .canonicalize()
        .map_err(|e| PathError::Io(e.to_string()))?;
    let joined = root_real.join(candidate);
    let real = joined.canonicalize().map_err(|_| PathError::NotFound)?;
    if !real.starts_with(&root_real) {
        return Err(PathError::OutsideWorkspace);
    }
    Ok(real)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wiggle-perm-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("src/lib.rs"), "fn main() {}").unwrap();
        dir
    }

    #[test]
    fn default_policy_allows_reads_asks_for_writes_denies_unknown() {
        assert_eq!(decide("read_file"), Decision::Allow);
        assert_eq!(decide("edit_file"), Decision::Ask);
        assert_eq!(decide("bash"), Decision::Ask);
        assert_eq!(decide("delete_everything"), Decision::Deny);
    }

    #[test]
    fn resolves_files_inside_and_rejects_escapes() {
        let root = temp_dir("inside");
        assert!(resolve_in_workspace(&root, "src/lib.rs").is_ok());
        assert_eq!(
            resolve_in_workspace(&root, "../etc/passwd"),
            Err(PathError::ParentSegment)
        );
        assert_eq!(
            resolve_in_workspace(&root, "/etc/passwd"),
            Err(PathError::Absolute)
        );
        assert_eq!(resolve_in_workspace(&root, "a\0b"), Err(PathError::NulByte));
        assert_eq!(resolve_in_workspace(&root, ""), Err(PathError::Empty));
        assert_eq!(
            resolve_in_workspace(&root, "missing.rs"),
            Err(PathError::NotFound)
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_that_leave_the_workspace() {
        let root = temp_dir("symlink");
        let outside = std::env::temp_dir().join(format!("wiggle-outside-{}", std::process::id()));
        fs::write(&outside, "secret").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link.txt")).unwrap();
        assert_eq!(
            resolve_in_workspace(&root, "link.txt"),
            Err(PathError::OutsideWorkspace)
        );
        let _ = fs::remove_file(&outside);
        let _ = fs::remove_dir_all(&root);
    }
}
