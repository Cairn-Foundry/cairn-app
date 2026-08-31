<!--
  Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
  /**
   * First-launch guided tour. Shown once, until `onboardingSeen` is stored.
   * Dispatches `close` when the last step is done or the tour is dismissed.
   */
  import { createEventDispatcher } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import Icon from '$lib/components/Icon.svelte';
  import WelcomeIllustration from '$lib/components/WelcomeIllustration.svelte';
  import { t } from '$lib/i18n';
  import { ISSUES_URL } from '$lib/utils/links';

  const dispatch = createEventDispatcher<{ close: void }>();

  const steps = ['welcome', 'projects', 'instances', 'steps', 'agent', 'beta'] as const;

  let index = 0;
  $: step = steps[index];
  $: isLast = index === steps.length - 1;

  function next() {
    if (isLast) dispatch('close');
    else index += 1;
  }

  function prev() {
    if (index > 0) index -= 1;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') dispatch('close');
    else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
    else if (e.key === 'ArrowLeft') prev();
  }
</script>

<svelte:window on:keydown={handleKeydown}/>

<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('welcome.title') as string}>
  <div class="modal tour">
    <button class="icon-btn close" on:click={() => dispatch('close')} aria-label={t('common.close') as string}>
      <Icon name="x" size={16}/>
    </button>

    <div class="stage">
      {#key step}
        <div class="slide">
          <WelcomeIllustration {step}/>
          <h3>{t(`welcome.steps.${step}.title`)}</h3>
          <p>{t(`welcome.steps.${step}.body`)}</p>
          {#if isLast}
            <button class="btn ghost issues" on:click={() => openUrl(ISSUES_URL)}>
              <Icon name="github" size={14}/> {t('welcome.reportBug')}
            </button>
          {/if}
        </div>
      {/key}
    </div>

    <div class="modal-foot">
      <div class="dots">
        {#each steps as s, i}
          <button
            class="dot"
            class:on={i === index}
            on:click={() => (index = i)}
            aria-label={`${t('welcome.stepLabel')} ${i + 1}`}
          ></button>
        {/each}
      </div>
      <div class="spacer"></div>
      {#if index > 0}
        <button class="btn ghost" on:click={prev}>{t('welcome.back')}</button>
      {:else}
        <button class="btn ghost" on:click={() => dispatch('close')}>{t('welcome.skip')}</button>
      {/if}
      <button class="btn primary" on:click={next}>
        {isLast ? t('welcome.start') : t('welcome.next')}
      </button>
    </div>
  </div>
</div>

<style>
  .tour {
    width: min(520px, 92vw);
    position: relative;
    overflow: hidden;
  }
  .tour::before {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 200px;
    background: radial-gradient(120% 100% at 50% 0%, var(--accent-weak), transparent 72%);
    pointer-events: none;
  }

  .close { position: absolute; top: 10px; right: 10px; z-index: 1; }

  .stage {
    position: relative;
    padding: 32px 32px 24px;
    text-align: center;
    min-height: 300px;
  }

  .slide { animation: rise 0.28s ease both; }
  @keyframes rise {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: none; }
  }

  .stage h3 {
    margin: 0 0 10px;
    font-size: 18px;
    font-family: var(--font-ui);
    color: var(--fg-0);
  }

  .stage p {
    margin: 0 auto;
    max-width: 40ch;
    font-size: 13px;
    line-height: 1.6;
    color: var(--fg-2);
    font-family: var(--font-ui);
  }

  .issues { margin-top: 18px; }

  .dots { display: flex; gap: 6px; align-items: center; }

  .dot {
    width: 6px;
    height: 6px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--stroke-1);
    cursor: pointer;
    transition: background 0.15s, width 0.15s;
  }
  .dot.on { width: 16px; border-radius: 3px; background: var(--accent); }
</style>
