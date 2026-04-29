<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { settings } from '$lib/stores/settings';
  import { SAVE_ON_OPTIONS } from '$lib/utils/home/appearance';
  import type { CairnSettings } from '$lib/services/settings-service';

  let saveOnOpen = false;

  $: saveOnLabel = SAVE_ON_OPTIONS.find(o => o.value === ($settings.saveOn))?.label ?? 'Focus change';
</script>

<svelte:window on:keydown={(e) => { if (e.key === 'Escape' && saveOnOpen) saveOnOpen = false; }} />

<div class="settings-group">
  <div class="settings-group-title">Layout</div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">Sidebar position</span>
      <span class="settings-row-desc">Move the file explorer to the left or right of the editor.</span>
    </div>
    <div class="sidebar-pos-toggle">
      <button
        class="sidebar-pos-btn {($settings.sidebarPosition) === 'left' ? 'active' : ''}"
        on:click={() => settings.save({ sidebarPosition: 'left' })}
      >Left</button>
      <button
        class="sidebar-pos-btn {($settings.sidebarPosition) === 'right' ? 'active' : ''}"
        on:click={() => settings.save({ sidebarPosition: 'right' })}
      >Right</button>
    </div>
  </div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">File tree panel width</span>
      <span class="settings-row-desc">Width of the file explorer sidebar in the Files view.</span>
    </div>
    <div class="settings-row-control">
      <input
        class="settings-number-input"
        type="number"
        min="140"
        max="480"
        value={$settings.treePanelWidth}
        on:change={(e) => {
          const v = parseInt((e.target as HTMLInputElement).value, 10);
          if (!isNaN(v)) settings.save({ treePanelWidth: Math.max(140, Math.min(480, v)) });
        }}
      />
      <span class="settings-row-unit">px</span>
      <button class="settings-reset-btn" title="Reset to default (220 px)" on:click={() => settings.save({ treePanelWidth: 220 })}>
        <Icon name="undo" size={12}/>
      </button>
    </div>
  </div>
</div>

<div class="settings-group">
  <div class="settings-group-title">Code editor</div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">Font size</span>
      <span class="settings-row-desc">Base font size for the code editor.</span>
    </div>
    <div class="settings-row-control">
      <input
        class="settings-number-input"
        type="number"
        min="8"
        max="32"
        value={$settings.editorFontSize}
        on:change={(e) => {
          const v = parseInt((e.target as HTMLInputElement).value, 10);
          if (!isNaN(v)) settings.save({ editorFontSize: Math.max(8, Math.min(32, v)) });
        }}
      />
      <span class="settings-row-unit">px</span>
      <button class="settings-reset-btn" title="Reset to default (13 px)" on:click={() => settings.save({ editorFontSize: 13 })}>
        <Icon name="undo" size={12}/>
      </button>
    </div>
  </div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">Show minimap</span>
      <span class="settings-row-desc">Scrollbar overview panel on the right side of the code editor.</span>
    </div>
    <label class="settings-toggle" aria-label="Toggle minimap">
      <input
        type="checkbox"
        checked={$settings.showMinimap}
        on:change={(e) => settings.save({ showMinimap: (e.target as HTMLInputElement).checked })}
      />
      <span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>
    </label>
  </div>
  <div class="settings-row">
    <div class="settings-row-info">
      <span class="settings-row-label">Save on</span>
      <span class="settings-row-desc">When the editor automatically saves open files to disk.</span>
    </div>
    <div class="so-dropdown" class:so-open={saveOnOpen}>
      <button
        type="button"
        class="so-trigger"
        on:click={() => saveOnOpen = !saveOnOpen}
        aria-haspopup="listbox"
        aria-expanded={saveOnOpen}
      >
        <span>{saveOnLabel}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" class="so-chevron">
          <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      {#if saveOnOpen}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="so-backdrop" on:click={() => saveOnOpen = false} on:keydown={() => {}}></div>
        <div class="so-menu" role="listbox">
          {#each SAVE_ON_OPTIONS as opt}
            {@const active = ($settings.saveOn) === opt.value}
            <button
              type="button"
              role="option"
              aria-selected={active}
              class="so-item"
              class:so-item-active={active}
              on:click={() => { settings.save({ saveOn: opt.value as CairnSettings['saveOn'] }); saveOnOpen = false; }}
            >
              <span class="so-check">{#if active}<svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4.5l3 3 6-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}</span>
              <span class="so-item-body">
                <span class="so-item-label">{opt.label}</span>
                <span class="so-item-desc">{opt.desc}</span>
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
<div class="settings-section-reset">
  <button
    class="btn ghost"
    style="font-size: 12px;"
    on:click={() => settings.save({ treePanelWidth: 220, showMinimap: true, editorFontSize: 13, sidebarPosition: 'left' })}
  >
    <Icon name="undo" size={12}/> Reset editor
  </button>
</div>

<style>
  .sidebar-pos-toggle {
    display: flex;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    padding: 2px;
    gap: 2px;
    flex-shrink: 0;
  }
  .sidebar-pos-btn {
    padding: 4px 12px;
    font-size: 12px;
    color: var(--fg-2);
    border-radius: 3px;
    font-family: var(--font-ui);
    transition: background .1s, color .1s;
  }
  .sidebar-pos-btn:hover { color: var(--fg-0); }
  .sidebar-pos-btn.active { background: var(--bg-3); color: var(--fg-0); }

  .so-dropdown { position: relative; flex-shrink: 0; }
  .so-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-1);
    font-family: var(--font-ui);
    font-size: 12px;
    cursor: pointer;
    min-width: 130px;
    justify-content: space-between;
    transition: border-color .15s, color .15s;
  }
  .so-trigger:hover { border-color: var(--stroke-1); color: var(--fg-0); }
  .so-open .so-trigger { border-color: var(--accent); color: var(--fg-0); }
  .so-chevron { transition: transform .15s; color: var(--fg-3); flex-shrink: 0; }
  .so-open .so-chevron { transform: rotate(180deg); }
  .so-backdrop { position: fixed; inset: 0; z-index: 1000; }
  .so-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 1001;
    background: var(--bg-2);
    border: 1px solid var(--stroke-1);
    border-radius: 6px;
    padding: 4px;
    box-shadow: 0 6px 20px rgba(0,0,0,.45);
    min-width: 210px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .so-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 4px;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background .1s;
  }
  .so-item:hover { background: var(--bg-4); }
  .so-item-active { background: var(--bg-3); }
  .so-check {
    width: 14px;
    flex-shrink: 0;
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .so-item-body { display: flex; flex-direction: column; gap: 1px; }
  .so-item-label { font-size: 12px; font-family: var(--font-ui); color: var(--fg-0); line-height: 1.3; }
  .so-item-desc { font-size: 11px; font-family: var(--font-ui); color: var(--fg-3); line-height: 1.3; }
</style>
