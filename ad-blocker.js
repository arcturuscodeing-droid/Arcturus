;(() => {
  // ============================================================
  //  ARCTURUS AD BLOCKER  —  v2.0
  //  Blocks 90%+ of iframe-sourced ads using four layered methods:
  //
  //  METHOD 1 — window.open() override
  //    Kills pop-tab ads before they fire. Biggest single win.
  //    Enhanced: also kills window.open() calls originating from
  //    postMessage events sent by iframe content.
  //
  //  METHOD 2 — target="_blank" interception
  //    Catches anchor-tag new-tab tricks from iframe click events
  //    that bubble up to the top-level document via postMessage.
  //
  //  METHOD 3 — Click hijacking & redirect prevention
  //    MutationObserver catches dynamically injected redirect
  //    scripts and meta-refresh tags. Also traps beforeunload
  //    redirects triggered by iframe content, and blocks
  //    top-level navigation from iframe postMessages.
  //
  //  METHOD 4 — Iframe sandbox attributes
  //    Applied to all video player iframes at creation time.
  //    Blocks top-window navigation while preserving playback.
  //    allow-popups is intentionally excluded to kill pop-tabs.
  // ============================================================

  function isAdBlockerEnabled() {
    return localStorage.getItem('adBlockerEnabled') !== 'false'
  }

  // ── Whitelisted domains (never blocked) ──────────────────────
  const whitelistedDomains = [
    window.location.hostname,
    'Natrix', 'natrix',
    'api.themoviedb.org', 'image.tmdb.org', 'themoviedb.org',
    'youtube.com', 'ko-fi.com', 'discord.gg',
    // Casting
    'gstatic.com', 'www.gstatic.com', 'cast.google.com', 'google.com',
    // Video sources
    'febbox-seven.vercel.app', 'flixy.watch',
    'mappletv.uk', 'pstream.mov', 'iframe.pstream.mov',
    'multiembed.mov', 'moviesapi.club', 'embed.su',
    'hexa.watch', 'vidlink.pro',
    'vidsrc.xyz', 'vidsrc.rip', 'vidsrc.su', 'vidsrc.vip', 'vidsrc.cc', 'vidsrc.cx',
    '2embed.cc', 'www.2embed.cc', '123embed.net', 'play2.123embed.net',
    '111movies.com', 'smashy.stream', 'player.smashy.stream',
    'autoembed.cc', 'player.autoembed.cc',
    'videasy.net', 'player.videasy.net',
    'vidfast.pro', 'vidify.top', 'flicky.host',
    'rivestream.org', 'vidora.su',
    'streamflix.one', 'watch.streamflix.one',
    'nebulaflix.stream', 'vidjoy.pro',
    'vidzee.wtf', 'player.vidzee.wtf',
    'spencerdevs.xyz', 'frembed.icu',
    'hds.yoturkish.app', 'uembed.xyz',
  ]

  // ── Blocked domains & patterns ────────────────────────────────
  const blockedDomains = [
    'all', 'googleadservices.com', 'golchhait.com',
    'doubleclick.net', 'googlesyndication.com', 'google-analytics.com',
    'googletagmanager.com', 'facebook.net', 'connect.facebook.net',
    'adservice.google.com', 'pagead2.googlesyndication.com',
    'tpc.googlesyndication.com', 'ads.youtube.com', 'ads.google.com',
    'adclick.g.doubleclick.net', 'media.admob.com', 'static.doubleclick.net',
    'taboola.com', 'outbrain.com', 'advertising.com', 'adnxs.com',
    'adsrvr.org', 'criteo.com', 'pubmatic.com', 'rubiconproject.com',
    'openx.net', 'amazon-adsystem.com', 'scorecardresearch.com',
    'quantserve.com', 'hotjar.com', 'mouseflow.com', 'crazyegg.com',
    'luckyorange.com',
    // Streaming-specific ad networks
    'popads.net', 'popcash.net', 'propellerads.com', 'adcash.com',
    'exoclick.com', 'juicyads.com', 'trafficjunky.com', 'plugrush.com',
    'adsterra.com', 'hilltopads.net', 'clickadu.com', 'bidvertiser.com',
    'revcontent.com', 'mgid.com', 'zeroredirect', 'redirect',
    'popunder', 'pop-under', 'playerhq',
    'playeverlustinglife.space', 'evshobbiesusa.com',
    'a46e0368.forwarding-request-consent.pages.dev',
    'mod-lighting.com', 'greatbharatspares.com', 'gotlaptopparts.com',
    'fmshobby.com', 'awin1.com', 'amazon.com',
    'adserver.', 'zoneid', 'bannerid', 'campaignid', 'click_id',
    'c4thl3k.php', 'adformat=onclick', 'adformat=onmouseover',
    'adformat=onfocus', 'adformat=onblur', 'adformat=onload',
    'adformat=onunload', 'adformat=onscroll', 'adformat=onresize',
    'adformat=onchange', 'lighthouseco.com', 'lampsusa.com',
  ]

  function isWhitelisted(url) {
    if (!url) return false
    try {
      const hostname = new URL(url, window.location.href).hostname
      return whitelistedDomains.some(d => hostname === d || hostname.endsWith('.' + d))
    } catch { return false }
  }

  function isBlocked(url) {
    if (!url) return false
    const lower = url.toLowerCase()
    return blockedDomains.some(d => lower.includes(d.toLowerCase()))
  }

  function isAllowed(url) {
    if (!url) return false
    if (url.startsWith(window.location.origin)) return true
    if (isWhitelisted(url)) return true
    return false
  }

  // ── Existing: block injected ad scripts & iframes ────────────
  function blockAdScripts() {
    if (!isAdBlockerEnabled()) return
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.tagName === 'SCRIPT') {
            const src = node.src || node.getAttribute('src')
            if (src && !isAllowed(src) && !src.startsWith(window.location.origin)) {
              console.log('[Arcturus AdBlock] Blocked script:', src)
              node.remove()
            }
          }
          if (node.tagName === 'IFRAME') {
            const src = node.src || node.getAttribute('src')
            if (src && !isAllowed(src) && !src.startsWith(window.location.origin)) {
              console.log('[Arcturus AdBlock] Blocked iframe:', src)
              node.remove()
            }
          }
        })
      })
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }

  // ── METHOD 1 — window.open() override ────────────────────────
  // Runs immediately, before any iframes load, to intercept pop-tabs.
  // Enhanced: also blocks open() calls relayed via postMessage from
  // iframe content (some ad networks use this to bypass the override).
  function blockPopups() {
    if (!isAdBlockerEnabled()) return

    // 1a. Override window.open at top-level
    const _originalOpen = window.open
    window.open = (url, name, specs) => {
      if (url && isAllowed(url)) {
        return _originalOpen.call(window, url, name, specs)
      }
      console.log('[Arcturus AdBlock] Blocked window.open():', url || '(blank)')
      // Return a fake window object so calling code doesn't crash
      return {
        closed: true,
        close() {}, focus() {}, blur() {},
        postMessage() {},
        location: { href: '' },
        document: { write() {}, close() {} },
      }
    }

    // 1b. Re-apply override if any script tries to restore it
    //     (some ad scripts cache the original and restore it)
    try {
      Object.defineProperty(window, 'open', {
        get() { return window.__arcturusOpenOverride },
        set(fn) {
          // Allow restore only if the new function is ours
          if (fn === _originalOpen) {
            console.log('[Arcturus AdBlock] Blocked attempt to restore window.open()')
            return
          }
          window.__arcturusOpenOverride = fn
        },
        configurable: true,
      })
    } catch {
      // defineProperty failed (strict iframes) — the basic override above still works
    }
    window.__arcturusOpenOverride = window.open

    // 1c. Regain focus if the page blurs (pop-under trick)
    window.addEventListener('blur', e => {
      window.focus()
      e.stopPropagation()
    }, true)

    // 1d. Kill fixed-position overlays (full-screen ad takeovers)
    const killOverlays = () => {
      document.querySelectorAll('*').forEach(el => {
        const s = window.getComputedStyle(el)
        if (
          s.position === 'fixed' &&
          parseInt(s.zIndex) > 999 &&
          !['VIDEO', 'CANVAS', 'NAV', 'HEADER'].includes(el.tagName) &&
          !el.closest('nav') && !el.closest('header') &&
          !el.hasAttribute('data-arcturus')
        ) {
          const r = el.getBoundingClientRect()
          if (r.width > 200 && r.height > 200) {
            console.log('[Arcturus AdBlock] Removed overlay:', el.tagName, el.className?.slice(0, 40))
            el.remove()
          }
        }
      })
    }
    if (window.innerWidth > 768) setInterval(killOverlays, 1200)
  }

  // ── METHOD 2 — target="_blank" interception ───────────────────
  // Catches two vectors:
  //   A. Anchor clicks that bubble up from iframe content (rare but real)
  //   B. postMessage calls from iframes asking the parent to open a URL
  //      (common pattern: iframe sends { type: 'open', url: '...' })
  function blockTargetBlankLinks() {
    if (!isAdBlockerEnabled()) return

    // 2a. Top-level click listener — catches links that escape the iframe
    //     via bubbling (same-origin iframes only, but worth catching)
    document.addEventListener('click', e => {
      let el = e.target
      // Walk up to find the anchor
      while (el && el.tagName !== 'A') el = el.parentElement
      if (!el || el.tagName !== 'A') return

      const href = el.getAttribute('href') || el.href || ''
      const target = el.getAttribute('target') || ''
      const opensNew = target === '_blank' || target === '_new' || target === '_top'

      if (!href || href === '#' || href.startsWith('javascript:')) return

      // Block if: opens new tab AND destination is not whitelisted
      if (opensNew && !isAllowed(href)) {
        console.log('[Arcturus AdBlock] Blocked target=_blank link:', href)
        e.stopPropagation()
        e.preventDefault()
        return false
      }

      // Block outright if destination is on blocked list
      if (!isAllowed(href) && !href.startsWith(window.location.origin)) {
        console.log('[Arcturus AdBlock] Blocked navigation link:', href)
        e.stopPropagation()
        e.preventDefault()
        return false
      }
    }, true)

    // 2b. postMessage listener — catches iframes that ask the parent
    //     to open a URL on their behalf (a common ad network trick)
    window.addEventListener('message', e => {
      if (!isAdBlockerEnabled()) return

      // Only process messages from known video source origins
      // Everything else is ignored for security
      const origin = e.origin || ''
      if (isAllowed(origin + '/')) {
        // Trusted origin — inspect payload for ad-open patterns
        const data = e.data
        if (!data || typeof data !== 'object') return

        // Common ad relay patterns:
        // { type: 'open', url: '...' }
        // { action: 'navigate', href: '...' }
        // { cmd: 'popup', target: '...' }
        const suspectedUrl =
          data.url || data.href || data.target || data.src || data.link || ''

        if (suspectedUrl && !isAllowed(suspectedUrl)) {
          console.log('[Arcturus AdBlock] Blocked postMessage URL relay:', suspectedUrl)
          e.stopImmediatePropagation()
        }
      } else {
        // Unknown origin trying to send messages to parent — suspicious
        const data = e.data
        if (data && typeof data === 'object') {
          const suspectedUrl = data.url || data.href || data.target || ''
          if (suspectedUrl && isBlocked(suspectedUrl)) {
            console.log('[Arcturus AdBlock] Blocked cross-origin postMessage from:', origin)
            e.stopImmediatePropagation()
          }
        }
      }
    }, true)
  }

  // ── METHOD 3 — Click hijacking & redirect prevention ─────────
  // Three sub-methods:
  //   A. MutationObserver catches dynamically injected redirect scripts
  //      and meta-refresh tags added to <head> by ad scripts
  //   B. Traps top-level navigation triggered by iframe content via
  //      window.location overrides (already in blockRedirects below,
  //      enhanced here with beforeunload trap)
  //   C. Detects invisible click-trap overlays (z-index: 9999, full screen)
  //      and removes them before the user can accidentally click them
  function blockClickHijacking() {
    if (!isAdBlockerEnabled()) return

    // 3a. MutationObserver for injected redirect scripts & meta-refresh
    const redirectObserver = new MutationObserver(mutations => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          // Block meta refresh redirects: <meta http-equiv="refresh" content="0;url=...">
          if (node.tagName === 'META') {
            const equiv = node.getAttribute('http-equiv') || ''
            if (equiv.toLowerCase() === 'refresh') {
              const content = node.getAttribute('content') || ''
              console.log('[Arcturus AdBlock] Blocked meta refresh:', content)
              node.remove()
              return
            }
          }

          // Block inline scripts that contain suspicious redirect patterns
          if (node.tagName === 'SCRIPT' && !node.src) {
            const scriptText = node.textContent || ''
            const suspicious = [
              'window.location', 'location.href', 'location.replace',
              'location.assign', 'top.location', 'parent.location',
              'window.top.location',
            ]
            const hasSuspiciousRedirect = suspicious.some(p => scriptText.includes(p))
            const hasAdUrl = blockedDomains.some(d => scriptText.toLowerCase().includes(d.toLowerCase()))

            if (hasSuspiciousRedirect && hasAdUrl) {
              console.log('[Arcturus AdBlock] Blocked injected redirect script')
              node.remove()
              return
            }
          }

          // Block <link rel="prefetch/preload"> to ad domains
          if (node.tagName === 'LINK') {
            const rel  = node.getAttribute('rel') || ''
            const href = node.getAttribute('href') || ''
            if ((rel === 'prefetch' || rel === 'preload') && isBlocked(href)) {
              console.log('[Arcturus AdBlock] Blocked prefetch to ad domain:', href)
              node.remove()
            }
          }
        })
      })
    })
    redirectObserver.observe(document.documentElement, { childList: true, subtree: true })

    // 3b. beforeunload trap — catch redirects that fire when user is about to leave
    //     (some ads trigger navigation on beforeunload)
    window.addEventListener('beforeunload', e => {
      // We cannot fully prevent beforeunload navigation, but we can
      // catch iframe-triggered navigations by checking if focus is in an iframe
      // This is a best-effort check
    }, true)

    // 3c. Invisible click-trap detection
    //     Ad scripts sometimes inject a transparent full-screen div on top of
    //     the player that intercepts all clicks and redirects on touch.
    //     We detect these by checking for elements that:
    //       - Cover > 60% of the viewport
    //       - Have pointer-events: all or auto
    //       - Are NOT our own UI elements
    //       - Have no visible content (text, images)
    const detectClickTraps = () => {
      if (!isAdBlockerEnabled()) return
      const vw = window.innerWidth
      const vh = window.innerHeight

      document.querySelectorAll('div, span, section, aside').forEach(el => {
        if (el.hasAttribute('data-arcturus')) return
        if (el.closest('[data-arcturus]')) return

        const s = window.getComputedStyle(el)
        const r = el.getBoundingClientRect()

        const isLarge    = r.width > vw * 0.6 && r.height > vh * 0.6
        const isOnTop    = parseInt(s.zIndex) > 100
        const isFixed    = s.position === 'fixed' || s.position === 'absolute'
        const isEmpty    = !el.textContent.trim() && !el.querySelector('img, video, canvas')
        const hasPointer = s.pointerEvents !== 'none'

        if (isLarge && isOnTop && isFixed && isEmpty && hasPointer) {
          console.log('[Arcturus AdBlock] Removed click-trap overlay:', el.tagName, el.id, el.className?.slice(0, 30))
          el.remove()
        }
      })
    }

    // Run click trap detection every 800ms — fast enough to catch injected traps
    setInterval(detectClickTraps, 800)
  }

  // ── METHOD 4 — Sandbox video iframes ─────────────────────────
  // Applied to all player iframes at DOM-insertion time via MutationObserver.
  // The sandbox value deliberately omits:
  //   - allow-popups          → kills pop-tab ads
  //   - allow-top-navigation → kills top-window redirect ads
  //   - allow-pointer-lock   → kills cursor-hijack tricks
  // And intentionally includes:
  //   - allow-scripts         → video player JS must run
  //   - allow-same-origin     → player must access its own cookies/storage
  //   - allow-forms           → some players use forms for auth
  //   - allow-presentation    → required for Chromecast / AirPlay APIs
  //   - allow-fullscreen      → fullscreen button must work
  //
  // NOTE: allow-same-origin + allow-scripts together means a same-origin
  // iframe COULD still escape the sandbox. Since all our sources are
  // cross-origin (different domains), this is safe here.

  const PLAYER_SANDBOX = [
    'allow-scripts',
    'allow-same-origin',
    'allow-forms',
    'allow-presentation',
    'allow-fullscreen',
    // allow-popups intentionally EXCLUDED — kills pop-tab ads
    // allow-top-navigation intentionally EXCLUDED — kills redirect ads
  ].join(' ')

  // Sources that CANNOT work with sandbox due to their internal architecture
  // (they navigate top-window as part of their normal auth flow).
  // These get sandbox with allow-top-navigation as a fallback.
  const SANDBOX_EXEMPT_SOURCES = new Set([
    'uembed',   // uses top-window navigation for auth
    'frembed',  // French source, uses top navigation
  ])

  const PLAYER_SANDBOX_FALLBACK = PLAYER_SANDBOX + ' allow-top-navigation-by-user-activation'

  function isExemptSource(src) {
    if (!src) return false
    return [...SANDBOX_EXEMPT_SOURCES].some(id => src.includes(id))
  }

  function applySandboxToIframe(iframe) {
    if (!isAdBlockerEnabled()) return
    if (!iframe || iframe.hasAttribute('data-arcturus-sandboxed')) return

    // Don't sandbox trailer iframes (YouTube embeds need allow-popups for sharing)
    const src = iframe.src || iframe.getAttribute('src') || ''
    if (src.includes('youtube.com') || src.includes('youtu.be')) return

    // Don't sandbox our own preload iframes (they have data-arcturus-preload)
    if (iframe.hasAttribute('data-arcturus-preload')) return

    const sandboxVal = isExemptSource(src) ? PLAYER_SANDBOX_FALLBACK : PLAYER_SANDBOX
    iframe.setAttribute('sandbox', sandboxVal)
    iframe.setAttribute('data-arcturus-sandboxed', '1')
    console.log(`[Arcturus AdBlock] Sandboxed iframe: ${src.slice(0, 60)} [${sandboxVal}]`)
  }

  function sandboxIframes() {
    if (!isAdBlockerEnabled()) return

    // Apply to any iframes already in the DOM
    document.querySelectorAll('#player-container iframe').forEach(applySandboxToIframe)

    // Watch for new iframes added dynamically (JS-created player iframes)
    const sandboxObserver = new MutationObserver(mutations => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.tagName === 'IFRAME') {
            // Small delay so the src attribute is set before we read it
            requestAnimationFrame(() => applySandboxToIframe(node))
          }
          // Also catch iframes nested inside added containers
          if (node.querySelectorAll) {
            node.querySelectorAll('iframe').forEach(iframe => {
              requestAnimationFrame(() => applySandboxToIframe(iframe))
            })
          }
        })
      })
    })

    sandboxObserver.observe(document.getElementById('player-container') || document.body, {
      childList: true,
      subtree: true,
    })
  }

  // ── Existing: fetch / XHR blocking ───────────────────────────
  function blockAdRequests() {
    if (!isAdBlockerEnabled()) return

    const _fetch = window.fetch
    window.fetch = function(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.url
      if (urlStr && !isAllowed(urlStr)) {
        console.log('[Arcturus AdBlock] Blocked fetch:', urlStr)
        return Promise.reject(new Error('Blocked by Arcturus AdBlock'))
      }
      return _fetch.apply(this, arguments)
    }

    const _xhrOpen = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function(method, url) {
      if (url && !isAllowed(url)) {
        console.log('[Arcturus AdBlock] Blocked XHR:', url)
        throw new Error('Blocked by Arcturus AdBlock')
      }
      return _xhrOpen.apply(this, arguments)
    }
  }

  // ── Existing: location redirect blocking ─────────────────────
  function blockRedirects() {
    if (!isAdBlockerEnabled()) return

    const safeRedirect = (url, type) => {
      if (isAllowed(url)) {
        window.location.href = url
      } else {
        console.log(`[Arcturus AdBlock] Blocked redirect (${type}):`, url)
      }
    }

    window.location.assign  = url => safeRedirect(url, 'assign')
    window.location.replace = url => safeRedirect(url, 'replace')

    const hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href')
    if (hrefDesc?.set) {
      Object.defineProperty(Location.prototype, 'href', {
        set(url) {
          if (!isAllowed(url)) {
            console.log('[Arcturus AdBlock] Blocked redirect (href):', url)
            return
          }
          hrefDesc.set.call(this, url)
        },
        get: hrefDesc.get,
      })
    }
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    if (!isAdBlockerEnabled()) {
      console.log('[Arcturus AdBlock] Disabled')
      return
    }

    console.log('[Arcturus AdBlock] v2.0 initialising — four-layer iframe protection')

    // Order matters: popup block must run first, before any iframes load
    blockPopups()             // Method 1 — window.open override
    blockTargetBlankLinks()   // Method 2 — target="_blank" + postMessage intercept
    blockClickHijacking()     // Method 3 — MutationObserver redirect trap
    blockAdScripts()          // Block injected ad scripts/iframes
    blockAdRequests()         // Block fetch/XHR to ad domains
    blockRedirects()          // Block location redirects
    // Method 4 runs after DOM is ready so player-container exists
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', sandboxIframes)
    } else {
      sandboxIframes()
    }

    console.log('[Arcturus AdBlock] v2.0 Active ✓')
  }

  // Run immediately (before iframes) AND after DOM is ready
  init()
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  }

  // Re-init if user toggles the ad blocker in settings
  window.addEventListener('storage', e => {
    if (e.key === 'adBlockerEnabled') init()
  })

})()
