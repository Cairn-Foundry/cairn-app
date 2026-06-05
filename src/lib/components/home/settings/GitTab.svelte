<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import { settings } from '$lib/stores/settings';
  import { pendingGitAction } from '$lib/stores/ui';
  import type { GitProfile } from '$lib/services/settings-service';

  // Modal state
  let modalOpen = false;
  let modalMode: 'create' | 'edit' = 'create';
  let editingId: string | null = null;
  let modalLabel = '';
  let modalName = '';
  let modalEmail = '';
  let labelInput: HTMLInputElement | null = null;

  function openCreate() {
    modalMode = 'create';
    editingId = null;
    modalLabel = '';
    modalName = '';
    modalEmail = '';
    modalOpen = true;
    focusLabel();
  }

  function openEdit(p: GitProfile) {
    modalMode = 'edit';
    editingId = p.id;
    modalLabel = p.label;
    modalName = p.name;
    modalEmail = p.email;
    modalOpen = true;
    focusLabel();
  }

  async function focusLabel() {
    await tick();
    labelInput?.focus();
  }

  function closeModal() {
    modalOpen = false;
    editingId = null;
  }

  function saveModal() {
    if (!modalName.trim() || !modalEmail.trim()) return;
    const resolvedLabel = modalLabel.trim() || modalName.trim();

    if (modalMode === 'create') {
      const profile: GitProfile = {
        id: crypto.randomUUID(),
        label: resolvedLabel,
        name: modalName.trim(),
        email: modalEmail.trim(),
      };
      settings.save({ gitProfiles: [...$settings.gitProfiles, profile] });
    } else if (editingId) {
      settings.save({
        gitProfiles: $settings.gitProfiles.map((p) =>
          p.id === editingId
            ? { ...p, label: resolvedLabel, name: modalName.trim(), email: modalEmail.trim() }
            : p
        ),
      });
    }
    closeModal();
  }

  // Delete confirmation
  let confirmOpen = false;
  let confirmId: string | null = null;
  let confirmLabel = '';

  function openDeleteConfirm(profile: GitProfile) {
    confirmId = profile.id;
    confirmLabel = profile.label;
    confirmOpen = true;
  }

  function closeConfirm() {
    confirmOpen = false;
    confirmId = null;
    confirmLabel = '';
  }

  function confirmDelete() {
    if (confirmId) {
      settings.save({ gitProfiles: $settings.gitProfiles.filter((p) => p.id !== confirmId) });
    }
    closeConfirm();
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { closeModal(); closeConfirm(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && modalOpen) saveModal();
  }

  function initial(label: string) {
    return (label || '?').charAt(0).toUpperCase();
  }

  $: canSave = modalName.trim().length > 0 && modalEmail.trim().length > 0;

  onMount(() => {
    if ($pendingGitAction === 'createProfile') {
      pendingGitAction.set(null);
      openCreate();
    }
  });
</script>

<svelte:window on:keydown={modalOpen || confirmOpen ? handleKey : undefined} />

<div class="settings-group">
  <div class="settings-group-title">{t('settings.git.groupTitle')}</div>
  <p class="group-desc">{t('settings.git.groupDesc')}</p>

  {#each $settings.gitProfiles as profile (profile.id)}
    <div class="settings-row profile-row">
      <div class="profile-avatar">{initial(profile.label)}</div>
      <div class="settings-row-info">
        <span class="settings-row-label">{profile.label}</span>
        <span class="settings-row-desc">{profile.name} · {profile.email}</span>
      </div>
      <button class="btn ghost profile-action-btn" on:click={() => openEdit(profile)}>
        <Icon name="edit" size={12} /> {t('settings.git.editProfile')}
      </button>
      <button class="btn ghost danger profile-action-btn" on:click={() => openDeleteConfirm(profile)}>
        <Icon name="trash" size={12} />
      </button>
    </div>
  {/each}

  {#if $settings.gitProfiles.length === 0}
    <div class="profile-empty">{t('settings.git.noProfiles')}</div>
  {/if}

  <button class="add-profile-btn" on:click={openCreate}>
    <Icon name="plus" size={12} /> {t('settings.git.addProfile')}
  </button>
</div>

{#if modalOpen}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={closeModal}
    on:keydown={(e) => e.key === 'Escape' && closeModal()}
  >
    <div class="modal profile-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">{t('settings.git.groupTitle')}</div>
          <h3>{modalMode === 'create' ? t('settings.git.addProfile') : t('settings.git.editProfile')}</h3>
        </div>
        <button class="icon-btn close" on:click={closeModal} aria-label={t('common.close') as string}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div class="modal-body profile-modal-body">
        <div class="profile-field">
          <label class="profile-field-label" for="modal-profile-label">{t('settings.git.profileLabel')}</label>
          <input
            id="modal-profile-label"
            bind:this={labelInput}
            class="profile-modal-input"
            bind:value={modalLabel}
            placeholder={t('settings.git.profileLabelPlaceholder') as string}
            autocomplete="off"
          />
          <span class="profile-field-hint">{t('settings.git.profileLabelHint')}</span>
        </div>
        <div class="profile-field-row">
          <div class="profile-field">
            <label class="profile-field-label" for="modal-profile-name">{t('settings.git.profileName')}</label>
            <input
              id="modal-profile-name"
              class="profile-modal-input"
              bind:value={modalName}
              placeholder={t('settings.git.profileNamePlaceholder') as string}
              autocomplete="off"
            />
          </div>
          <div class="profile-field">
            <label class="profile-field-label" for="modal-profile-email">{t('settings.git.profileEmail')}</label>
            <input
              id="modal-profile-email"
              class="profile-modal-input"
              type="email"
              bind:value={modalEmail}
              placeholder={t('settings.git.profileEmailPlaceholder') as string}
              autocomplete="off"
            />
          </div>
        </div>
      </div>

      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" on:click={closeModal}>{t('settings.git.profileCancel')}</button>
        <button class="btn primary" disabled={!canSave} on:click={saveModal}>
          <Icon name="check" size={13} />
          {t('settings.git.profileSave')}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if confirmOpen}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:click={closeConfirm}
    on:keydown={(e) => e.key === 'Escape' && closeConfirm()}
  >
    <div class="modal confirm-modal" on:click|stopPropagation role="presentation">
      <div class="modal-head">
        <div>
          <div class="step-count">{t('settings.git.groupTitle')}</div>
          <h3>{t('settings.git.deleteConfirmTitle')}</h3>
        </div>
        <button class="icon-btn close" on:click={closeConfirm}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div class="modal-body">
        <p class="confirm-body">{(t('settings.git.deleteConfirmBody') as (label: string) => string)(confirmLabel)}</p>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" on:click={closeConfirm}>{t('settings.git.profileCancel')}</button>
        <button class="btn danger" on:click={confirmDelete}>
          <Icon name="trash" size={13} />
          {t('settings.git.deleteConfirm')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .group-desc {
    font-size: 12px;
    color: var(--fg-3);
    margin: -4px 0 12px;
  }

  .profile-row { gap: 12px; }

  .profile-avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--accent-weak);
    border: 1px solid var(--accent);
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-family: var(--font-ui);
  }

  .profile-action-btn {
    font-size: 12px;
    padding: 6px 10px;
    flex-shrink: 0;
  }

  .confirm-modal { width: min(400px, 92vw); }

  .confirm-body {
    font-size: 13px;
    color: var(--fg-1);
    line-height: 1.6;
    margin: 0;
  }

  .profile-empty {
    padding: 20px 14px;
    font-size: 12px;
    color: var(--fg-4);
    background: var(--bg-2);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-md);
    margin-bottom: 6px;
    line-height: 1.5;
  }

  .add-profile-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 1px dashed var(--stroke-1);
    border-radius: var(--r-md);
    color: var(--fg-3);
    font-size: 12px;
    padding: 9px 14px;
    cursor: pointer;
    width: 100%;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }
  .add-profile-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-weak);
  }

  /* Modal */
  .profile-modal { width: min(480px, 92vw); }

  .profile-modal-body {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .profile-field-row {
    display: flex;
    gap: 14px;
  }

  .profile-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }

  .profile-field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-2);
  }

  .profile-field-hint {
    font-size: 11px;
    color: var(--fg-4);
  }

  .profile-modal-input {
    background: var(--bg-0);
    border: 1px solid var(--stroke-0);
    border-radius: var(--r-sm);
    color: var(--fg-0);
    font-family: var(--font-ui);
    font-size: 13px;
    padding: 8px 10px;
    outline: none;
    transition: border-color 0.12s;
    width: 100%;
    box-sizing: border-box;
  }
  .profile-modal-input:focus { border-color: var(--accent); }
  .profile-modal-input::placeholder { color: var(--fg-4); }
</style>
