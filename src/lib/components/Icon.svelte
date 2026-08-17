<script lang="ts">
  /**
   * Single source of every icon in the app, drawn inline as SVG paths keyed by
   * name. Stroke width and size follow the surrounding text.
   */
  export let name: string;
  export let size: number = 16;
  export let sw: number = 1.5;

  $: cls = ['ic', `ic-${name}`, $$restProps.class].filter(Boolean).join(' ');

  $: common = {
    class: cls,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    'stroke-width': sw,
    'stroke-linecap': 'round' as const,
    'stroke-linejoin': 'round' as const,
  };
  $: solid = {
    class: cls,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'currentColor',
    stroke: 'none' as const,
  };
</script>

{#if name === 'cairn'}
  <svg {...solid} {...$$restProps} class={cls}>
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
    <path class="ic-tests-liquid" d="M6.5 14h11"/>
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
    <path class="ic-plus-v" d="M12 5v14"/>
    <path class="ic-plus-h" d="M5 12h14"/>
  </svg>
{:else if name === 'x'}
  <svg {...common} {...$$restProps}>
    <path class="ic-x-a" d="M6 6l12 12"/>
    <path class="ic-x-b" d="M18 6L6 18"/>
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
  <svg {...solid} {...$$restProps} class={cls}>
    <path d="M7 5.5v13l11-6.5z"/>
  </svg>
{:else if name === 'pause'}
  <svg {...solid} {...$$restProps} class={cls}>
    <rect x="7" y="5" width="3.5" height="14"/>
    <rect x="13.5" y="5" width="3.5" height="14"/>
  </svg>
{:else if name === 'stop'}
  <svg {...solid} {...$$restProps} class={cls}>
    <rect x="6" y="6" width="12" height="12" rx="1"/>
  </svg>
{:else if name === 'terminal'}
  <svg {...common} {...$$restProps}>
    <path d="M4 5h16v14H4z"/>
    <path class="ic-terminal-chevron" d="M8 10l3 2-3 2"/>
    <path class="ic-terminal-cursor" d="M13 15h4"/>
  </svg>
{:else if name === 'folder'}
  <svg {...common} {...$$restProps}>
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
  </svg>
{:else if name === 'folder-open'}
  <svg {...common} {...$$restProps}>
    <path class="ic-fopen-back" d="M3 19V7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v2"/>
    <path class="ic-fopen-front" d="M3 19l2.6-7.3a2 2 0 011.9-1.2h13a1 1 0 01.95 1.3L19 19a2 2 0 01-1.9 1.4H5a2 2 0 01-2-1.4z"/>
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
    <path class="ic-search-handle" d="M20 20l-3.5-3.5"/>
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
    <path class="ic-save-tab" d="M7 3v5h8V3"/>
    <path class="ic-save-label" d="M8 21v-7h8v7"/>
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
    <path class="ic-ticket-perf" d="M10 8.5v1.5M10 12.5v1.5M10 16.5v1.5"/>
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
    <path d="M12 4l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z"/>
  </svg>
{:else if name === 'user'}
  <svg {...common} {...$$restProps}>
    <circle cx="12" cy="8" r="4"/>
    <path d="M4 21a8 8 0 0116 0"/>
  </svg>
{:else if name === 'alert'}
  <svg {...common} {...$$restProps}>
    <path d="M12 2l10 18H2L12 2z"/>
    <path d="M12 9v5"/>
    <circle class="ic-alert-dot" cx="12" cy="17" r=".75" fill="currentColor" stroke="none"/>
  </svg>
{:else if name === 'info'}
  <svg {...common} {...$$restProps}>
    <circle cx="12" cy="12" r="9"/>
    <circle class="ic-info-dot" cx="12" cy="8" r=".75" fill="currentColor" stroke="none"/>
    <path d="M12 11v6"/>
  </svg>
{:else if name === 'flag'}
  <svg {...common} {...$$restProps}>
    <path d="M5 21V4"/>
    <path class="ic-flag-cloth" d="M5 4h11l-2 4 2 4H5"/>
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
    <path class="ic-trash-lid" d="M3 6h18M8 6V4h8v2"/>
    <path d="M19 6l-1 14H6L5 6"/>
    <path class="ic-trash-ribs" d="M10 11v5M14 11v5"/>
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
    <circle class="ic-ring-a" cx="6" cy="6" r="3"/><circle class="ic-ring-b" cx="6" cy="18" r="3"/>
    <path class="ic-blade-a" d="M8.12 8.12L12 12M14.47 14.48L20 20"/>
    <path class="ic-blade-b" d="M20 4L8.12 15.88"/>
  </svg>
{:else if name === 'lock'}
  <svg {...common} {...$$restProps}>
    <rect x="5" y="11" width="14" height="10" rx="2"/>
    <path d="M8 11V7a4 4 0 018 0v4"/>
  </svg>
{:else if name === 'key'}
  <svg {...common} {...$$restProps}>
    <circle cx="8" cy="15" r="4"/>
    <path d="M12 11l8-8"/>
    <path class="ic-key-teeth" d="M18 6l2 2M15 9l2 2"/>
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
    <path d="M8 5l4 3.5 4-3.5"/>
    <path d="M4.5 12h15"/>
    <path d="M8 19l4-3.5 4 3.5"/>
  </svg>
{:else if name === 'expand-all'}
  <svg {...common} {...$$restProps}>
    <path d="M8 8.5l4-3.5 4 3.5"/>
    <path d="M4.5 12h15"/>
    <path d="M8 15.5l4 3.5 4-3.5"/>
  </svg>
{:else if name === 'help'}
  <svg {...common} {...$$restProps}>
    <circle cx="12" cy="12" r="9"/>
    <path class="ic-help-curl" d="M9.5 9a2.5 2.5 0 015 .5c0 2-2.5 2.5-2.5 4"/>
    <circle class="ic-help-dot" cx="12" cy="17" r=".5" fill="currentColor"/>
  </svg>
{:else if name === 'command'}
  <svg {...common} {...$$restProps}>
    <path d="M4 8l5 4-5 4"/>
    <path d="M13 16h7"/>
  </svg>
{:else if name === 'pin-off'}
  <svg {...common} {...$$restProps}>
    <path d="M12 17v5M9 3h6l-1 4 3 3-6 3-3-3 3-3-2-4z"/>
    <path d="M4 4l16 16"/>
  </svg>
{:else if name === 'grip'}
  <svg {...solid} {...$$restProps} class={cls}>
    <circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/>
    <circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/>
    <circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>
  </svg>
{:else if name === 'format'}
  <svg {...common} {...$$restProps}>
    <path d="M4 6h16"/>
    <path d="M4 10h10"/>
    <path d="M4 14h13"/>
    <path d="M4 18h7"/>
  </svg>
{:else if name === 'server'}
  <svg {...common} {...$$restProps}>
    <rect x="3" y="4" width="18" height="7" rx="2"/>
    <rect x="3" y="13" width="18" height="7" rx="2"/>
    <path d="M7 7.5h0M7 16.5h0"/>
  </svg>
{:else if name === 'database'}
  <svg {...common} {...$$restProps}>
    <ellipse cx="12" cy="6" rx="8" ry="3"/>
    <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/>
    <path d="M20 12c0 1.7-3.6 3-8 3s-8-1.3-8-3"/>
  </svg>
{:else if name === 'package'}
  <svg {...common} {...$$restProps}>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/>
    <path class="ic-package-seam" d="M4 7.5l8 4.5 8-4.5"/>
    <path d="M12 12v9"/>
  </svg>
{:else if name === 'box'}
  <svg {...common} {...$$restProps}>
    <rect x="3" y="6" width="18" height="14" rx="2"/>
    <path class="ic-box-lid" d="M3 10h18"/>
    <path class="ic-box-tab" d="M10 6V3h4v3"/>
  </svg>
{:else if name === 'container'}
  <svg {...common} {...$$restProps}>
    <rect x="3" y="11" width="5" height="5" rx="1"/>
    <rect x="9.5" y="11" width="5" height="5" rx="1"/>
    <rect x="9.5" y="5" width="5" height="5" rx="1"/>
    <path d="M3 19h18a3 3 0 003-3"/>
  </svg>
{:else if name === 'rocket'}
  <svg {...common} {...$$restProps}>
    <path class="ic-rk" d="M12 2c3.5 2.5 5 6 5 10l-2.5 4h-5L7 12c0-4 1.5-7.5 5-10z"/>
    <circle class="ic-rk" cx="12" cy="9" r="1.8"/>
    <path class="ic-rk" d="M9.5 16.5L7.5 18.5M14.5 16.5l2 2"/>
    <circle class="ic-smoke ic-smoke-1" cx="12" cy="18.8" r="1.3"/>
    <circle class="ic-smoke ic-smoke-2" cx="9.9" cy="20.3" r="1"/>
    <circle class="ic-smoke ic-smoke-3" cx="14.1" cy="20.5" r=".9"/>
  </svg>
{:else if name === 'bug'}
  <svg {...common} {...$$restProps}>
    <rect x="7" y="7" width="10" height="13" rx="5"/>
    <path d="M9 6a3 3 0 016 0"/>
    <path class="ic-bug-legs-l" d="M3 11h4M3 18h4"/>
    <path class="ic-bug-legs-r" d="M17 11h4M17 18h4"/>
    <path d="M12 10v8"/>
  </svg>
{:else if name === 'hammer'}
  <svg {...common} {...$$restProps}>
    <path d="M13 7l-8.5 8.5a2 2 0 003 3L16 10"/>
    <path d="M11 5l6-3 5 5-3 6-4-4-4-4z"/>
  </svg>
{:else if name === 'layers'}
  <svg {...common} {...$$restProps}>
    <path d="M12 3l9 5-9 5-9-5 9-5z"/>
    <path d="M3 13l9 5 9-5"/>
  </svg>
{:else if name === 'globe'}
  <svg {...common} {...$$restProps}>
    <circle cx="12" cy="12" r="9"/>
    <path d="M3 12h18"/>
    <path d="M12 3a14 14 0 010 18 14 14 0 010-18z"/>
  </svg>
{:else if name === 'beaker'}
  <svg {...common} {...$$restProps}>
    <path d="M10 3v6.5L4.5 18a2 2 0 001.7 3h11.6a2 2 0 001.7-3L14 9.5V3"/>
    <path d="M8.5 3h7"/>
    <path class="ic-beaker-liquid" d="M7 15h10"/>
  </svg>
{:else if name === 'wand'}
  <svg {...common} {...$$restProps}>
    <path d="M4 20L15 9"/>
    <path d="M17 3l1 2.5L20.5 6.5 18 7.5 17 10l-1-2.5L13.5 6.5 16 5.5 17 3z"/>
    <path d="M6 4l.7 1.6L8.5 6.3 6.7 7 6 8.6 5.3 7 3.5 6.3 5.3 5.6 6 4z"/>
  </svg>
{:else if name === 'gauge'}
  <svg {...common} {...$$restProps}>
    <path d="M3.5 17a9 9 0 1117 0"/>
    <path d="M12 14l4-4"/>
    <circle cx="12" cy="15" r="1.3" fill="currentColor"/>
  </svg>
{:else if name === 'shield'}
  <svg {...common} {...$$restProps}>
    <path d="M12 3l8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3z"/>
  </svg>
{:else if name === 'link'}
  <svg {...common} {...$$restProps}>
    <path d="M10 13a4 4 0 006 .5l2.5-2.5a4 4 0 00-5.7-5.7L11.5 6.6"/>
    <path d="M14 11a4 4 0 00-6-.5L5.5 13a4 4 0 005.7 5.7l1.3-1.3"/>
  </svg>
{:else if name === 'list'}
  <svg {...common} {...$$restProps}>
    <path d="M9 6h11"/>
    <path d="M9 12h11"/>
    <path d="M9 18h11"/>
    <path d="M4.5 6h0M4.5 12h0M4.5 18h0"/>
  </svg>
{:else if name === 'filter'}
  <svg {...common} {...$$restProps}>
    <path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/>
  </svg>
{:else if name === 'bell'}
  <svg {...common} {...$$restProps}>
    <path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z"/>
    <path d="M10 19a2 2 0 004 0"/>
  </svg>
{:else if name === 'book'}
  <svg {...common} {...$$restProps}>
    <path class="ic-book-cover" d="M4 4.5A2.5 2.5 0 016.5 2H20v18H6.5A2.5 2.5 0 004 22V4.5z"/>
    <path class="ic-book-page" d="M4 17.5A2.5 2.5 0 016.5 15H20"/>
  </svg>
{:else if name === 'cloud'}
  <svg {...common} {...$$restProps}>
    <path d="M7 18a4.5 4.5 0 01-.5-9 6 6 0 0111.4 1.5A3.75 3.75 0 0117.5 18H7z"/>
  </svg>
{:else if name === 'gitlab'}
  <svg {...solid} {...$$restProps} class={cls}>
    <path d="M22.65 13.4l-1.2-3.7-2.4-7.3a.4.4 0 00-.76 0L15.9 9.7H8.1L5.7 2.4a.4.4 0 00-.76 0l-2.4 7.3-1.2 3.7a.8.8 0 00.3.9L12 21.7l10.35-7.4a.8.8 0 00.3-.9z"/>
  </svg>
{:else if name === 'github'}
  <svg {...solid} {...$$restProps} class={cls}>
    <path d="M12 2a10 10 0 00-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.6 9.6 0 015 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0012 2z"/>
  </svg>
{:else if name === 'jira'}
  <svg {...solid} {...$$restProps} class={cls}>
    <path d="M21.4 11.3L12.7 2.6 12 2l-6.6 6.6-3 3a.9.9 0 000 1.3l6 6 3.6 3.6 6.6-6.6.1-.1 2.7-2.7a.9.9 0 000-1.3zM12 15.2L9 12.2l3-3 3 3-3 3z"/>
  </svg>
{:else}
  <svg {...common} {...$$restProps}>
    <circle cx="12" cy="12" r="9"/>
  </svg>
{/if}
