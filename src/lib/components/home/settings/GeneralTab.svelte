<script lang="ts">
  const ROWS = [
    { label: 'AI provider',       value: 'Claude Code CLI',    desc: 'Agent Bridge driver' },
    { label: 'Default branch',    value: 'main',               desc: 'Base for new worktrees' },
    { label: 'Worktree location', value: '~/.cairn/worktrees', desc: 'Where git worktrees are created' },
    { label: 'Format on stage',   value: 'Prettier',           desc: 'Auto-format before staging' },
  ];
</script>

<div class="settings-group">
  <div class="settings-group-title">General</div>
  {#each ROWS as s}
    <div class="settings-row">
      <div class="settings-row-info">
        <span class="settings-row-label">{s.label}</span>
        <span class="settings-row-desc">{s.desc}</span>
      </div>
      <span class="settings-row-value">{s.value}</span>
    </div>
  {/each}
</div>
