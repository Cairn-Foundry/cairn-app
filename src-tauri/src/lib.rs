// Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Application entry point: builds the Tauri app, registers the managed state
//! and wires every `#[tauri::command]` exposed to the frontend.

//! Application entry point: builds the Tauri app, registers the managed state
//! and wires every `#[tauri::command]` exposed to the frontend.

pub mod storage;
pub mod commands;

use commands::{LspState, OneshotState, TerminalState, TestState};
use commands::*;
use serde::Serialize;
use tauri::{Emitter, Manager};

/// The parsed arguments of a second launch of the binary, forwarded to the
/// running instance as a `cli-open` event.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliOpenRequest {
    #[serde(flatten)]
    request: commands::cli::CliRequest,
    cwd: String,
}

/// Brings the already running window back to the front, including when it was
/// minimized or hidden.
#[cfg(desktop)]
fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Builds and runs the app: plugins, managed state, the macOS menu bar, the
/// command handlers, and the LSP shutdown on exit.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // The single-instance lock exists to keep two processes from writing one
    // data directory. A beta or dev build owns a different one, so it is left
    // out of the lock - it would otherwise share the release build's, which is
    // keyed on the bundle identifier the two have in common, and the second
    // launch would fold into the first instead of opening its own window.
    #[cfg(desktop)]
    let builder = if storage::channel() == storage::Channel::Release {
        builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            focus_main_window(app);
            let base = std::path::PathBuf::from(&cwd);
            let args: Vec<String> = argv.into_iter().skip(1).collect();
            let request = commands::cli::parse_cli_args(&args, &base);
            if !request.paths.is_empty() || request.open_dir.is_some() || request.clone_url.is_some()
            {
                let _ = app.emit("cli-open", CliOpenRequest { request, cwd });
            }
        }))
    } else {
        builder
    };

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .register_asynchronous_uri_scheme_protocol("cairn", |_ctx, request, responder| {
            std::thread::spawn(move || responder.respond(commands::file_protocol::respond(&request)));
        })
        .manage(OneshotState::new())
        .manage(TerminalState::new())
        .manage(TestState::new())
        .manage(LspState::new())
        .manage(commands::WatchState::default())
        .manage(QuickSearchCache::default())
        .manage(IntegrationState::default())
        .manage(PendingCliPaths::from_args())
        .setup(|app| {
            commands::lsp::spawn_idle_reaper(app.handle().clone());
            commands::memory_log::spawn_sampler();

            /* Transparency is decided when the window is created and cannot be
               changed afterwards, so the window is built here rather than
               declared in tauri.conf.json. A transparent window is composited
               with alpha every frame, which costs the webview its opaque fast
               path while scrolling, which is what the transparency effects
               setting trades away. */
            let transparent = commands::settings::read_settings()
                .map(|s| s.transparency_effects)
                .unwrap_or(true);
            // A beta or dev build says so in its title: it is otherwise
            // indistinguishable from the installed app, and the two are meant to
            // run side by side.
            let title = match storage::channel().label() {
                Some(label) => format!("Cairn Foundry ({label})"),
                None => "Cairn Foundry".to_string(),
            };
            let builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::default(),
            )
            .title(&title)
            .inner_size(1440.0, 900.0)
            .min_inner_size(480.0, 360.0)
            .resizable(true)
            .transparent(transparent);
            #[cfg(target_os = "macos")]
            let builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);
            builder.build()?;
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, SubmenuBuilder};
                let menu = MenuBuilder::new(app)
                    .item(
                        &SubmenuBuilder::new(app, "Cairn Foundry")
                            .about(None)
                            .separator()
                            .quit()
                            .build()?
                    )
                    .item(
                        &SubmenuBuilder::new(app, "Edit")
                            .undo()
                            .redo()
                            .separator()
                            .cut()
                            .copy()
                            .paste()
                            .select_all()
                            .build()?
                    )
                    .build()?;
                app.set_menu(menu)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_cli_status,
            install_cli,
            uninstall_cli,
            take_pending_cli_paths,
            run_shell_command,
            run_shell_command_with_stdin,
            list_projects,
            add_project,
            remove_project,
            update_project,
            duplicate_project,
            reveal_in_file_manager,
            copy_path,
            open_in_terminal,
            validate_directory,
            clone_repository,
            list_branches,
            list_instances,
            create_instance,
            duplicate_instance,
            delete_instance,
            update_instance_status,
            update_instance_ticket,
            update_instance_base_branch,
            set_active_instance,
            get_listing,
            save_folders,
            save_project_order,
            read_dir_tree,
            quick_search,
            list_dir_names,
            list_dir_names_deep,
        file_mtimes,
            read_file_preview,
            read_file_base64,
            write_file,
            delete_path,
            rename_path,
            create_file_or_dir,
            get_settings,
            get_channel,
            update_settings,
            set_window_vibrancy,
            list_branches_detailed,
            suggest_base_branches,
            is_git_repo,
            git_forget_repo_roots,
            git_status,
            git_changed_paths,
            git_status_full,
            git_check_ignore,
            git_read_exclude,
            git_write_exclude,
            git_diff_unstaged,
            git_diff_staged,
            git_blame_file,
            git_file_at_head,
            git_file_in_index,
            git_stage_file,
            git_unstage_file,
            git_stage_all,
            git_unstage_all,
            git_get_identity,
            git_commit,
            git_amend_commit,
            git_current_branch,
            git_checkout_branch,
            git_create_branch,
            git_delete_branch,
            git_push,
            git_pull,
            git_fetch,
            git_remote_status,
            git_remote_url,
            git_branch_divergence,
            git_remove_index_lock,
            git_operation_state,
            git_rm,
            git_merge,
            git_merge_continue,
            git_merge_abort,
            git_rebase,
            git_rebase_continue,
            git_rebase_skip,
            git_rebase_abort,
            git_log,
            git_graph,
            git_head_message,
            git_diff_commit,
            git_commit_body,
            git_diff_files_between,
            git_diff_file_between,
            git_commit_exists,
            git_stash_list,
            git_stash_push,
            git_stash_pop,
            git_stash_apply,
            git_snapshot,
            git_diffs,
            read_dir_tree_cached,
            watch_dirs,
            unwatch_worktree,
            git_stash_drop,
            git_tag_list,
            git_tag_create,
            git_tag_delete,
            git_tag_push,
            git_tag_delete_remote,
            git_stash_show,
            git_stash_clear,
            git_stash_rename,
            git_revert_commit,
            git_discard_file,
            search_in_files,
            set_provider_api_key,
            get_api_key_statuses,
            delete_provider_api_key,
            terminal_create,
            terminal_write,
            terminal_resize,
            terminal_close,
            terminal_close_all,
            terminal_has_children,
            get_terminal_state,
            save_terminal_state,
            get_project_terminal_state,
            save_project_terminal_state,
            get_ui_state,
            save_ui_state,
            has_cargo_nextest,
            run_tests,
            stop_tests,
            get_test_state,
            save_test_state,
            list_listening_ports,
            kill_process,
            get_commit_state,
            get_diff_unified,
            get_diff_hunks,
            load_review_state,
            save_review_state,
            save_commit_state,
            get_conversation_index,
            save_conversation_index,
            get_file_state,
            save_file_state,
            get_git_collapse_state,
            save_git_collapse_state,
            get_project_commands,
            save_project_commands,
            run_oneshot,
            list_oneshot_providers,
            stop_oneshot,
            list_cli_providers,
            discover_cli_session,
            reached_providers,
            list_native_agents,
            save_native_agent,
            delete_native_agent,
            duplicate_native_agent,
            list_skills,
            save_skill,
            delete_skill,
            duplicate_skill,
            add_skill_resources,
            delete_skill_resource,
            list_mcp_servers,
            save_mcp_server,
            delete_mcp_server,
            set_mcp_approval,
            import_mcp_servers,
            export_mcp_servers,
            test_mcp_server,
            get_global_commands,
            save_global_commands,
            get_command_state,
            save_command_state,
            allocate_port,
            get_global_env,
            save_global_env,
            get_project_env,
            save_project_env,
            get_instance_env,
            save_instance_env,
            read_env_file,
            write_env_file,
            delete_env_file,
            ensure_env_ignored,
            list_language_servers,
            install_language_server,
            uninstall_language_server,
            uninstall_manager_for,
            update_language_server,
            update_manager_for,
            check_language_server_updates,
            cancel_language_server_command,
            start_language_server,
            stop_language_servers_with_id,
            stop_language_servers_for,
            lsp_did_open,
            lsp_did_change,
            lsp_did_save,
            lsp_did_close,
            lsp_completion,
            lsp_hover,
            lsp_signature_help,
            lsp_definition,
            lsp_implementation,
            lsp_references,
            lsp_rename,
            lsp_format,
            get_project_formatting,
            save_project_formatting,
            list_formatters,
            list_style_options,
            format_document,
            detect_repo_formatters,
            import_formatting_config,
            export_formatting_config,
            install_formatter,
            uninstall_formatter,
            update_formatter,
            uninstall_manager_for_formatter,
            update_manager_for_formatter,
            integration_kinds,
            list_integration_connections,
            save_integration_connection,
            delete_integration_connection,
            test_integration_connection,
            get_project_integrations,
            save_project_integrations,
            suggest_project_integrations,
            get_project_capabilities,
            list_tracker_projects,
            tracker_list_tickets,
            tracker_get_ticket,
            tracker_resolve_url,
            tracker_list_transitions,
            tracker_list_statuses,
            tracker_transition,
            forge_find_merge_request,
            forge_create_merge_request,
            forge_list_discussions,
            forge_reply,
            forge_resolve,
            forge_approve,
            forge_create_discussion,
            forge_submit_review,
            forge_list_members,
            forge_list_labels,
            forge_web_link,
            ci_list_pipelines,
            ci_get_pipeline,
            ci_job_log,
            ci_retry_job,
            ci_cancel_pipeline,
            ci_play_job,
            integration_watch,
            integration_unwatch,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                commands::terminal::shutdown(app);
                commands::lsp::shutdown(app);
                commands::integrations::shutdown(app);
            }
        });
}
