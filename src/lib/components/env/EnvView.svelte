<script lang="ts">
  import CopyButton from '$lib/components/CopyButton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Skeleton from '$lib/components/Skeleton.svelte';
  import EnvEditor from '$lib/components/env/EnvEditor.svelte';
  import EnvImport from '$lib/components/env/EnvImport.svelte';
  import { t } from '$lib/i18n';
  import { writeFile } from '$lib/services/file-service';
  import type { EnvScope, EnvVariable } from '$lib/services/env-service';
  import { deleteEnvFile, emptyEnvFile, readEnvFile } from '$lib/services/env-service';
  import {
    addVariables,
    envFileConflicts,
    envKey,
    globalEnv,
    instanceEnvs,
    loadEnv,
    moveVariable,
    newVariable,
    projectEnvs,
    removeVariable,
    resolvedEnv,
    scopeVariables,
    setOverride,
    setProjectEnvOptions,
    syncEnvFile,
    toggleVariableEnabled,
    updateVariable,
  } from '$lib/stores/env';
  import { activeInstance } from '$lib/stores/instance';
  import { activeProject } from '$lib/stores/project';
  import { type ParsedEnvEntry, parseEnvFile, serializeEnvFile } from '$lib/utils/env/env-file';
  import { computeTabInsertIndex } from '$lib/utils/files/files-tab-drag';

  let editing: { scope: EnvScope; variable: EnvVariable; isNew: boolean } | null = null;
  let importing = false;
  let revealed = new Set<string>();
  let loading = true;

  let bodyEls: Partial<Record<EnvScope, HTMLDivElement>> = {};
  let drag: { scope: EnvScope; index: number; id: string } | null = null;
  let dropAt: { scope: EnvScope; index: number } | null = null;
  let dragActive = false;
  let dragStartX = 0;
  let dragStartY = 0;

  const DRAG_THRESHOLD = 6;

  $: projectId = $activeProject?.id ?? null;
  $: instanceId = $activeInstance?.id ?? null;

  $: if (projectId) {
    void loadEnv(projectId, instanceId).then(() => {
      loading = false;
      void syncEnvFile($activeProject, $activeInstance);
    });
  }

  $: projectFile = (projectId ? $projectEnvs[projectId] : null) ?? emptyEnvFile();
  $: instanceFile =
    (projectId && instanceId ? $instanceEnvs[envKey(projectId, instanceId)] : null) ??
    emptyEnvFile();
  $: conflict =
    projectId && instanceId ? ($envFileConflicts[envKey(projectId, instanceId)] ?? false) : false;

  $: sections = [
    {
      scope: 'global' as EnvScope,
      label: t('env.scope.global'),
      list: $globalEnv.variables,
      empty: t('env.globalEmpty'),
    },
    {
      scope: 'project' as EnvScope,
      label: t('env.scope.project'),
      list: projectFile.variables,
      empty: t('env.projectEmpty'),
    },
    {
      scope: 'instance' as EnvScope,
      label: t('env.scope.instance'),
      list: instanceFile.variables,
      empty: t('env.instanceEmpty'),
    },
  ];

  $: allKeys = sections.flatMap((s) => s.list.map((v) => v.key));

  function variablesOf(scope: EnvScope): EnvVariable[] {
    return sections.find((s) => s.scope === scope)?.list ?? [];
  }

  function toggleReveal(id: string) {
    const next = new Set(revealed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    revealed = next;
  }

  function displayValue(variable: EnvVariable, value: string): string {
    if (!value) return '';
    if (!variable.secret || revealed.has(variable.id)) return value;
    return '*'.repeat(Math.min(value.length, 12));
  }

  function startNew(scope: EnvScope) {
    editing = { scope, variable: newVariable(), isNew: true };
  }

  function startEdit(scope: EnvScope, variable: EnvVariable) {
    editing = { scope, variable, isNew: false };
  }

  async function saveEdited(detail: { variable: EnvVariable; scope: EnvScope }) {
    if (!editing || !projectId) return;
    const { variable, scope } = detail;
    if (editing.isNew) {
      addVariables(scope, projectId, instanceId, [variable]);
    } else {
      updateVariable(editing.scope, projectId, instanceId, variable);
      if (scope !== editing.scope) {
        moveVariable(
          editing.scope,
          scope,
          projectId,
          instanceId,
          variable.id,
          scopeVariables(scope, projectId, instanceId).length,
        );
      }
    }
    editing = null;
    await syncEnvFile($activeProject, $activeInstance);
  }

  async function drop(scope: EnvScope, id: string) {
    if (!projectId) return;
    removeVariable(scope, projectId, instanceId, id);
    await syncEnvFile($activeProject, $activeInstance);
  }

  async function toggleEnabled(scope: EnvScope, id: string) {
    if (!projectId) return;
    toggleVariableEnabled(scope, projectId, instanceId, id);
    await syncEnvFile($activeProject, $activeInstance);
  }

  async function writeOverride(variableId: string, value: string) {
    if (!projectId || !instanceId) return;
    setOverride(projectId, instanceId, variableId, value === '' ? null : value);
    await syncEnvFile($activeProject, $activeInstance);
  }

  async function applyImport(detail: {
    scope: EnvScope;
    entries: ParsedEnvEntry[];
    replace: boolean;
  }) {
    if (!projectId) return;
    if (detail.scope === 'instance' && !instanceId) return;
    importing = false;
    const existing = variablesOf(detail.scope);
    const added: EnvVariable[] = [];
    for (const entry of detail.entries) {
      const match = existing.find((v) => v.key === entry.key);
      if (match) {
        if (detail.replace) {
          updateVariable(detail.scope, projectId, instanceId, { ...match, value: entry.value });
        }
        continue;
      }
      added.push({ ...newVariable(entry.key, entry.value) });
    }
    if (added.length > 0) addVariables(detail.scope, projectId, instanceId, added);
    await syncEnvFile($activeProject, $activeInstance);
  }

  async function importWorktreeFile() {
    if (!$activeInstance || !projectId) return;
    const content = await readEnvFile($activeInstance.worktreePath, projectFile.envFileName).catch(
      () => '',
    );
    if (!content) return;
    await applyImport({ scope: 'instance', entries: parseEnvFile(content).entries, replace: true });
    await syncEnvFile($activeProject, $activeInstance, undefined, true);
  }

  function sectionAt(clientY: number): EnvScope | null {
    for (const section of sections) {
      const el = bodyEls[section.scope];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY >= rect.top - 12 && clientY <= rect.bottom + 12) return section.scope;
    }
    return null;
  }

  function dragPointerDown(e: PointerEvent, scope: EnvScope, index: number, id: string) {
    if ((e.target as Element).closest('button, input')) return;
    e.preventDefault();
    drag = { scope, index, id };
    dropAt = { scope, index };
    dragActive = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function dragPointerMove(e: PointerEvent) {
    if (!drag) return;
    if (!dragActive) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      dragActive = true;
      document.body.classList.add('dragging');
    }
    const scope = sectionAt(e.clientY) ?? drag.scope;
    dropAt = {
      scope,
      index: computeTabInsertIndex(bodyEls[scope] ?? null, e.clientY, {
        selector: '.env-row',
        axis: 'y',
      }),
    };
  }

  async function dragPointerUp() {
    const pending = drag && dropAt && dragActive ? { drag, dropAt } : null;
    drag = null;
    dropAt = null;
    dragActive = false;
    document.body.classList.remove('dragging');
    if (!pending || !projectId) return;
    if (pending.dropAt.scope === 'instance' && !instanceId) return;
    moveVariable(
      pending.drag.scope,
      pending.dropAt.scope,
      projectId,
      instanceId,
      pending.drag.id,
      pending.dropAt.index,
    );
    await syncEnvFile($activeProject, $activeInstance);
  }

  $: dropIndicator =
    dragActive && drag && dropAt &&
    (dropAt.scope !== drag.scope ||
      (dropAt.index !== drag.index && dropAt.index !== drag.index + 1))
      ? dropAt
      : null;

  async function exportEntries(entries: ParsedEnvEntry[], suffix: string) {
    if (entries.length === 0) return;
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: `${projectFile.envFileName}${suffix}` });
    if (!path) return;
    await writeFile(path, `${serializeEnvFile(entries)}\n`);
  }

  async function exportResolved() {
    await exportEntries(
      $resolvedEnv.map((entry) => ({ key: entry.key, value: entry.value })),
      '',
    );
  }

  async function exportScope(scope: EnvScope) {
    const entries = variablesOf(scope)
      .filter((v) => v.enabled && !v.perInstance)
      .map((v) => ({ key: v.key, value: v.value }));
    await exportEntries(entries, `.${scope}`);
  }

  async function setWriteFile(enabled: boolean) {
    if (!projectId) return;
    setProjectEnvOptions(projectId, { writeEnvFile: enabled });
    if (!enabled && $activeInstance) {
      await deleteEnvFile($activeInstance.worktreePath, projectFile.envFileName).catch(() => false);
    }
    await syncEnvFile($activeProject, $activeInstance);
  }

  async function setFileName(name: string) {
    if (!projectId) return;
    const next = name.trim();
    if (!next || next === projectFile.envFileName) return;
    setProjectEnvOptions(projectId, { envFileName: next });
    await syncEnvFile($activeProject, $activeInstance);
  }

