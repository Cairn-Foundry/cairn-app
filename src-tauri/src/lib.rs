pub mod storage;
pub mod commands;

use commands::AgentState;
use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AgentState::new())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, SubmenuBuilder};
                let menu = MenuBuilder::new(app)
                    .item(
                        &SubmenuBuilder::new(app, "Cairn")
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
            run_shell_command,
            run_shell_command_with_stdin,
            run_agent_command,
            list_projects,
            add_project,
            remove_project,
            update_project,
            duplicate_project,
            reveal_in_file_manager,
            copy_path,
            open_in_terminal,
            validate_directory,
            validate_git_repo,
            clone_repository,
            list_branches,
            list_instances,
            create_instance,
            duplicate_instance,
            delete_instance,
            set_active_instance,
            get_listing,
            save_folders,
            save_project_order,
            read_dir_tree,
            read_file,
            write_file,
            delete_path,
            rename_path,
            create_file_or_dir,
            get_settings,
            update_settings,
            git_status,
            git_diff_unstaged,
            git_diff_staged,
            git_diff_file,
            git_file_at_head,
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
            git_log,
            search_in_files,
            send_message,
            reset_agent_session,
            stop_agent,
            get_ui_state,
            save_ui_state,
            get_commit_state,
            save_commit_state,
            get_file_state,
            save_file_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
