<script lang="ts">
  import { onMount } from 'svelte';
  import CairnLogo from '$lib/components/layout/CairnLogo.svelte';
  import Spinner from '$lib/components/Spinner.svelte';

  onMount(() => {
    document.getElementById('boot-splash')?.remove();
  });
</script>

<div class="boot" role="status" aria-live="polite">
  <div class="boot-mark">
    <CairnLogo size={44}/>
  </div>
  <Spinner size={16} color="var(--accent)" trackColor="var(--stroke-0)"/>
</div>

<style>
  .boot {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    background: var(--bg-0);
  }

  .boot-mark {
    display: flex;
    animation: boot-breathe 1.8s ease-in-out infinite;
  }

  @keyframes boot-breathe {
    0%, 100% { opacity: 0.55; transform: scale(0.98); }
    50% { opacity: 1; transform: scale(1); }
  }
</style>