</script>

<div class="env-view">
  <div class="env-head">
    <div class="env-head-text">
      <span class="env-title">{t('env.title')}</span>
      <span class="env-sub">{t('env.subtitle')}</span>
    </div>
    <div class="env-head-actions">
      <button class="btn ghost" disabled={!projectId} on:click={() => (importing = true)}>
        <Icon name="download" size={13}/> {t('env.import')}
      </button>
      <button class="btn ghost" disabled={$resolvedEnv.length === 0} on:click={exportResolved}>
        <Icon name="upload" size={13}/> {t('env.export')}
      </button>
      <button class="btn primary" disabled={!projectId} on:click={() => startNew('project')}>
        <Icon name="plus" size={13}/> {t('env.new')}
      </button>
    </div>
  </div>

  <div class="env-body">
    {#if conflict}
      <div class="env-banner">
        <Icon name="alert" size={14}/>
        <span class="env-banner-text">
          {(t('env.conflict') as (f: string) => string)(projectFile.envFileName)}
        </span>
        <button class="env-banner-action" on:click={importWorktreeFile}>{t('env.conflictImport')}</button>
      </div>
    {/if}

    <div class="env-file-options">
      <label class="env-check">
        <input
          type="checkbox"
          checked={projectFile.writeEnvFile}
          disabled={!projectId}
          on:change={(e) => setWriteFile(e.currentTarget.checked)}
        />
        <span>
          <span class="env-check-name">{t('env.writeFile')}</span>
          <span class="env-hint">{t('env.writeFileHint')}</span>
        </span>
      </label>
      <label class="env-file-name">
        <span class="env-field-label">{t('env.fileName')}</span>
        <input
          class="env-input mono selectable"
          value={projectFile.envFileName}
          disabled={!projectId || !projectFile.writeEnvFile}
          spellcheck="false"
          on:change={(e) => setFileName(e.currentTarget.value)}
        />
      </label>
    </div>

    {#if loading}
      <div class="env-loading"><Skeleton lines={5}/></div>
    {:else}
      {#each sections as section (section.scope)}
        <div class="env-section">
          <div class="env-section-head">
            <span>{section.label}</span>
            <span class="env-section-actions">
              <button
                class="env-section-btn"
                title={t('env.exportScope') as string}
                aria-label={t('env.exportScope') as string}
                disabled={section.list.length === 0}
                on:click={() => exportScope(section.scope)}
              >
                <Icon name="upload" size={13}/>
              </button>
              <button
                class="env-section-btn"
                title={t('env.new') as string}
                aria-label={t('env.new') as string}
                disabled={!projectId || (section.scope === 'instance' && !instanceId)}
                on:click={() => startNew(section.scope)}
              >
                <Icon name="plus" size={13}/>
              </button>
            </span>
          </div>

          <div class="env-list" bind:this={bodyEls[section.scope]}>
            {#each section.list as variable, i (variable.id)}
              {@const scoped = section.scope !== 'instance' && variable.perInstance}
              {#if dropIndicator?.scope === section.scope && dropIndicator.index === i}<div class="env-drop"></div>{/if}
              <div
                class="env-row"
                class:disabled={!variable.enabled}
                class:dragging={dragActive && drag?.id === variable.id}
                role="button"
                tabindex="0"
                on:pointerdown={(e) => dragPointerDown(e, section.scope, i, variable.id)}
                on:pointermove={dragPointerMove}
                on:pointerup={dragPointerUp}
                on:keydown={(e) => { if (e.key === 'Enter') startEdit(section.scope, variable); }}
              >
                <button
                  class="env-toggle"
                  title={(variable.enabled ? t('env.disable') : t('env.enable')) as string}
                  aria-label={(variable.enabled ? t('env.disable') : t('env.enable')) as string}
                  on:click|stopPropagation={() => toggleEnabled(section.scope, variable.id)}
                >
                  <Icon name={variable.enabled ? 'check' : 'circle'} size={12}/>
                </button>

                <span class="env-key mono selectable">{variable.key}</span>

                {#if scoped}
                  <input
                    class="env-input mono selectable env-override"
                    type={variable.secret && !revealed.has(variable.id) ? 'password' : 'text'}
                    value={instanceFile.overrides[variable.id] ?? ''}
                    disabled={!instanceId}
                    placeholder={t('env.overridePlaceholder') as string}
                    spellcheck="false"
                    on:change={(e) => writeOverride(variable.id, e.currentTarget.value)}
                  />
                {:else}
                  <span class="env-value mono selectable">{displayValue(variable, variable.value)}</span>
                {/if}

                <span class="env-badges">
                  {#if scoped}<span class="env-badge">{t('env.badgePerInstance')}</span>{/if}
                  {#if variable.secret}<span class="env-badge"><Icon name="lock" size={10}/></span>{/if}
                </span>

                <span class="env-spacer"></span>

                <span class="env-actions">
                  {#if variable.secret}
                    <button
                      class="env-action"
                      title={(revealed.has(variable.id) ? t('env.hide') : t('env.reveal')) as string}
                      aria-label={(revealed.has(variable.id) ? t('env.hide') : t('env.reveal')) as string}
                      on:click|stopPropagation={() => toggleReveal(variable.id)}
                    >
                      <Icon name="eye" size={12}/>
                    </button>
                  {/if}
                  <button class="env-action" title={t('common.edit') as string} aria-label={t('common.edit') as string} on:click|stopPropagation={() => startEdit(section.scope, variable)}>
                    <Icon name="edit" size={12}/>
                  </button>
                  <button class="env-action danger" title={t('common.delete') as string} aria-label={t('common.delete') as string} on:click|stopPropagation={() => drop(section.scope, variable.id)}>
                    <Icon name="trash" size={12}/>
                  </button>
                </span>
              </div>
            {/each}
            {#if dropIndicator?.scope === section.scope && dropIndicator.index === section.list.length}<div class="env-drop"></div>{/if}
            {#if section.list.length === 0}
              <p class="env-empty">{section.empty}</p>
            {/if}
          </div>
        </div>
      {/each}

      <div class="env-section">
        <div class="env-section-head"><span>{t('env.resolved')}</span></div>
        <div class="env-list">
          {#each $resolvedEnv as entry (entry.key)}
            <div class="env-row resolved">
              <span class="env-key mono selectable">{entry.key}</span>
              <span class="env-value mono selectable">
                {entry.secret && !revealed.has(entry.variableId)
                  ? '*'.repeat(Math.min(entry.value.length, 12))
                  : entry.value}
              </span>
              <CopyButton value={entry.value}/>
              <span class="env-spacer"></span>
              <span class="env-badge">{t(`env.scope.${entry.scope}`)}</span>
            </div>
          {/each}
          {#if $resolvedEnv.length === 0}
            <p class="env-empty">{t('env.resolvedEmpty')}</p>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

{#if editing}
  <EnvEditor
    variable={editing.variable}
    scope={editing.scope}
    isNew={editing.isNew}
    canUseInstance={!!instanceId}
    on:save={(e) => saveEdited(e.detail)}
    on:close={() => (editing = null)}
  />
{/if}

{#if importing}
  <EnvImport
    worktreePath={$activeInstance?.worktreePath ?? null}
    defaultFileName={projectFile.envFileName}
    existingKeys={allKeys}
    on:import={(e) => applyImport(e.detail)}
    on:close={() => (importing = false)}
  />
{/if}

<style>
  .env-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--bg-0);
  }

  .env-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--stroke-0);
  }

  .env-head-text { display: flex; flex-direction: column; gap: 3px; }
  .env-title { font-size: 13px; color: var(--fg-0); }
  .env-sub { font-size: 11.5px; color: var(--fg-4); line-height: 1.4; }
  .env-head-actions { display: flex; gap: 8px; flex-shrink: 0; }

  .env-body { flex: 1; overflow-y: auto; padding: 12px 16px 20px; }

  .env-loading { padding: 8px 0; }

  .env-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 11px;
    margin-bottom: 12px;
    background: var(--warning-weak);
    border: 1px solid var(--warning);
    border-radius: var(--r-sm);
    color: var(--warning);
  }
  .env-banner-text { flex: 1; font-size: 11.5px; line-height: 1.5; }

  .env-banner-action {
    flex-shrink: 0;
    padding: 4px 10px;
    background: transparent;
    border: 1px solid var(--warning);
    border-radius: var(--r-sm);
    color: var(--warning);
    font-size: 11.5px;
    font-family: var(--font-ui);
    cursor: pointer;
  }
  .env-banner-action:hover { background: var(--warning); color: var(--bg-0); }

  .env-file-options {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 11px;
    margin-bottom: 16px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
  }

  .env-check { display: flex; align-items: flex-start; gap: 9px; cursor: pointer; }
  .env-check span { display: flex; flex-direction: column; gap: 2px; }
  .env-check-name { font-size: 12.5px; color: var(--fg-1); }
  .env-hint { font-size: 11px; color: var(--fg-4); line-height: 1.5; }

  .env-file-name { display: flex; align-items: center; gap: 9px; flex-shrink: 0; }
  .env-file-name .env-input { width: 150px; padding: 6px 9px; }
  .env-field-label {
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-3);
  }


  .env-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-0);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-sm);
    padding: 8px 10px;
    font-size: 13px;
    color: var(--fg-0);
    font-family: var(--font-ui);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .env-input:focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-weak); }
  .env-input::placeholder { color: var(--fg-4); }
  .env-input.mono { font-family: var(--font-mono); font-size: 12px; }
  .env-input:disabled { opacity: 0.5; cursor: default; }

  .env-section { margin-bottom: 18px; }

  .env-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 0 8px;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .env-section-actions { display: flex; gap: 4px; }

  .env-section-btn {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-2);
    cursor: pointer;
  }
  .env-section-btn:hover:not(:disabled) { background: var(--accent-weak); border-color: var(--accent); color: var(--fg-0); }
  .env-section-btn:disabled { opacity: 0.4; cursor: default; }

  .env-list { display: flex; flex-direction: column; gap: 4px; }

  .env-drop {
    height: 2px;
    background: var(--accent, #6c8eff);
    border-radius: 1px;
    pointer-events: none;
  }

  .env-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    background: var(--bg-1);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    text-align: left;
  }
  .env-row:hover { border-color: var(--stroke-1); }
  .env-row.disabled { opacity: 0.5; }
  .env-row.dragging { opacity: 0.4; cursor: grabbing; }

  .env-toggle {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--r-xs);
    color: var(--fg-3);
    cursor: pointer;
  }
  .env-toggle:hover { background: var(--bg-4); color: var(--fg-0); }

  .env-key {
    flex: 0 0 auto;
    min-width: 140px;
    max-width: 40%;
    font-size: 12px;
    color: var(--fg-0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .env-value {
    flex: 0 1 auto;
    min-width: 0;
    font-size: 11.5px;
    color: var(--fg-4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .env-spacer { flex: 1; }

  .env-override { flex: 1; min-width: 0; padding: 4px 8px; font-size: 11.5px; }

  .env-badges { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

  .env-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-xs);
    font-size: 10.5px;
    color: var(--fg-4);
    flex-shrink: 0;
  }

  .env-actions { display: flex; gap: 2px; flex-shrink: 0; opacity: 0; transition: opacity 0.12s; }
  .env-row:hover .env-actions,
  .env-row:focus-within .env-actions { opacity: 1; }

  .env-action {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--r-xs);
    color: var(--fg-3);
    cursor: pointer;
  }
  .env-action:hover:not(:disabled) { background: var(--bg-4); color: var(--fg-0); }
  .env-action.danger:hover { color: var(--danger, oklch(0.62 0.18 15)); }

  .env-empty {
    margin: 0;
    padding: 2px 2px 6px;
    font-size: 11.5px;
    color: var(--fg-4);
    line-height: 1.5;
  }
</style>
