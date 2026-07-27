<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import IconPicker from '$lib/components/IconPicker.svelte';
  import ProjectColorPicker from '$lib/components/ProjectColorPicker.svelte';
  import { t } from '$lib/i18n';
  import type { CommandCwd, CustomCommand } from '$lib/services/custom-command-service';
  import { findInvalidPortTokens, VARIABLE_KEYS } from '$lib/utils/commands/command-variables';
  import { computeTabInsertIndex } from '$lib/utils/files/files-tab-drag';
  import { PROJECT_COLORS } from '$lib/utils/home/appearance';
  import { moveItem } from '$lib/utils/terminal/terminal-order';

  export let command: CustomCommand;

  const dispatch = createEventDispatcher<{ save: CustomCommand; close: void }>();

  let name = command.name;
  let icon = command.icon;
  let color = command.color ?? PROJECT_COLORS[0];
  let steps = command.steps.length > 0 ? [...command.steps] : [''];
  let stopOnError = command.stopOnError;
  let cwd: CommandCwd = command.cwd;
  let pinned = command.pinned;
  let autoClose = command.autoClose;
  let confirm = command.confirm;
  let focusedStep = 0;
  let stepInputs: (HTMLInputElement | null)[] = [];

  let stepsEl: HTMLDivElement | null = null;
  let drag: number | null = null;
  let dropAt: number | null = null;
  let dragActive = false;
  let dragStartX = 0;
  let dragStartY = 0;

  const DRAG_THRESHOLD = 6;

  const TOKENS = [...VARIABLE_KEYS, 'port:', 'prompt:Label'];

  $: invalidPorts = findInvalidPortTokens(steps);
  $: canSave =
    name.trim().length > 0 &&
    steps.some(s => s.trim().length > 0) &&
    invalidPorts.length === 0;

  function addStep() {
    steps = [...steps, ''];
  }

  function removeStep(index: number) {
    steps = steps.filter((_, i) => i !== index);
    if (steps.length === 0) steps = [''];
  }

  function dragPointerDown(e: PointerEvent, index: number) {
    e.preventDefault();
    drag = index;
    dropAt = index;
    dragActive = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function dragPointerMove(e: PointerEvent) {
    if (drag === null) return;
    if (!dragActive) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      dragActive = true;
      document.body.classList.add('dragging');
    }
    dropAt = computeTabInsertIndex(stepsEl, e.clientY, { selector: '.ce-step', axis: 'y' });
  }

  function dragPointerUp() {
    if (drag !== null && dropAt !== null && dragActive) {
      steps = moveItem(steps, drag, dropAt);
    }
    drag = null;
    dropAt = null;
    dragActive = false;
    document.body.classList.remove('dragging');
  }

  $: dropIndicator =
    dragActive && drag !== null && dropAt !== null && dropAt !== drag && dropAt !== drag + 1
      ? dropAt
      : null;

  function insertToken(token: string) {
    const index = Math.min(focusedStep, steps.length - 1);
    const input = stepInputs[index];
    const snippet = `{{${token}}}`;
    const caret = token.endsWith(':') ? snippet.length - 2 : snippet.length;
    if (!input) {
      steps = steps.map((s, i) => (i === index ? `${s}${snippet}` : s));
      return;
    }
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const value = `${input.value.slice(0, start)}${snippet}${input.value.slice(end)}`;
    steps = steps.map((s, i) => (i === index ? value : s));
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + caret, start + caret);
    });
  }

  function save() {
    if (!canSave) return;
    dispatch('save', {
      ...command,
      name: name.trim(),
      icon,
      color,
      steps: steps.map(s => s.trim()).filter(s => s.length > 0),
      stopOnError,
      cwd,
      pinned,
      autoClose,
      confirm,
    });
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  on:click={() => dispatch('close')}
  on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal ce-modal" on:click|stopPropagation role="presentation">
    <div class="modal-head">
      <div>
        <div class="step-count">{t('commands.editorHeading')}</div>
        <h3>{command.name ? command.name : t('commands.editorNew')}</h3>
      </div>
      <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
        <Icon name="x" size={16}/>
      </button>
    </div>

    <div class="modal-body">
      <div class="ce-row">
        <div class="ce-field">
          <span class="ce-label">{t('commands.fieldIcon')}</span>
          <IconPicker value={icon} on:select={(e) => icon = e.detail}/>
        </div>
        <div class="ce-field ce-grow">
          <label class="ce-label" for="command-name">{t('commands.fieldName')}</label>
          <input id="command-name" class="ce-input" bind:value={name} autocomplete="off" placeholder={t('commands.namePlaceholder') as string}/>
        </div>
      </div>

      <div class="ce-field">
        <span class="ce-label">{t('commands.fieldColor')}</span>
        <ProjectColorPicker bind:color idSuffix="command"/>
      </div>

      <div class="ce-field">
        <span class="ce-label">{t('commands.fieldSteps')}</span>
        <p class="ce-hint">{t('commands.stepsHint')}</p>
        <div class="ce-steps" bind:this={stepsEl}>
          {#each steps as step, i}
            {#if dropIndicator === i}<div class="ce-step-drop"></div>{/if}
            <div class="ce-step" class:dragging={dragActive && drag === i}>
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span
                class="ce-step-grip"
                title={t('commands.reorderStep') as string}
                on:pointerdown={(e) => dragPointerDown(e, i)}
                on:pointermove={dragPointerMove}
                on:pointerup={dragPointerUp}
              >
                <Icon name="grip" size={14}/>
              </span>
              <input
                bind:this={stepInputs[i]}
                class="ce-input mono selectable"
                bind:value={steps[i]}
                autocomplete="off"
                spellcheck={false}
                placeholder={t('commands.stepPlaceholder') as string}
                aria-label={`${t('commands.fieldSteps')} ${i + 1}`}
                on:focus={() => focusedStep = i}
              />
              <button class="ce-step-btn" title={t('commands.removeStep') as string} on:click={() => removeStep(i)}>
                <Icon name="x" size={12}/>
              </button>
            </div>
          {/each}
          {#if dropIndicator === steps.length}<div class="ce-step-drop"></div>{/if}
        </div>
        <div class="ce-step-foot">
          <button class="ce-add" on:click={addStep}>
            <Icon name="plus" size={12}/> {t('commands.addStep')}
          </button>
        </div>
      </div>

      <div class="ce-field">
        <span class="ce-label">{t('commands.fieldVariables')}</span>
        <p class="ce-hint">{t('commands.variablesHint')}</p>
        <div class="ce-tokens">
          {#each TOKENS as token}
            <button class="ce-token selectable" on:click={() => insertToken(token)}>{`{{${token}}}`}</button>
          {/each}
        </div>
        {#if invalidPorts.length > 0}
          <p class="ce-error" role="alert">
            <Icon name="alert" size={12}/>
            {(t('commands.portInvalid') as (tokens: string) => string)(invalidPorts.map(p => `{{${p}}}`).join(', '))}
          </p>
        {/if}
      </div>

      <div class="ce-field">
        <span class="ce-label">{t('commands.fieldCwd')}</span>
        <div class="ce-choices">
          <label class="ce-choice">
            <input type="radio" bind:group={cwd} value="worktree"/>
            <span>{t('commands.cwdWorktree')}</span>
          </label>
          <label class="ce-choice">
            <input type="radio" bind:group={cwd} value="projectRoot"/>
            <span>{t('commands.cwdProjectRoot')}</span>
          </label>
        </div>
      </div>

      <div class="ce-field">
        <span class="ce-label">{t('commands.fieldOptions')}</span>
        <label class="ce-choice"><input type="checkbox" bind:checked={pinned}/><span>{t('commands.optionPinned')}</span></label>
        <label class="ce-choice"><input type="checkbox" bind:checked={stopOnError}/><span>{t('commands.optionStopOnError')}</span></label>
        <label class="ce-choice"><input type="checkbox" bind:checked={autoClose}/><span>{t('commands.optionAutoClose')}</span></label>
        <label class="ce-choice"><input type="checkbox" bind:checked={confirm}/><span>{t('commands.optionConfirm')}</span></label>
      </div>
    </div>

    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn ghost" on:click={() => dispatch('close')}>{t('common.cancel')}</button>
      <button class="btn primary" disabled={!canSave} on:click={save}>
        <Icon name="check" size={14}/> {t('common.save')}
      </button>
    </div>
  </div>
</div>

<style>
  .ce-modal { width: min(560px, 94vw); }

  /* Top-aligned so both labels sit on the same line whatever the control height. */
  .ce-row { display: flex; gap: 12px; align-items: flex-start; }
  .ce-grow { flex: 1; min-width: 0; }
  .ce-field { margin-bottom: 18px; }

  .ce-label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: var(--fg-3);
    letter-spacing: 0.07em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }

  .ce-hint {
    margin: -2px 0 8px;
    font-size: 11.5px;
    color: var(--fg-4);
    line-height: 1.5;
  }

  .ce-input {
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
  .ce-input:focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-weak); }
  .ce-input::placeholder { color: var(--fg-4); }
  .ce-input.mono { font-family: var(--font-mono); font-size: 12px; }

  .ce-steps { display: flex; flex-direction: column; gap: 6px; }

  .ce-step {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ce-step.dragging { opacity: 0.4; cursor: grabbing; }

  .ce-step-drop {
    height: 2px;
    margin: 1px 0 1px 24px;
    background: var(--accent);
    border-radius: 1px;
    pointer-events: none;
  }

  .ce-step-grip {
    display: grid;
    place-items: center;
    width: 18px;
    height: 26px;
    flex-shrink: 0;
    border-radius: var(--r-xs);
    color: var(--fg-4);
    cursor: grab;
    touch-action: none;
  }
  .ce-step-grip:hover { background: var(--bg-3); color: var(--fg-2); }
  .ce-step.dragging .ce-step-grip { cursor: grabbing; color: var(--fg-2); }

  /* Aligned on the step inputs, past the grip and its gap. */
  .ce-step-foot { padding-left: 24px; margin-top: 6px; }

  .ce-step-btn {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    padding: 0;
    background: transparent;
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-xs);
    color: var(--fg-3);
    cursor: pointer;
  }
  .ce-step-btn:hover:not(:disabled) { background: var(--bg-3); color: var(--fg-0); }
  .ce-step-btn:disabled { opacity: 0.35; cursor: default; }

  .ce-add {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    background: transparent;
    border: 1px dashed var(--stroke-1);
    border-radius: var(--r-sm);
    color: var(--fg-3);
    font-size: 12px;
    font-family: var(--font-ui);
    cursor: pointer;
  }
  .ce-add:hover { border-color: var(--accent); color: var(--fg-0); }

  .ce-error {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0 0;
    font-size: 11.5px;
    color: var(--danger, oklch(0.62 0.18 15));
    line-height: 1.5;
  }

  .ce-tokens { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }

  .ce-token {
    padding: 2px 6px;
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-xs);
    color: var(--fg-3);
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
  }
  .ce-token:hover { border-color: var(--accent); color: var(--fg-0); }

  .ce-choices { display: flex; gap: 16px; }

  .ce-choice {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 6px;
    font-size: 12.5px;
    color: var(--fg-2);
    cursor: pointer;
  }
</style>
