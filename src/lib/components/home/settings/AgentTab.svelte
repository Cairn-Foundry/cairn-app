<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { RESPONSE_STAT_FIELDS } from '$lib/utils/agent/response-stats';
  import { settings } from '$lib/stores/settings';
  import type { CairnSettings } from '$lib/services/settings-service';

  type BooleanKey = {
    [K in keyof CairnSettings]: CairnSettings[K] extends boolean ? K : never;
  }[keyof CairnSettings];

  interface ToggleRow {
    key: BooleanKey;
    label: string;
    desc: string;
  }

  interface ToggleGroup {
    title: string;
    rows: ToggleRow[];
  }

  const s = t as (k: string) => string;

  const groups: ToggleGroup[] = [
    {
      title: s('settings.agent.messagesGroup'),
      rows: [
        { key: 'agentShowMessageTime', label: s('settings.agent.showMessageTime'), desc: s('settings.agent.showMessageTimeDesc') },
        { key: 'agentShowThinking', label: s('settings.agent.showThinking'), desc: s('settings.agent.showThinkingDesc') },
        { key: 'agentShowMessageCopy', label: s('settings.agent.showMessageCopy'), desc: s('settings.agent.showMessageCopyDesc') },
        { key: 'agentShowResponseStats', label: s('settings.agent.showResponseStats'), desc: s('settings.agent.showResponseStatsDesc') },
      ],
    },
    {
      title: s('settings.agent.composerGroup'),
      rows: [
        { key: 'agentShowModelChip', label: s('settings.agent.showModelChip'), desc: s('settings.agent.showModelChipDesc') },
        { key: 'agentShowEffortChip', label: s('settings.agent.showEffortChip'), desc: s('settings.agent.showEffortChipDesc') },
        { key: 'agentShowPermissionChip', label: s('settings.agent.showPermissionChip'), desc: s('settings.agent.showPermissionChipDesc') },
        { key: 'agentShowContextWindow', label: s('settings.agent.showContextWindow'), desc: s('settings.agent.showContextWindowDesc') },
        { key: 'agentShowConversationCost', label: s('settings.agent.showConversationCost'), desc: s('settings.agent.showConversationCostDesc') },
        { key: 'agentShowRateLimit', label: s('settings.agent.showRateLimit'), desc: s('settings.agent.showRateLimitDesc') },
      ],
    },
    {
      title: s('settings.agent.activityGroup'),
      rows: [
        { key: 'agentShowLiveActivity', label: s('settings.agent.showLiveActivity'), desc: s('settings.agent.showLiveActivityDesc') },
        { key: 'agentActivityShowTime', label: s('settings.agent.activityShowTime'), desc: s('settings.agent.activityShowTimeDesc') },
        { key: 'agentActivityShowToolArgs', label: s('settings.agent.activityShowToolArgs'), desc: s('settings.agent.activityShowToolArgsDesc') },
        { key: 'agentActivityAutoScroll', label: s('settings.agent.activityAutoScroll'), desc: s('settings.agent.activityAutoScrollDesc') },
      ],
    },
  ];

  function toggle(key: BooleanKey, checked: boolean) {
    settings.save({ [key]: checked } as Partial<CairnSettings>);
  }

  $: activityDisabled = !$settings.agentShowLiveActivity;

  function isDimmed(key: BooleanKey): boolean {
    return activityDisabled && key.startsWith('agentActivity');
  }

  function toggleStat(id: string) {
    const current = $settings.agentResponseStats;
    settings.save({
      agentResponseStats: current.includes(id)
        ? current.filter((s) => s !== id)
        : RESPONSE_STAT_FIELDS.map((f) => f.id).filter((f) => f === id || current.includes(f)),
    });
  }
</script>

{#each groups as group}
  <div class="settings-group">
    <div class="settings-group-title">{group.title}</div>
    {#each group.rows as row}
      {@const hasPicker = row.key === 'agentShowResponseStats'}
      <div class="settings-row" class:dimmed={isDimmed(row.key)} class:with-picker={hasPicker}>
        <div class="settings-row-head">
          <div class="settings-row-info">
            <span class="settings-row-label">{row.label}</span>
            <span class="settings-row-desc">{row.desc}</span>
          </div>
          <label class="settings-toggle" aria-label={row.label}>
            <input
              type="checkbox"
              checked={$settings[row.key]}
              disabled={isDimmed(row.key)}
              on:change={(e) => toggle(row.key, (e.currentTarget as HTMLInputElement).checked)}
            />
            <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
          </label>
        </div>
        {#if hasPicker && $settings.agentShowResponseStats}
          <div class="stat-picker">
            {#each RESPONSE_STAT_FIELDS as field}
              <button
                class="stat-chip"
                class:on={$settings.agentResponseStats.includes(field.id)}
                aria-pressed={$settings.agentResponseStats.includes(field.id)}
                on:click={() => toggleStat(field.id)}
              >
                <Icon name={field.icon} size={11}/>
                {t(`settings.agent.stat.${field.id}`)}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/each}

<style>
  /* A row that owns a picker stacks it under its own label, inside the card. */
  .with-picker { flex-direction: column; align-items: stretch; gap: 10px; }

  .settings-row-head {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .stat-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding-top: 10px;
    border-top: 1px solid var(--stroke-0);
  }

  .stat-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    font-size: 11.5px;
    color: var(--fg-3);
    background: var(--bg-1);
    border: 1px solid var(--stroke-0);
    border-radius: 99px;
    cursor: pointer;
    transition: color .12s, border-color .12s, background .12s;
  }
  .stat-chip:hover { color: var(--fg-0); }
  .stat-chip.on {
    color: var(--accent);
    border-color: var(--accent-line);
    background: var(--accent-weak);
  }

  .dimmed { opacity: 0.5; }
  .dimmed .settings-toggle { cursor: not-allowed; }
</style>
