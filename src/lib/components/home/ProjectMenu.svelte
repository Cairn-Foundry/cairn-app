<script lang="ts">
  /**
   * Context menu of a project card: edit, duplicate, reveal, move between folders, delete.
   * Each entry dispatches its own event; `moveToFolder` carries the target folder id.
   */
  import { createEventDispatcher } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n';
  import type { ProjectFolder } from '$lib/types/project';

  export let folders: ProjectFolder[];
  export let currentFolderId: string | null;

  const dispatch = createEventDispatcher<{
    edit: void;
    duplicate: void;
    copyPath: void;
    reveal: void;
    moveToFolder: string;
    removeFromFolder: void;
    delete: void;
  }>();

  $: otherFolders = folders.filter((f) => f.id !== currentFolderId);

  /** Action flipping the submenu to the other side when it would overflow the window. */
  function autoflip(node: HTMLElement) {
    const parent = node.closest('.submenu-item') as HTMLElement | null;
    if (!parent) return {};

    function reposition() {
      requestAnimationFrame(() => {
        node.style.left = 'calc(100% + 4px)';
        node.style.right = 'auto';
        const rect = node.getBoundingClientRect();
        if (rect.right > window.innerWidth - 8) {
          node.style.left = 'auto';
          node.style.right = 'calc(100% + 4px)';
        }
      });
    }

    parent.addEventListener('mouseenter', reposition);
    return { destroy() { parent.removeEventListener('mouseenter', reposition); } };
  }
</script>

<div class="card-menu" role="menu">
  <button class="card-menu-item" role="menuitem"
    on:click|stopPropagation={() => dispatch('edit')}>
    <Icon name="edit" size={13}/> {t('home.projects.menu.edit')}
  </button>
  <button class="card-menu-item" role="menuitem"
    on:click|stopPropagation={() => dispatch('duplicate')}>
    <Icon name="copy" size={13}/> {t('home.projects.menu.duplicate')}
  </button>
  <button class="card-menu-item" role="menuitem"
    on:click|stopPropagation={() => dispatch('copyPath')}>
    <Icon name="clipboard" size={13}/> {t('home.projects.menu.copyPath')}
  </button>
  <button class="card-menu-item" role="menuitem"
    on:click|stopPropagation={() => dispatch('reveal')}>
    <Icon name="folder" size={13}/> {t('common.reveal')}
  </button>

  {#if folders.length > 0}
    <div class="card-menu-sep"></div>
    {#if currentFolderId !== null}
      <button class="card-menu-item" role="menuitem"
        on:click|stopPropagation={() => dispatch('removeFromFolder')}>
        <Icon name="x" size={13}/> {t('home.projects.folders.removeFromFolder')}
      </button>
    {/if}
    {#if otherFolders.length > 0}
      <div class="submenu-item">
        <button class="card-menu-item" role="menuitem">
          <span style="display:flex;align-items:center;gap:8px;"><Icon name="folder" size={13}/> {t('home.projects.folders.moveToFolder')}</span>
          <Icon name="chev-r" size={11}/>
        </button>
        <div class="submenu" use:autoflip>
          {#each otherFolders as f}
            <button class="card-menu-item" role="menuitem"
              on:click|stopPropagation={() => dispatch('moveToFolder', f.id)}>
              <span class="folder-dot" style="background:{f.id ? 'var(--fg-3)' : 'transparent'}"></span>
              {f.name}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  {/if}

  <div class="card-menu-sep"></div>
  <button class="card-menu-item danger" role="menuitem"
    on:click|stopPropagation={() => dispatch('delete')}>
    <Icon name="trash" size={13}/> {t('home.projects.menu.delete')}
  </button>
</div>

<style>
  .card-menu {
    position: absolute;
    top: 36px;
    right: 10px;
    z-index: 100;
    background: var(--bg-3);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
    padding: 4px;
    min-width: 170px;
    box-shadow: 0 8px 24px oklch(0 0 0 / 0.4);
    animation: menu-pop 0.12s cubic-bezier(0.2, 1, 0.4, 1);
  }
  @keyframes menu-pop {
    from { opacity: 0; transform: scale(0.95) translateY(-4px); }
    to   { opacity: 1; transform: none; }
  }

  .card-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border-radius: var(--r-sm);
    background: none;
    border: none;
    font-size: 13px;
    color: var(--fg-1);
    font-family: var(--font-ui);
    cursor: pointer;
    text-align: left;
    transition: background 0.08s, color 0.08s;
  }
  .card-menu-item:hover { background: var(--bg-4); color: var(--fg-0); }
  .card-menu-item.danger { color: var(--danger, oklch(0.75 0.18 15)); }
  .card-menu-item.danger:hover { background: var(--danger-weak, oklch(0.28 0.06 15)); }

  .card-menu-sep {
    height: 1px;
    background: var(--stroke-0);
    margin: 4px 0;
  }

  .submenu-item {
    position: relative;
  }
  .submenu-item > .card-menu-item {
    justify-content: space-between;
  }
  .submenu {
    display: none;
    position: absolute;
    left: calc(100% + 4px);
    top: 0;
    background: var(--bg-3);
    border: 1px solid var(--stroke-1);
    border-radius: var(--r-md);
    padding: 4px;
    min-width: 150px;
    box-shadow: 0 8px 24px oklch(0 0 0 / 0.4);
    z-index: 110;
  }
  .submenu-item:hover .submenu { display: block; }

  .folder-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--fg-3);
    flex-shrink: 0;
  }
</style>
