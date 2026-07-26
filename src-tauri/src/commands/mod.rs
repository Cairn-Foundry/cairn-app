pub mod agent;
pub mod agent_activity;
pub mod commit_state;
pub mod conversations;
pub mod file_state;
pub mod files;
pub mod git;
pub mod git_collapse_state;
pub mod git_error;
pub mod instances;
pub mod projects;
pub mod settings;
pub mod shell;
pub mod terminal;
pub mod ui_state;

pub use agent::{AgentState, send_message, stop_agent};
pub use agent_activity::{get_agent_activity, save_agent_activity};
pub use commit_state::{get_commit_state, save_commit_state};
pub use conversations::{get_conversation_index, save_conversation_index, get_conversation_body, save_conversation_body, delete_conversation_body};
pub use file_state::{get_file_state, save_file_state};
pub use git_collapse_state::{get_git_collapse_state, save_git_collapse_state};
pub use files::{read_dir_tree, quick_search, QuickSearchCache, list_dir_names, read_file, write_file, delete_path, rename_path, create_file_or_dir, search_in_files};
pub use git::{
    list_branches, list_branches_detailed, validate_git_repo, is_git_repo, git_status, git_check_ignore,
    git_diff_unstaged, git_diff_staged, git_diff_file, git_file_at_head,
    git_stage_file, git_unstage_file, git_stage_all, git_unstage_all,
    git_get_identity, git_commit, git_amend_commit, git_head_message,
    git_current_branch, git_checkout_branch, git_create_branch, git_delete_branch,
    git_push, git_pull, git_fetch, git_remote_status, git_remove_index_lock,
    git_operation_state, git_rm, git_merge, git_merge_continue, git_merge_abort,
    git_rebase, git_rebase_continue, git_rebase_skip, git_rebase_abort,
    git_log,
    git_graph,
    git_diff_commit,
    git_commit_body,
    git_stash_list, git_stash_push, git_stash_pop, git_stash_apply,
    git_stash_drop, git_stash_show, git_stash_clear, git_stash_rename,
    git_revert_commit, git_discard_file,
};
pub use instances::{list_instances, create_instance, duplicate_instance, delete_instance};
pub use projects::{list_projects, add_project, remove_project, update_project, duplicate_project, set_active_instance, get_listing, save_folders, save_project_order};
pub use settings::{get_settings, update_settings};
pub use shell::{run_shell_command, run_shell_command_with_stdin, run_agent_command, open_in_terminal, reveal_in_file_manager, copy_path, validate_directory, clone_repository};
pub use terminal::{TerminalState, terminal_create, terminal_write, terminal_resize, terminal_close, terminal_close_all, get_terminal_state, save_terminal_state, get_project_terminal_state, save_project_terminal_state};
pub use ui_state::{get_ui_state, save_ui_state};
