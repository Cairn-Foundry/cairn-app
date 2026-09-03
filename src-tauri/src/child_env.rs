// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The environment handed to the processes Cairn spawns.
//!
//! An AppImage runs the app from a temporary mount and points the environment
//! at it: `PATH`, `LD_LIBRARY_PATH`, `PYTHONHOME`, `GTK_PATH`, `XDG_DATA_DIRS`
//! and their friends all lead into `$APPDIR`. The app itself needs that - its
//! GTK modules, its pixbuf loaders and its libraries live there, and the
//! runtime sets those variables precisely so the webview finds them. Its
//! children have no use for them and break on them: `python3` in a Cairn
//! terminal cannot find its own standard library (`Failed to import encodings
//! module`), a language server written in Python dies the same way, and a
//! system binary can be linked against a bundled copy of a library instead of
//! the one it was built for.
//!
//! So every process spawned from the app gets the mount taken back out of its
//! environment. The runtime prepends its entries to the lists the session
//! already had, so dropping them restores what the user's shell would have
//! seen. Outside an AppImage there is no `APPDIR` and nothing to do at all,
//! which is why none of this shows up under `tauri dev`.

use std::ffi::OsStr;
use std::process::Command;

/// Set by the AppImage runtime to describe itself. A child inherits them
/// without ever having a use for them, and they name a mount that disappears
/// when the app exits.
const MARKERS: [&str; 4] = ["APPDIR", "APPIMAGE", "ARGV0", "OWD"];

/// A `Command` whose child will not inherit the AppImage mount.
pub fn command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    scrub(&mut cmd);
    cmd
}

/// Takes the mount back out of the environment of an already built `Command`.
pub fn scrub(cmd: &mut Command) {
    apply(cmd, &from_current_env());
}

fn apply(cmd: &mut Command, changes: &[(String, Option<String>)]) {
    for (key, value) in changes {
        match value {
            Some(v) => cmd.env(key, v),
            None => cmd.env_remove(key),
        };
    }
}

/// Same, for the command a PTY is opened on.
pub fn scrub_pty(cmd: &mut portable_pty::CommandBuilder) {
    for (key, value) in from_current_env() {
        match value {
            Some(v) => cmd.env(key, v),
            None => cmd.env_remove(key),
        }
    }
}

/// The changes to apply to what this process inherited; empty when the app was
/// not started from an AppImage.
fn from_current_env() -> Vec<(String, Option<String>)> {
    let appdir = std::env::var("APPDIR").ok().filter(|d| !d.is_empty());
    match appdir {
        Some(dir) => overrides(std::env::vars(), &dir),
        None => Vec::new(),
    }
}

