//! Turns raw git output into a stable error code the frontend can translate.

use serde::Serialize;

/// Structured error returned by every git command. `code` drives the message
/// shown to the user, `raw` always carries the untouched git output so nothing
/// is ever lost when the classification falls back to `unknown`.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct GitError {
    pub code: String,
    pub raw: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
}

impl GitError {
    /// Builds an error with an already-known code, bypassing classification.
    pub fn new(code: &str, raw: impl Into<String>) -> Self {
        GitError { code: code.to_string(), raw: raw.into(), context: None }
    }

    /// Attaches the ref or path the operation was about, for the user-facing message.
    pub fn with_context(mut self, context: impl Into<String>) -> Self {
        self.context = Some(context.into());
        self
    }

    /// Classify a failed git invocation from its combined output.
    pub fn from_output(raw: impl Into<String>) -> Self {
        let raw = raw.into();
        GitError { code: classify(&raw).to_string(), raw, context: None }
    }

    /// Classify a failed process, using stderr and stdout together: git writes
    /// rejection details to either stream depending on the subcommand.
    pub fn from_process(out: &std::process::Output) -> Self {
        let raw = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stderr),
            String::from_utf8_lossy(&out.stdout)
        );
        GitError::from_output(raw.trim().to_string())
    }
}

/// Lets a plain error string from a helper be classified on the `?` boundary.
impl From<String> for GitError {
    fn from(raw: String) -> Self {
        GitError::from_output(raw)
    }
}

/// An I/O failure means the `git` binary could not be spawned at all.
impl From<std::io::Error> for GitError {
    fn from(e: std::io::Error) -> Self {
        GitError::new("git_unavailable", e.to_string())
    }
}

/// `git2` messages carry the same English wording, so they classify identically.
impl From<git2::Error> for GitError {
    fn from(e: git2::Error) -> Self {
        GitError::from_output(e.message().to_string())
    }
}

/// True when every needle is present.
fn contains_all(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().all(|n| haystack.contains(n))
}

/// True when at least one needle is present.
fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| haystack.contains(n))
}

