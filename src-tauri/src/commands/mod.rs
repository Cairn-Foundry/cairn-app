pub mod agent;
pub mod file_state;
pub mod files;
pub mod git;
pub mod instances;
pub mod projects;
pub mod settings;
pub mod shell;
pub mod ui_state;

pub use agent::{AgentState, send_message, reset_agent_session, stop_agent};
pub use file_state::{get_file_state, save_file_state};
pub use files::{read_dir_tree, read_file, write_file, delete_path, rename_path, create_file_or_dir, search_in_files};
pub use git::{
    list_branches, validate_git_repo, git_status,
    git_diff_unstaged, git_diff_staged, git_diff_file, git_file_at_head,
    git_stage_file, git_unstage_file, git_stage_all, git_unstage_all,
    git_commit, git_amend_commit,
    git_current_branch, git_checkout_branch, git_create_branch, git_delete_branch,
    git_push, git_pull, git_fetch, git_remote_status,
    git_log,
};
pub use instances::{list_instances, create_instance, duplicate_instance, delete_instance};
pub use projects::{list_projects, add_project, remove_project, update_project, duplicate_project, set_active_instance, get_listing, save_folders, save_project_order};
pub use settings::{get_settings, update_settings};
pub use shell::{run_shell_command, run_shell_command_with_stdin, run_agent_command, open_in_terminal, reveal_in_file_manager, copy_path, validate_directory, clone_repository};
pub use ui_state::{get_ui_state, save_ui_state};