/// What to change in an inherited environment, `None` meaning "unset it".
///
/// Only the variables leading into `appdir` are named: everything else is left
/// byte for byte as it was, so a machine running the app from a package rather
/// than an AppImage sees no difference.
fn overrides<I>(vars: I, appdir: &str) -> Vec<(String, Option<String>)>
where
    I: IntoIterator<Item = (String, String)>,
{
    let prefix = format!("{}/", appdir.trim_end_matches('/'));
    let under = |entry: &str| entry == appdir || entry.starts_with(&prefix);
    let mut out = Vec::new();
    for (key, value) in vars {
        if MARKERS.contains(&key.as_str()) {
            out.push((key, None));
            continue;
        }
        if !value.split(':').any(under) {
            continue;
        }
        // Empty entries go out with the mount: they mean the current directory,
        // and they are the trailing colons the runtime left behind rather than
        // anything the session asked for.
        let kept: Vec<&str> = value
            .split(':')
            .filter(|entry| !entry.is_empty() && !under(entry))
            .collect();
        out.push((key, (!kept.is_empty()).then(|| kept.join(":"))));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The mount of a Cairn AppImage, space in the app name included.
    const APPDIR: &str = "/tmp/.mount_Cairn BObaJM";

    fn applied(vars: &[(&str, &str)]) -> Vec<(String, Option<String>)> {
        let owned = vars
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect::<Vec<_>>();
        overrides(owned, APPDIR)
    }

    #[test]
    fn unsets_a_variable_that_only_leads_into_the_mount() {
        let out = applied(&[("PYTHONHOME", "/tmp/.mount_Cairn BObaJM/usr/")]);
        assert_eq!(out, vec![("PYTHONHOME".to_string(), None)]);
    }

    #[test]
    fn gives_back_the_list_the_session_already_had() {
        let out = applied(&[(
            "XDG_DATA_DIRS",
            "/tmp/.mount_Cairn BObaJM/usr/share/:/usr/share:/usr/local/share",
        )]);
        assert_eq!(
            out,
            vec![(
                "XDG_DATA_DIRS".to_string(),
                Some("/usr/share:/usr/local/share".to_string())
            )]
        );
    }

    /// The runtime leaves a trailing colon, which names the current directory.
    #[test]
    fn drops_the_empty_entries_the_runtime_left_behind() {
        let out = applied(&[("LD_LIBRARY_PATH", "/tmp/.mount_Cairn BObaJM/usr/lib/:")]);
        assert_eq!(out, vec![("LD_LIBRARY_PATH".to_string(), None)]);
    }

    #[test]
    fn takes_the_bundled_binaries_out_of_the_path() {
        let out = applied(&[("PATH", "/tmp/.mount_Cairn BObaJM/usr/bin:/usr/bin:/bin")]);
        assert_eq!(
            out,
            vec![("PATH".to_string(), Some("/usr/bin:/bin".to_string()))]
        );
    }

    #[test]
    fn unsets_the_markers_of_the_runtime_itself() {
        let out = applied(&[
            ("APPDIR", APPDIR),
            ("APPIMAGE", "/home/someone/Cairn.AppImage"),
            ("ARGV0", "./Cairn.AppImage"),
            ("OWD", "/home/someone"),
        ]);
        assert!(out.iter().all(|(_, v)| v.is_none()));
        assert_eq!(out.len(), 4);
    }

    #[test]
    fn leaves_a_variable_that_never_mentions_the_mount_alone() {
        let out = applied(&[
            ("HOME", "/home/someone"),
            ("PATH", "/usr/bin:/bin"),
            ("SHELL", "/usr/bin/zsh"),
        ]);
        assert!(out.is_empty());
    }

    /// A directory whose name merely starts like the mount is not in it.
    #[test]
    fn does_not_take_a_sibling_of_the_mount_for_the_mount() {
        let out = applied(&[(
            "LD_LIBRARY_PATH",
            "/tmp/.mount_Cairn BObaJM-other/usr/lib:/usr/lib",
        )]);
        assert!(out.is_empty());
    }

    /// Nothing is done at all when the app was not started from an AppImage,
    /// whatever the environment holds.
    #[test]
    fn changes_nothing_when_the_mount_is_nowhere_to_be_found() {
        let vars = vec![
            ("PATH".to_string(), "/usr/bin:/bin".to_string()),
            ("PYTHONHOME".to_string(), "/usr".to_string()),
        ];
        assert!(overrides(vars, "/tmp/.mount_Nothing").is_empty());
    }

    /// The one that matters: what a spawned process actually reads. The
    /// variables are set on the command rather than on this process, so the
    /// test says nothing about the environment the test runner itself was
    /// given - only about what crosses the spawn.
    #[cfg(unix)]
    #[test]
    fn a_spawned_process_reads_the_cleaned_environment() {
        let vars = vec![
            ("CAIRN_TEST_HOME".to_string(), format!("{APPDIR}/usr/")),
            ("CAIRN_TEST_LIBS".to_string(), format!("{APPDIR}/usr/lib:/usr/lib:")),
            ("CAIRN_TEST_KEPT".to_string(), "/home/someone".to_string()),
        ];
        let mut cmd = Command::new("env");
        for (key, value) in &vars {
            cmd.env(key, value);
        }
        apply(&mut cmd, &overrides(vars, APPDIR));

        let out = cmd.output().expect("env should be runnable");
        let seen = String::from_utf8_lossy(&out.stdout);
        let line = |name: &str| {
            seen.lines()
                .find(|l| l.starts_with(&format!("{name}=")))
                .map(|l| l.split_once('=').unwrap().1.to_string())
        };
        assert_eq!(line("CAIRN_TEST_HOME"), None, "{seen}");
        assert_eq!(line("CAIRN_TEST_LIBS").as_deref(), Some("/usr/lib"), "{seen}");
        assert_eq!(line("CAIRN_TEST_KEPT").as_deref(), Some("/home/someone"), "{seen}");
    }
}
