<script lang="ts">
  export let name: string;
  export let size: number = 16;
  export let sw: number = 1.5;

  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: sw,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
</script>

{#if name === 'cairn'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" {...$$restProps}>
    <ellipse cx="12" cy="7" rx="3.2" ry="2" />
    <ellipse cx="12" cy="12" rx="5" ry="2.4" />
    <ellipse cx="12" cy="17.5" rx="7" ry="2.8" />
  </svg>
{:else if name === 'agent'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M12 4l1.8 4.2L18 10l-4.2 1.8L12 16l-1.8-4.2L6 10l4.2-1.8L12 4z"/>
    <path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z"/>
  </svg>
{:else if name === 'review'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M3 6h18M3 12h12M3 18h18"/>
    <path d="M16.5 14.5l2 2 3-3"/>
  </svg>
{:else if name === 'git'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <circle cx="6" cy="6" r="2"/>
    <circle cx="6" cy="18" r="2"/>
    <circle cx="18" cy="12" r="2"/>
    <path d="M6 8v8M8 6h6a2 2 0 012 2v2M6 16c4 0 6-1.5 6-4"/>
  </svg>
{:else if name === 'tests'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M9 3v4l-4 12a3 3 0 003 3h8a3 3 0 003-3L15 7V3"/>
    <path d="M8 3h8"/>
    <path d="M6.5 14h11"/>
  </svg>
{:else if name === 'ci'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M4 12a8 8 0 018-8m0 0l-3 3m3-3l3 3"/>
    <path d="M20 12a8 8 0 01-8 8m0 0l3-3m-3 3l-3-3"/>
  </svg>
{:else if name === 'check'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M4 12l5 5L20 6"/>
  </svg>
{:else if name === 'plus'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M12 5v14M5 12h14"/>
  </svg>
{:else if name === 'x'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M6 6l12 12M18 6L6 18"/>
  </svg>
{:else if name === 'chev-r'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M9 6l6 6-6 6"/>
  </svg>
{:else if name === 'chev-d'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M6 9l6 6 6-6"/>
  </svg>
{:else if name === 'chev-u'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M18 15l-6-6-6 6"/>
  </svg>
{:else if name === 'play'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" {...$$restProps}>
    <path d="M7 5.5v13l11-6.5z"/>
  </svg>
{:else if name === 'pause'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" {...$$restProps}>
    <rect x="7" y="5" width="3.5" height="14"/>
    <rect x="13.5" y="5" width="3.5" height="14"/>
  </svg>
{:else if name === 'stop'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" {...$$restProps}>
    <rect x="6" y="6" width="12" height="12" rx="1"/>
  </svg>
{:else if name === 'terminal'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M4 5h16v14H4zM8 10l3 2-3 2M13 15h4"/>
  </svg>
{:else if name === 'folder'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
  </svg>
{:else if name === 'file'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/>
    <path d="M14 3v6h6"/>
  </svg>
{:else if name === 'search'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <circle cx="11" cy="11" r="7"/>
    <path d="M20 20l-3.5-3.5"/>
  </svg>
{:else if name === 'settings'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>
  </svg>
{:else if name === 'bookmark'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M6 3h12v18l-6-4-6 4V3z"/>
  </svg>
{:else if name === 'branch'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <circle cx="6" cy="5" r="1.8"/>
    <circle cx="6" cy="19" r="1.8"/>
    <circle cx="18" cy="10" r="1.8"/>
    <path d="M6 7v10M8 5h6a4 4 0 014 4v1"/>
  </svg>
{:else if name === 'clock'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 7v5l3 2"/>
  </svg>
{:else if name === 'save'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M5 3h11l4 4v12a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z"/>
    <path d="M7 3v5h8V3M8 21v-7h8v7"/>
  </svg>
{:else if name === 'edit'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/>
    <path d="M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
{:else if name === 'more'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <circle cx="5" cy="12" r="1.5"/>
    <circle cx="12" cy="12" r="1.5"/>
    <circle cx="19" cy="12" r="1.5"/>
  </svg>
{:else if name === 'ticket'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M4 6h16v4a2 2 0 000 4v4H4v-4a2 2 0 000-4V6z"/>
    <path d="M10 6v14"/>
  </svg>
{:else if name === 'refresh'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M3 12a9 9 0 0115-6.7L21 8"/>
    <path d="M21 3v5h-5"/>
    <path d="M21 12a9 9 0 01-15 6.7L3 16"/>
    <path d="M3 21v-5h5"/>
  </svg>
{:else if name === 'download'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M12 4v12M6 12l6 6 6-6M4 20h16"/>
  </svg>
{:else if name === 'upload'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M12 20V8M6 12l6-6 6 6M4 4h16"/>
  </svg>
{:else if name === 'sparkles'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z"/>
  </svg>
{:else if name === 'user'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <circle cx="12" cy="8" r="4"/>
    <path d="M4 21a8 8 0 0116 0"/>
  </svg>
{:else if name === 'alert'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M12 2l10 18H2L12 2z"/>
    <path d="M12 9v5M12 17h0"/>
  </svg>
{:else if name === 'info'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 8h0M12 11v6"/>
  </svg>
{:else if name === 'flag'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5"/>
  </svg>
{:else if name === 'circle'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <circle cx="12" cy="12" r="9"/>
  </svg>
{:else if name === 'circle-dot'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <circle cx="12" cy="12" r="9"/>
    <circle cx="12" cy="12" r="3" fill="currentColor"/>
  </svg>
{:else if name === 'external'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M14 4h6v6M20 4L10 14M18 13v5a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h5"/>
  </svg>
{:else if name === 'send'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
  </svg>
{:else if name === 'at'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <circle cx="12" cy="12" r="4"/>
    <path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-4 8"/>
  </svg>
{:else if name === 'attach'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L16 6"/>
  </svg>
{:else if name === 'pin'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M12 17v5M9 3h6l-1 4 3 3-6 3-3-3 3-3-2-4z"/>
  </svg>
{:else if name === 'zap'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/>
  </svg>
{:else if name === 'eye'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
{:else if name === 'dots-v'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <circle cx="12" cy="5" r="1.5"/>
    <circle cx="12" cy="12" r="1.5"/>
    <circle cx="12" cy="19" r="1.5"/>
  </svg>
{:else if name === 'back'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M19 12H5M12 19l-7-7 7-7"/>
  </svg>
{:else if name === 'flame'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <path d="M12 3c0 4-4 5-4 9a4 4 0 008 0c0-2-2-3-2-6 3 1 5 4 5 7a7 7 0 11-14 0c0-5 5-7 7-10z"/>
  </svg>
{:else}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" {...$$restProps}>
    <circle cx="12" cy="12" r="9"/>
  </svg>
{/if}
