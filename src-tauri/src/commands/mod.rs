pub mod agent;
pub mod agent_activity;
pub mod commit_state;
pub mod conversations;
pub mod custom_commands;
pub mod env_vars;
pub mod file_state;
pub mod files;
pub mod formatting;
pub mod git;
pub mod git_collapse_state;
pub mod git_error;
pub mod instances;
pub mod lsp;
pub mod projects;
pub mod settings;
pub mod shell;
pub mod terminal;
pub mod toolchain;
pub mod ui_state;

pub use agent::{AgentState, send_message, stop_agent, respond_permission};
pub use agent::config::{
    get_ai_providers_config, save_ai_providers_config,
    set_provider_api_key, get_api_key_statuses, delete_provider_api_key,
    get_custom_agents, save_custom_agents,
    probe_provider, list_agent_commands, list_claude_agents, discover_provider,
};
pub use agent_activity::{get_agent_activity, save_agent_activity};
pub use commit_state::{get_commit_state, save_commit_state};
pub use conversations::{get_conversation_index, save_conversation_index, get_conversation_body, save_conversation_body, delete_conversation_body};
pub use custom_commands::{
    get_project_commands, save_project_commands, get_global_commands, save_global_commands,
    get_command_state, save_command_state, allocate_port,
};
pub use env_vars::{
    get_global_env, save_global_env, get_project_env, save_project_env,
    get_instance_env, save_instance_env,
    env_file_status, read_env_file, write_env_file, delete_env_file, ensure_env_ignored,
};
pub use file_state::{get_file_state, save_file_state};
pub use formatting::{
    get_project_formatting, save_project_formatting,
    list_formatters, list_style_options, list_formattable_languages,
    format_document, detect_repo_formatters,
    import_formatting_config, export_formatting_config,
    install_formatter, uninstall_formatter, update_formatter,
    uninstall_manager_for_formatter, update_manager_for_formatter,
};
pub use git_collapse_state::{get_git_collapse_state, save_git_collapse_state};
pub use files::{read_dir_tree, quick_search, QuickSearchCache, list_dir_names, read_file, read_file_preview, read_file_base64, write_file, delete_path, rename_path, create_file_or_dir, search_in_files};
pub use git::{
    list_branches, list_branches_detailed, validate_git_repo, is_git_repo, git_status, git_check_ignore,
    git_diff_unstaged, git_diff_staged, git_diff_file, git_file_at_head,
    git_stage_file, git_unstage_file, git_stage_all, git_unstage_all,
    git_get_identity, git_commit, git_amend_commit, git_head_message,
    git_current_branch, git_checkout_branch, git_create_branch, git_delete_branch,
    git_push, git_pull, git_fetch, git_remote_status, git_remote_url,
    git_branch_divergence, git_remove_index_lock,
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
pub use instances::{list_instances, create_instance, duplicate_instance, delete_instance, update_instance_status};
pub use lsp::{
    LspState, list_language_servers, install_language_server, uninstall_language_server,
    uninstall_manager_for, update_language_server, update_manager_for, check_language_server_updates,
    cancel_language_server_command,
    start_language_server, stop_language_servers_with_id,
    stop_language_servers_for, lsp_did_open, lsp_did_change, lsp_did_save, lsp_did_close,
    lsp_completion, lsp_hover, lsp_signature_help, lsp_definition, lsp_implementation,
    lsp_references, lsp_rename, lsp_format,
};
pub use projects::{list_projects, add_project, remove_project, update_project, duplicate_project, set_active_instance, get_listing, save_folders, save_project_order};
pub use settings::{get_settings, update_settings};
pub use shell::{run_shell_command, run_shell_command_with_stdin, run_agent_command, open_in_terminal, reveal_in_file_manager, copy_path, validate_directory, clone_repository};
pub use terminal::{TerminalState, terminal_create, terminal_write, terminal_resize, terminal_close, terminal_close_all, get_terminal_state, save_terminal_state, get_project_terminal_state, save_project_terminal_state};
pub use ui_state::{get_ui_state, save_ui_state};
