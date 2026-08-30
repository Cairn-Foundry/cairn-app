//! All Tauri commands, one module per domain, re-exported flat so `lib.rs` can
//! list them in a single `generate_handler!`.

//! All Tauri commands, one module per domain, re-exported flat so `lib.rs` can
//! list them in a single `generate_handler!`.

pub mod agent;
pub mod coalesce;
pub mod file_protocol;
pub mod fs_watch;
pub mod agent_activity;
pub mod agent_runs;
pub mod cli;
pub mod cli_providers;
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
pub mod integrations;
pub mod lsp;
pub mod mcp;
pub mod native_agents;
pub mod ports;
pub mod projects;
pub mod review;
pub mod settings;
pub mod skills;
pub mod shell;
pub mod terminal;
pub mod tests;
pub mod toolchain;
pub mod ui_state;
pub mod usage;

pub use agent::{AgentState, send_message, stop_agent, respond_permission};
pub use agent::oneshot::run_oneshot;
pub use agent::config::{
    get_ai_providers_config, save_ai_providers_config,
    set_provider_api_key, get_api_key_statuses, delete_provider_api_key,
    probe_provider, list_agent_commands, discover_provider,
};
pub use agent_activity::{get_agent_activity, save_agent_activity};
pub use agent_runs::{get_agent_runs, save_agent_runs};
pub use commit_state::{get_commit_state, save_commit_state};
pub use review::{get_diff_unified, get_diff_hunks, load_review_state, save_review_state};
pub use conversations::{get_conversation_index, save_conversation_index, get_conversation_body, save_conversation_body, delete_conversation_body};
pub use custom_commands::{
    get_project_commands, save_project_commands, get_global_commands, save_global_commands,
    get_command_state, save_command_state, allocate_port,
};
pub use env_vars::{
    get_global_env, save_global_env, get_project_env, save_project_env,
    get_instance_env, save_instance_env,
    read_env_file, write_env_file, delete_env_file, ensure_env_ignored,
};
pub use file_state::{get_file_state, save_file_state};
pub use formatting::{
    get_project_formatting, save_project_formatting,
    list_formatters, list_style_options,
    format_document, detect_repo_formatters,
    import_formatting_config, export_formatting_config,
    install_formatter, uninstall_formatter, update_formatter,
    uninstall_manager_for_formatter, update_manager_for_formatter,
};
pub use git_collapse_state::{get_git_collapse_state, save_git_collapse_state};
pub use files::{read_dir_tree, quick_search, QuickSearchCache, list_dir_names, read_file_preview, read_file_base64, file_mtimes, write_file, delete_path, rename_path, create_file_or_dir, search_in_files, read_dir_tree_cached};
pub use git::{
    list_branches, list_branches_detailed, suggest_base_branches, is_git_repo, git_status, git_changed_paths, git_status_full, git_check_ignore, git_read_exclude, git_write_exclude,
    git_diff_unstaged, git_diff_staged, git_blame_file, git_file_at_head, git_file_in_index,
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
    git_diff_files_between, git_diff_file_between, git_commit_exists,
    git_stash_list, git_stash_push, git_stash_pop, git_stash_apply,
    git_stash_drop, git_stash_show, git_stash_clear, git_stash_rename,
    git_tag_list, git_tag_create, git_tag_delete, git_tag_push, git_tag_delete_remote,
    git_revert_commit, git_discard_file, git_snapshot, git_diffs};
pub use instances::{list_instances, create_instance, duplicate_instance, delete_instance, update_instance_status, update_instance_ticket, update_instance_base_branch};
pub use integrations::{
    IntegrationState, integration_kinds, list_integration_connections, save_integration_connection,
    delete_integration_connection, test_integration_connection,
    get_project_integrations, save_project_integrations, suggest_project_integrations,
    get_project_capabilities, list_tracker_projects,
    tracker_list_tickets, tracker_get_ticket, tracker_resolve_url, tracker_list_transitions, tracker_list_statuses, tracker_transition,
    forge_find_merge_request, forge_create_merge_request, forge_list_discussions, forge_reply, forge_resolve,
    forge_approve, forge_list_members, forge_list_labels, forge_web_link,
    forge_create_discussion, forge_submit_review,
    ci_list_pipelines, ci_get_pipeline, ci_job_log, ci_retry_job, ci_cancel_pipeline, ci_play_job,
    integration_watch, integration_unwatch,
};
pub use lsp::{
    LspState, list_language_servers, install_language_server, uninstall_language_server,
    uninstall_manager_for, update_language_server, update_manager_for, check_language_server_updates,
    cancel_language_server_command,
    start_language_server, stop_language_servers_with_id,
    stop_language_servers_for, lsp_did_open, lsp_did_change, lsp_did_save, lsp_did_close,
    lsp_completion, lsp_hover, lsp_signature_help, lsp_definition, lsp_implementation,
    lsp_references, lsp_rename, lsp_format,
};
pub use cli::{PendingCliPaths, get_cli_status, install_cli, uninstall_cli, take_pending_cli_paths};
pub use cli_providers::{list_cli_providers, reached_providers};
pub use mcp::{
    list_mcp_servers, save_mcp_server, delete_mcp_server, set_mcp_approval,
    import_mcp_servers, export_mcp_servers, test_mcp_server,
};
pub use native_agents::{
    list_native_agents, save_native_agent, delete_native_agent, duplicate_native_agent,
};
pub use skills::{
    list_skills, save_skill, delete_skill, duplicate_skill,
    add_skill_resources, delete_skill_resource,
};
pub use ports::{list_listening_ports, kill_process};
pub use projects::{list_projects, add_project, remove_project, update_project, duplicate_project, set_active_instance, get_listing, save_folders, save_project_order};
pub use settings::{get_settings, set_window_vibrancy, update_settings};
pub use shell::{run_shell_command, run_shell_command_with_stdin, open_in_terminal, reveal_in_file_manager, copy_path, validate_directory, clone_repository};
pub use terminal::{TerminalState, terminal_create, terminal_write, terminal_resize, terminal_close, terminal_close_all, get_terminal_state, save_terminal_state, get_project_terminal_state, save_project_terminal_state};
pub use tests::{TestState, has_cargo_nextest, run_tests, stop_tests};
pub use tests::state::{get_test_state, save_test_state};
pub use ui_state::{get_ui_state, save_ui_state};
pub use usage::{get_usage_entries, append_usage_entries, backfill_usage_entries, clear_usage_entries};
pub use fs_watch::{watch_worktree, unwatch_worktree, WatchState};
