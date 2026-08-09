use super::super::{
    emit_agent_for, platform, AgentProvider, AgentResponse, RunningChild, SendRequest,
};
use super::cli_common::{run_cli, with_transcript};

pub struct CopilotCliProvider;

/// The GitHub Copilot CLI has no machine-readable output: `-p` answers in plain
/// text and `-s` strips the decoration around it. So its answer is streamed as
/// it is written, there is no tool activity to show, and - since it exposes no
/// session id either - the conversation is replayed into the prompt instead of
/// resumed (see `keepsSession` in the provider catalogue).
impl AgentProvider for CopilotCliProvider {
    fn send(
        &self,
        app: &tauri::AppHandle,
        request: &SendRequest,
        handle: &RunningChild,
    ) -> Result<AgentResponse, String> {
        let opts = request.options;
        let binary_override = (!opts.binary_path.is_empty()).then_some(opts.binary_path.as_str());
        let binary = platform::resolve_binary("copilot", binary_override).ok_or(
            "GitHub Copilot CLI not found. Install it or set its path in the provider settings.",
        )?;

        let mut args: Vec<String> = vec![
            "-p".into(),
            with_transcript(&opts.history, request.message),
            "-s".into(),
            // Nothing can answer a question asked mid-run: the CLI is driven
            // without a terminal, so it must never stop to ask one.
            "--no-ask-user".into(),
        ];
        // The CLI documents its long options in the `--flag=value` form, and
        // that is the only spelling it is guaranteed to take.
        if !opts.model.is_empty() {
            args.push(format!("--model={}", opts.model));
        }
        // Nothing can approve a tool call mid-run either, so refusing them all
        // would leave an agent that can only talk. `ask` is the way out for
        // anyone who would rather it did: it grants only what is listed below.
        if opts.permission_mode != "ask" {
            args.push("--allow-all-tools".into());
        }
        for tool in &opts.allowed_tools {
            args.push(format!("--allow-tool={tool}"));
        }
        for tool in &opts.disallowed_tools {
            args.push(format!("--deny-tool={tool}"));
        }
        args.extend(opts.extra_args.iter().cloned());

        let wd = Some(request.working_dir.to_string());
        let rid = Some(request.run_id.to_string());

        run_cli(&binary, &args, &[], request, handle, |line| {
            emit_agent_for(
                app,
                format!("{line}\n"),
                "assistant",
                wd.clone(),
                rid.clone(),
                None,
            );
        })?;

        Ok(AgentResponse { session_id: None })
    }
}
