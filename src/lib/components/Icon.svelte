<script lang="ts">
  export let name: string;
  export let size: number = 16;
  export let sw: number = 1.5;

  $: common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    'stroke-width': sw,
    'stroke-linecap': 'round' as const,
    'stroke-linejoin': 'round' as const,
  };
</script>

{#if name === 'cairn'}
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" {...$$restProps}>
    <ellipse cx="12" cy="7" rx="3.2" ry="2" />
    <ellipse cx="12" cy="12" rx="5" ry="2.4" />
    <ellipse cx="12" cy="17.5" rx="7" ry="2.8" />
  </svg>
{:else if name === 'agent'}
  <svg {...common} {...$$restProps}>
    <path d="M12 4l1.8 4.2L18 10l-4.2 1.8L12 16l-1.8-4.2L6 10l4.2-1.8L12 4z"/>
    <path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z"/>
  </svg>
{:else if name === 'review'}
  <svg {...common} {...$$restProps}>
    <path d="M4 5l1.2 1.2L7.5 4"/>
    <path d="M4 12l1.2 1.2L7.5 10"/>
    <path d="M4 19l1.2 1.2L7.5 17"/>
    <path d="M11 5.5h9M11 12h9M11 18.5h9"/>
  </svg>
{:else if name === 'git'}
  <svg {...common} {...$$restProps}>
    <circle cx="6" cy="5" r="2"/>
    <circle cx="6" cy="19" r="2"/>
    <circle cx="18" cy="9" r="2"/>
    <path d="M6 7v10"/>
    <path d="M8 5.5Q13 5.5 18 9"/>
  </svg>
{:else if name === 'tests'}
  <svg {...common} {...$$restProps}>
    <path d="M9 3v4l-4 12a3 3 0 003 3h8a3 3 0 003-3L15 7V3"/>
    <path d="M8 3h8"/>
    <path d="M6.5 14h11"/>
  </svg>
{:else if name === 'ci'}
  <svg {...common} {...$$restProps}>
    <rect x="3" y="4" width="5" height="5" rx="1"/>
    <rect x="3" y="15" width="5" height="5" rx="1"/>
    <rect x="16" y="9.5" width="5" height="5" rx="1"/>
    <path d="M8 6.5h4a2 2 0 0 1 2 2v1.5"/>
    <path d="M8 17.5h4a2 2 0 0 0 2-2v-1.5"/>
  </svg>
{:else if name === 'check'}
  <svg {...common} {...$$restProps}>
    <path d="M4 12l5 5L20 6"/>
  </svg>
{:else if name === 'plus'}
  <svg {...common} {...$$restProps}>
    <path d="M12 5v14M5 12h14"/>
  </svg>
{:else if name === 'x'}
  <svg {...common} {...$$restProps}>
    <path d="M6 6l12 12M18 6L6 18"/>
  </svg>
{:else if name === 'chev-r'}
  <svg {...common} {...$$restProps}>
    <path d="M9 6l6 6-6 6"/>
  </svg>
{:else if name === 'chev-d'}
  <svg {...common} {...$$restProps}>
    <path d="M6 9l6 6 6-6"/>
  </svg>
{:else if name === 'chev-u'}
  <svg {...common} {...$$restProps}>
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
  <svg {...common} {...$$restProps}>
    <path d="M4 5h16v14H4zM8 10l3 2-3 2M13 15h4"/>
  </svg>
{:else if name === 'folder'}
  <svg {...common} {...$$restProps}>
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
  </svg>
{:else if name === 'folder-open'}
  <svg {...common} {...$$restProps}>
    <path d="M3 9a2 2 0 012-2h3.6l2 2H19a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
    <path d="M3 9l2 9"/>
  </svg>
{:else if name === 'file-code'}
  <svg {...common} {...$$restProps}>
    <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/>
    <path d="M14 3v6h6"/>
    <path d="M9 15l-2-2 2-2M15 11l2 2-2 2"/>
  </svg>
{:else if name === 'file'}
  <svg {...common} {...$$restProps}>
    <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/>
    <path d="M14 3v6h6"/>
  </svg>
{:else if name === 'search'}
  <svg {...common} {...$$restProps}>
    <circle cx="11" cy="11" r="7"/>
    <path d="M20 20l-3.5-3.5"/>
  </svg>
{:else if name === 'settings'}
  <svg {...common} {...$$restProps}>
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>
  </svg>
{:else if name === 'bookmark'}
  <svg {...common} {...$$restProps}>
    <path d="M6 3h12v18l-6-4-6 4V3z"/>
  </svg>
{:else if name === 'branch'}
  <svg {...common} {...$$restProps}>
    <circle cx="6" cy="5" r="1.8"/>
    <circle cx="6" cy="19" r="1.8"/>
    <circle cx="18" cy="10" r="1.8"/>
    <path d="M6 7v10M8 5h6a4 4 0 014 4v1"/>
  </svg>
{:else if name === 'clock'}
  <svg {...common} {...$$restProps}>
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 7v5l3 2"/>
  </svg>
{:else if name === 'save'}
  <svg {...common} {...$$restProps}>
    <path d="M5 3h11l4 4v12a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z"/>
    <path d="M7 3v5h8V3M8 21v-7h8v7"/>
  </svg>
{:else if name === 'edit'}
  <svg {...common} {...$$restProps}>
    <path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/>
    <path d="M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
{:else if name === 'more'}
  <svg {...common} {...$$restProps}>
    <circle cx="5" cy="12" r="1.5"/>
    <circle cx="12" cy="12" r="1.5"/>
    <circle cx="19" cy="12" r="1.5"/>
  </svg>
{:else if name === 'ticket'}
  <svg {...common} {...$$restProps}>
    <path d="M4 6h16v4a2 2 0 000 4v4H4v-4a2 2 0 000-4V6z"/>
    <path d="M10 6v14"/>
  </svg>
{:else if name === 'refresh'}
  <svg {...common} {...$$restProps}>
    <path d="M3 12a9 9 0 0115-6.7L21 8"/>
    <path d="M21 3v5h-5"/>
    <path d="M21 12a9 9 0 01-15 6.7L3 16"/>
    <path d="M3 21v-5h5"/>
  </svg>
{:else if name === 'undo'}
  <svg {...common} {...$$restProps}>
    <path d="M9 14l-4-4 4-4"/>
    <path d="M5 10h7a5 5 0 015 5v1"/>
  </svg>
{:else if name === 'download'}
  <svg {...common} {...$$restProps}>
    <path d="M12 4v12M6 12l6 6 6-6M4 20h16"/>
  </svg>
{:else if name === 'upload'}
  <svg {...common} {...$$restProps}>
    <path d="M12 20V8M6 12l6-6 6 6M4 4h16"/>
  </svg>
{:else if name === 'sparkles'}
  <svg {...common} {...$$restProps}>
    <path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z"/>
  </svg>
{:else if name === 'user'}
  <svg {...common} {...$$restProps}>
    <circle cx="12" cy="8" r="4"/>
    <path d="M4 21a8 8 0 0116 0"/>
  </svg>
{:else if name === 'alert'}
  <svg {...common} {...$$restProps}>
    <path d="M12 2l10 18H2L12 2z"/>
    <path d="M12 9v5M12 17h0"/>
  </svg>
{:else if name === 'info'}
  <svg {...common} {...$$restProps}>
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 8h0M12 11v6"/>
  </svg>
{:else if name === 'flag'}
  <svg {...common} {...$$restProps}>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5"/>
  </svg>
{:else if name === 'circle'}
  <svg {...common} {...$$restProps}>
    <circle cx="12" cy="12" r="9"/>
  </svg>
{:else if name === 'circle-dot'}
  <svg {...common} {...$$restProps}>
    <circle cx="12" cy="12" r="9"/>
    <circle cx="12" cy="12" r="3" fill="currentColor"/>
  </svg>
{:else if name === 'external'}
  <svg {...common} {...$$restProps}>
    <path d="M14 4h6v6M20 4L10 14M18 13v5a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h5"/>
  </svg>
{:else if name === 'send'}
  <svg {...common} {...$$restProps}>
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
  </svg>
{:else if name === 'at'}
  <svg {...common} {...$$restProps}>
    <circle cx="12" cy="12" r="4"/>
    <path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-4 8"/>
  </svg>
{:else if name === 'attach'}
  <svg {...common} {...$$restProps}>
    <path d="M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L16 6"/>
  </svg>
{:else if name === 'pin'}
  <svg {...common} {...$$restProps}>
    <path d="M12 17v5M9 3h6l-1 4 3 3-6 3-3-3 3-3-2-4z"/>
  </svg>
{:else if name === 'zap'}
  <svg {...common} {...$$restProps}>
    <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/>
  </svg>
{:else if name === 'eye'}
  <svg {...common} {...$$restProps}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
{:else if name === 'trash'}
  <svg {...common} {...$$restProps}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
    <path d="M10 11v5M14 11v5"/>
  </svg>
{:else if name === 'copy'}
  <svg {...common} {...$$restProps}>
    <rect x="9" y="9" width="12" height="12" rx="2"/>
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
  </svg>
{:else if name === 'clipboard'}
  <svg {...common} {...$$restProps}>
    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
    <rect x="9" y="3" width="6" height="4" rx="1"/>
  </svg>
{:else if name === 'scissors'}
  <svg {...common} {...$$restProps}>
    <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
    <path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/>
  </svg>
{:else if name === 'lock'}
  <svg {...common} {...$$restProps}>
    <rect x="5" y="11" width="14" height="10" rx="2"/>
    <path d="M8 11V7a4 4 0 018 0v4"/>
  </svg>
{:else if name === 'key'}
  <svg {...common} {...$$restProps}>
    <circle cx="8" cy="15" r="4"/>
    <path d="M12 11l8-8M18 6l2 2M15 9l2 2"/>
  </svg>
{:else if name === 'dots-v'}
  <svg {...common} {...$$restProps}>
    <circle cx="12" cy="5" r="1.5"/>
    <circle cx="12" cy="12" r="1.5"/>
    <circle cx="12" cy="19" r="1.5"/>
  </svg>
{:else if name === 'columns'}
  <svg {...common} {...$$restProps}>
    <rect x="3" y="3" width="7" height="18" rx="1"/>
    <rect x="14" y="3" width="7" height="18" rx="1"/>
  </svg>
{:else if name === 'grid'}
  <svg {...common} {...$$restProps}>
    <rect x="3" y="3" width="7" height="7" rx="1"/>
    <rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/>
    <rect x="14" y="14" width="7" height="7" rx="1"/>
  </svg>
{:else if name === 'back'}
  <svg {...common} {...$$restProps}>
    <path d="M19 12H5M12 19l-7-7 7-7"/>
  </svg>
{:else if name === 'flame'}
  <svg {...common} {...$$restProps}>
    <path d="M12 3c0 4-4 5-4 9a4 4 0 008 0c0-2-2-3-2-6 3 1 5 4 5 7a7 7 0 11-14 0c0-5 5-7 7-10z"/>
  </svg>
{:else if name === 'collapse-all'}
  <svg {...common} {...$$restProps}>
    <path d="M6 5l6 6 6-6"/>
    <path d="M6 19l6-6 6 6"/>
  </svg>
{:else if name === 'expand-all'}
  <svg {...common} {...$$restProps}>
    <path d="M6 9l6-6 6 6"/>
    <path d="M6 15l6 6 6-6"/>
  </svg>
{:else if name === 'help'}
  <svg {...common} {...$$restProps}>
    <circle cx="12" cy="12" r="9"/>
    <path d="M9.5 9a2.5 2.5 0 015 .5c0 2-2.5 2.5-2.5 4"/>
    <circle cx="12" cy="17" r=".5" fill="currentColor"/>
  </svg>
{:else if name === 'command'}
  <svg {...common} {...$$restProps}>
    <path d="M4 8l5 4-5 4"/>
    <path d="M13 16h7"/>
  </svg>
{:else if name === 'pin'}
  <svg {...common} {...$$restProps}>
    <line x1="12" y1="17" x2="12" y2="22"/>
    <path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24z"/>
  </svg>
{:else}
  <svg {...common} {...$$restProps}>
    <circle cx="12" cy="12" r="9"/>
  </svg>
{/if}
