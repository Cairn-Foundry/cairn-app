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
    pub fn new(code: &str, raw: impl Into<String>) -> Self {
        GitError { code: code.to_string(), raw: raw.into(), context: None }
    }

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

impl From<String> for GitError {
    fn from(raw: String) -> Self {
        GitError::from_output(raw)
    }
}

impl From<std::io::Error> for GitError {
    fn from(e: std::io::Error) -> Self {
        GitError::new("git_unavailable", e.to_string())
    }
}

impl From<git2::Error> for GitError {
    fn from(e: git2::Error) -> Self {
        GitError::from_output(e.message().to_string())
    }
}

fn contains_all(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().all(|n| haystack.contains(n))
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| haystack.contains(n))
}

/// Maps raw git output to a stable error code. Matching is done on the English
/// messages, which is why `git_cmd` forces `LC_ALL=C`. Anything unrecognized
/// stays `unknown`, and the caller still shows the raw output.
pub fn classify(raw: &str) -> &'static str {
    let s = raw.to_lowercase();

    if s.contains("index.lock") || contains_all(&s, &["unable to create", ".lock"]) {
        return "lock_exists";
    }
    if contains_any(
        &s,
        &["could not read username", "could not read password", "terminal prompts disabled"],
    ) {
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
        return "auth_failed";
    }
    if contains_any(&s, &["protected branch", "gh006"]) {
        return "protected_branch";
    }
    if contains_any(&s, &["hook declined", "hook failed", "hook exited"]) {
        return "hook_rejected";
    }
    if contains_any(
        &s,
        &["error: 403", "the requested url returned error: 403", "you are not allowed to push"],
    ) {
        return "permission_denied";
    }
    if contains_any(&s, &["repository not found", "error: 404", "returned error: 404"]) {
        return "remote_not_found";
    }
    if contains_any(&s, &["does not appear to be a git repository", "not a valid repository"]) {
        return "remote_unreachable";
    }
    if contains_any(
        &s,
        &["no configured push destination", "no such remote", "does not appear to have a url"],
    ) {
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
        return "network_unreachable";
    }
    if contains_any(&s, &["no upstream branch", "there is no tracking information"]) {
        return "no_upstream";
    }
    if contains_any(&s, &["non-fast-forward", "fetch first", "updates were rejected"]) {
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
        return "dirty_worktree";
    }
    if contains_any(&s, &["you have unmerged files", "fix conflicts and run", "unmerged files"]) {
        return "unresolved_conflict";
    }
    if contains_any(
        &s,
        &["you have not concluded your merge", "rebase in progress", "a rebase is in progress"],
    ) {
        return "operation_in_progress";
    }
    if contains_any(&s, &["please tell me who you are", "empty ident name", "unable to auto-detect email"])
    {
        return "identity_missing";
    }
    if contains_any(&s, &["nothing to commit", "no changes added to commit"]) {
        return "nothing_to_commit";
    }
    if contains_any(&s, &["you are not currently on a branch", "detached head"]) {
        return "detached_head";
    }
    if contains_all(&s, &["branch", "already exists"]) || s.contains("already exists and is not a valid") {
        return "branch_exists";
    }
    if s.contains("is not fully merged") {
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
        return "ref_not_found";
    }
    if contains_any(&s, &["no space left on device", "disk quota exceeded"]) {
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