/// Maps raw git output to a stable error code. Matching is done on the English
/// messages, which is why `git_cmd` forces `LC_ALL=C`. Anything unrecognized
/// stays `unknown`, and the caller still shows the raw output.
pub fn classify(raw: &str) -> &'static str {
    let s = raw.to_lowercase();

    if s.contains("index.lock") || contains_all(&s, &["unable to create", ".lock"]) {
        // A dead git process left .git/index.lock behind, or one is still running.
        return "lock_exists";
    }
    if contains_any(
        &s,
        &["could not read username", "could not read password", "terminal prompts disabled"],
    ) {
        // Credentials are needed but no terminal is available to prompt for them.
        return "auth_required";
    }
    if contains_any(
        &s,
        &[
            "authentication failed",
            "invalid username or password",
            "permission denied (publickey",
            "permission denied, please try again",
            "host key verification failed",
        ],
    ) {
        // Credentials or the SSH key were presented and rejected.
        return "auth_failed";
    }
    if contains_any(&s, &["protected branch", "gh006"]) {
        // The forge refused the push: the branch is protected by a server-side rule.
        return "protected_branch";
    }
    if contains_any(&s, &["hook declined", "hook failed", "hook exited"]) {
        // A local or server hook vetoed the operation.
        return "hook_rejected";
    }
    if contains_any(
        &s,
        &["error: 403", "the requested url returned error: 403", "you are not allowed to push"],
    ) {
        // Authenticated, but the account lacks write access to this repository.
        return "permission_denied";
    }
    if contains_any(&s, &["repository not found", "error: 404", "returned error: 404"]) {
        // The remote repository does not exist, or is private to this account.
        return "remote_not_found";
    }
    if contains_any(&s, &["does not appear to be a git repository", "not a valid repository"]) {
        // The remote URL resolves but does not serve a git repository.
        return "remote_unreachable";
    }
    if contains_any(
        &s,
        &["no configured push destination", "no such remote", "does not appear to have a url"],
    ) {
        // No remote is configured for this branch or repository.
        return "no_remote";
    }
    if contains_any(
        &s,
        &[
            "could not resolve host",
            "connection timed out",
            "connection refused",
            "network is unreachable",
            "failed to connect",
            "operation timed out",
            "unable to access",
        ],
    ) {
        // DNS, TCP or TLS failed before git could talk to the remote.
        return "network_unreachable";
    }
    if contains_any(&s, &["no upstream branch", "there is no tracking information"]) {
        // The branch has no tracking branch, so push/pull has no default target.
        return "no_upstream";
    }
    if contains_any(&s, &["non-fast-forward", "fetch first", "updates were rejected"]) {
        // The remote moved ahead: a pull or a force push is required.
        return "non_fast_forward";
    }
    if contains_any(
        &s,
        &[
            "local changes to the following files would be overwritten",
            "your local changes to the following files would be overwritten",
            "please commit your changes or stash them",
            "you have unstaged changes",
            "cannot pull with rebase",
        ],
    ) {
        // Uncommitted changes block the operation and must be committed or stashed.
        return "dirty_worktree";
    }
    if contains_any(&s, &["you have unmerged files", "fix conflicts and run", "unmerged files"]) {
        // Conflicts from an earlier step are still unstaged.
        return "unresolved_conflict";
    }
    if contains_any(
        &s,
        &["you have not concluded your merge", "rebase in progress", "a rebase is in progress"],
    ) {
      // A merge or rebase is already underway and must be finished or aborted.
        return "operation_in_progress";
    }
    if contains_any(&s, &["please tell me who you are", "empty ident name", "unable to auto-detect email"])
    {
        // user.name / user.email are unset, so no commit can be authored.
        return "identity_missing";
    }
    if contains_any(&s, &["nothing to commit", "no changes added to commit"]) {
        // Nothing is staged; not a real failure in most flows.
        return "nothing_to_commit";
    }
    if contains_any(&s, &["you are not currently on a branch", "detached head"]) {
        // HEAD points at a commit rather than a branch.
        return "detached_head";
    }
    if contains_any(&s, &["is already used by worktree at", "is already checked out at"]) {
        // The branch is checked out in another worktree, which owns it exclusively.
        return "branch_in_use";
    }
    if contains_all(&s, &["branch", "already exists"]) || s.contains("already exists and is not a valid") {
        // The branch name is already taken.
        return "branch_exists";
    }
    if s.contains("is not fully merged") {
        // Deleting the branch would drop commits reachable from nowhere else.
        return "branch_not_merged";
    }
    if contains_any(
        &s,
        &[
            "did not match any file(s) known to git",
            "unknown revision or path not in the working tree",
            "not a valid ref",
            "couldn't find remote ref",
            "pathspec",
        ],
    ) {
        // The ref, revision or pathspec does not resolve in this repository.
        return "ref_not_found";
    }
    if contains_any(&s, &["no space left on device", "disk quota exceeded"]) {
        // The filesystem or the quota is full.
        return "no_disk_space";
    }

    "unknown"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_authentication_prompts_and_failures() {
        assert_eq!(
            classify("fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled"),
            "auth_required"
        );
        assert_eq!(classify("remote: Authentication failed for 'https://x/'"), "auth_failed");
        assert_eq!(classify("git@github.com: Permission denied (publickey)."), "auth_failed");
    }

    #[test]
    fn classifies_remote_problems() {
        assert_eq!(classify("remote: Repository not found."), "remote_not_found");
        assert_eq!(
            classify("fatal: 'origin' does not appear to be a git repository"),
            "remote_unreachable"
        );
        assert_eq!(
            classify("fatal: No configured push destination."),
            "no_remote"
        );
        assert_eq!(classify("ssh: Could not resolve hostname gitlab.com"), "network_unreachable");
    }

    #[test]
    fn classifies_push_rejections() {
        assert_eq!(
            classify("! [rejected] main -> main (fetch first)\nerror: failed to push some refs"),
            "non_fast_forward"
        );
        assert_eq!(
            classify("remote: GH006: Protected branch update failed for refs/heads/main."),
            "protected_branch"
        );
        assert_eq!(
            classify("remote: error: pre-receive hook declined"),
            "hook_rejected"
        );
        assert_eq!(
            classify("fatal: The current branch feat has no upstream branch."),
            "no_upstream"
        );
    }

    #[test]
    fn classifies_local_state_problems() {
        assert_eq!(
            classify("error: Your local changes to the following files would be overwritten by merge:"),
            "dirty_worktree"
        );
        assert_eq!(classify("error: you have unmerged files."), "unresolved_conflict");
        assert_eq!(
            classify("fatal: Unable to create '/repo/.git/index.lock': File exists."),
            "lock_exists"
        );
        assert_eq!(
            classify("*** Please tell me who you are."),
            "identity_missing"
        );
        assert_eq!(classify("nothing to commit, working tree clean"), "nothing_to_commit");
        assert_eq!(
            classify("fatal: 'feat/x' is already used by worktree at '/home/u/.cairn/worktrees/feat-x'"),
            "branch_in_use"
        );
        assert_eq!(
            classify("error: pathspec 'nope' did not match any file(s) known to git"),
            "ref_not_found"
        );
    }

    #[test]
    fn keeps_raw_output_and_falls_back_to_unknown() {
        let err = GitError::from_output("fatal: something entirely new");
        assert_eq!(err.code, "unknown");
        assert_eq!(err.raw, "fatal: something entirely new");
        assert!(err.context.is_none());
    }

    #[test]
    fn context_is_attached_when_provided() {
        let err = GitError::new("no_upstream", "raw").with_context("feature/x");
        assert_eq!(err.context.as_deref(), Some("feature/x"));
    }
}
