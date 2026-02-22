/**
 * ================================================================
 *  ARCTURUS SMART API ENGINE  —  v2.0
 *  One name. 28 sources. Zero manual switching.
 * ================================================================
 *
 *  v2.0 additions:
 *
 *  CASTING MODE (Section A)
 *  ─────────────────────────
 *  When castingMode = true the engine filters to only sources that
 *  support direct stream URLs (AirPlay / Chromecast compatible).
 *  Iframe-only sources are silently excluded from ranking.
 *  If zero casting-compatible sources are available the engine
 *  calls onNoCastSource(fastestFallback) so the UI can notify the
 *  user and offer to switch to the fastest non-cast source instead.
 *
 *  SCREEN-AWARE SMART CROP (Section B)
 *  ─────────────────────────────────────
 *  The old crop just looked at the player box — which is always
 *  16:9 — so it never detected anything. The real problem is that
 *  embed sources render the VIDEO at the content's native ratio
 *  (e.g. 2.39:1 for a movie) INSIDE the 16:9 iframe, adding black
 *  bars. We can't read iframe pixels, but we CAN use:
 *
 *    1. window.screen.width / height + devicePixelRatio
 *       → classifies the display: phone / tablet / desktop / TV / ultrawide
 *    2. The content's known native ratio (from the video metadata
 *       we already have via TMDB — most movies are 2.39:1 or 1.85:1,
 *       most TV shows are 16:9)
 *    3. The display type → determines target fill ratio
 *
 *  Combined, we calculate the exact CSS scale() needed to push the
 *  black bars outside the overflow:hidden player container.
 *
 *  A ResizeObserver + orientationchange listener re-runs the crop
 *  any time the player size or screen orientation changes, so
 *  fullscreen, rotation, and window resize all stay correct.
 * ================================================================
 */

const ArcturusEngine = (() => {

    // ── State ─────────────────────────────────────────────────────────────────
    let _ranked          = [];
    let _activeIdx       = 0;
    let _qualityData     = {};
    let _contentId       = null;
    let _contentType     = null;   // 'movie' | 'tv'
    let _tvParams        = {};
    let _onSourceChange  = null;
    let _preloads        = [];
    let _autoCrop        = true;
    let _castingMode     = false;
    let _onNoCastSource  = null;
    let _cropTimeout     = null;
    let _resizeObs       = null;
    let _playerRef       = null;
    let _contentRatio    = null;   // set by caller from TMDB data

    const QUALITY_URL    = './quality-data.json';
    const TIMEOUT_MS     = 7000;
    const PRELOAD_COUNT  = 3;
    const STRICT_CASTING = false;

    // ── Section A: Casting-compatible sources ─────────────────────────────────
    // Sources known to work best for casting workflows in this app.
    const CAST_CAPABLE = new Set([
        // NOTE: videasy intentionally excluded based on runtime cast failures.
        'vidfast', 'vidzee', 'pstream',
        'embedsu', 'vidsrcXyz', 'vidsrcrip',
        'vidsrcsu', 'vidsrcvip', 'vidsrccx',
    ]);

    // Higher number = prefer first when casting mode is ON.
    // Prioritize known working vidsrc variants for casting reliability.
    const CAST_PRIORITY = {
        vidsrcsu: 100,
        vidsrcvip: 99,
        vidsrcrip: 98,
        vidsrcXyz: 97,
        vidsrccx: 96,
        pstream: 90,
        vidfast: 88,
        embedsu: 84,
        vidzee: 80,
    };

    // ── Quality baseline ──────────────────────────────────────────────────────
    const FALLBACK_Q = {
        videasy: 95, vidfast: 95, vidzee: 85, pstream: 82,
        embedsu: 80, hexa: 78, vidlink: 75, vidsrcXyz: 72,
        vidsrcrip: 70, vidsrcsu: 70, vidsrcvip: 70,
        multiembed: 68, moviesapi: 68, mapple: 65, autoembed: 65,
        flicky: 62, rive: 62, vidora: 60, nebula: 60,
        smashystream: 58, '2embed': 55, '123embed': 55,
        '111movies': 52, spenflix: 50, vidify: 50,
        vidsrccx: 48, uembed: 45, frembed: 40,
    };

    // ── Helpers ───────────────────────────────────────────────────────────────
    function buildUrl(source, type, params) {
        const t = source.urls[type];
        if (!t) return null;
        return t
            .replace('{id}',      params.id      ?? '')
            .replace('{season}',  params.season  ?? 1)
            .replace('{episode}', params.episode ?? 1);
    }

    function fetchTimeout(url, ms) {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), ms);
        return fetch(url, { signal: ctrl.signal, mode: 'no-cors' })
            .then(r  => { clearTimeout(tid); return r; })
            .catch(() => { clearTimeout(tid); return null; });
    }

    async function loadQuality() {
        try {
            const r = await fetch(QUALITY_URL);
            if (r.ok) { _qualityData = await r.json(); console.log('[Arcturus] Quality data ✓'); }
        } catch { console.log('[Arcturus] Using fallback quality scores'); }
    }

    function score(id) {
        return (_qualityData[id]?.score) ?? (FALLBACK_Q[id] ?? 40);
    }

    // ── Section B: Screen detection ───────────────────────────────────────────
    /**
     * Classify the physical display.
     * Strategy:
     *   • window.screen.width/height = CSS pixels of the screen (not viewport)
     *   • devicePixelRatio = physical px per CSS px
     *   • Physical width = screen.width × DPR
     *   • TVs: report DPR=1 even at 4K (browser doesn't scale like a monitor)
     *   • Distinguish TV vs desktop monitor at same resolution by DPR
     */
    function getScreenProfile() {
        const sw  = window.screen?.width  || window.innerWidth;
        const sh  = window.screen?.height || window.innerHeight;
        const dpr = window.devicePixelRatio || 1;
        const r   = sw / sh;

        // Order matters: most-specific first
        // Ultrawide: ratio > 2.1 (must come before TV check)
        if (r > 2.1 && sw >= 1800)
            return { type: 'ultrawide', sw, sh, dpr, r };

        // TV: DPR=1 (TVs never scale), landscape 16:9-ish, standard widths
        // Excludes high-DPR desktop monitors (MacBook Retina = dpr 2)
        if (dpr <= 1.1 && r >= 1.6 && r <= 2.1 && sw >= 1280 && sw <= 1920)
            return { type: 'tv', sw, sh, dpr, r };

        // Large 4K TV (3840 wide, dpr=1)
        if (dpr <= 1.1 && sw === 3840 && sh === 2160)
            return { type: 'tv', sw, sh, dpr, r };

        // Phone: small or very high-DPR
        if (sw <= 480 || (dpr >= 2.5 && sw <= 900))
            return { type: 'phone', sw, sh, dpr, r };

        // Tablet: medium size, touch-like DPR
        if (sw <= 1024 && dpr >= 1.5)
            return { type: 'tablet', sw, sh, dpr, r };

        return { type: 'desktop', sw, sh, dpr, r };
    }

    /**
     * Calculate the CSS scale() needed to fill the player with the video,
     * pushing black bars outside the overflow:hidden container.
     *
     * The key insight:
     *   Embed sources always render video at its native ratio inside the iframe.
     *   Our player container is padded to 16:9.
     *   If the video is 2.39:1 inside a 16:9 iframe:
     *     • The iframe fills the player 100%
     *     • The video fills (16/9) / (2.39/1) = 74.8% of the iframe height
     *     • Black bars = 12.6% top + 12.6% bottom
     *   Scaling the iframe by 1/0.748 = 1.337 pushes bars outside the container.
     *
     * We derive contentRatio from:
     *   1. Caller-provided _contentRatio (from TMDB release or aspect_ratio field)
     *   2. Content type heuristic: movies → 2.39:1, TV shows → 16:9
     */
    function computeCrop(playerEl) {
        const screen = getScreenProfile();

        // Target fill ratio for this screen type
        let targetRatio;
        switch (screen.type) {
            case 'tv':        targetRatio = screen.r;    break;  // fill the TV exactly
            case 'ultrawide': targetRatio = 21 / 9;      break;  // 21:9 on ultrawide
            default:          targetRatio = 16 / 9;      break;  // standard 16:9 player
        }

        // Content native ratio — what the video is actually encoded at
        // Use caller-provided value, else use sensible content-type defaults
        let contentRatio = _contentRatio;
        if (!contentRatio) {
            // Movies: most modern films are 2.39:1 or 1.85:1
            // TV shows: almost always 16:9
            contentRatio = (_contentType === 'movie') ? 2.39 : 16 / 9;
        }

        // If content ratio ≈ target ratio, no crop needed (within 3% tolerance)
        const diff = Math.abs(contentRatio - targetRatio) / targetRatio;
        if (diff < 0.03) {
            return { needed: false, scale: 1, screen: screen.type };
        }

        let scale;
        if (contentRatio > targetRatio) {
            // Content is WIDER than target → letterbox (black top/bottom)
            // Scale UP so video height fills container height
            // scale = contentRatio / targetRatio
            scale = contentRatio / targetRatio;
        } else {
            // Content is NARROWER than target → pillarbox (black sides)
            // Scale UP so video width fills container width
            // scale = targetRatio / contentRatio
            scale = targetRatio / contentRatio;
        }

        // TV gets a tiny extra push to fill edge-to-edge
        if (screen.type === 'tv') scale *= 1.015;

        // Safety: cap at 1.5x to avoid destroying quality
        scale = Math.min(scale, 1.50);

        const type = contentRatio > targetRatio ? 'letterbox' : 'pillarbox';
        console.log(`[Arcturus] Crop: ${type} | content=${contentRatio.toFixed(3)} target=${targetRatio.toFixed(3)} scale=${scale.toFixed(4)} screen=${screen.type}`);

        return { needed: true, scale, type, screen: screen.type };
    }

    function applyCrop(playerEl, crop) {
        const iframe = playerEl.querySelector('iframe');
        if (!iframe) return;
        if (crop.needed && _autoCrop) {
            iframe.style.transform        = `scale(${crop.scale.toFixed(4)})`;
            iframe.style.transformOrigin  = 'center center';
            playerEl.style.overflow       = 'hidden';
        } else {
            iframe.style.transform        = '';
            iframe.style.transformOrigin  = '';
            playerEl.style.overflow       = '';
        }
    }

    function resetCrop(playerEl) {
        const iframe = playerEl.querySelector('iframe');
        if (!iframe) return;
        iframe.style.transform       = '';
        iframe.style.transformOrigin = '';
        playerEl.style.overflow      = '';
    }

    function runCrop(playerEl) {
        if (!_autoCrop) { resetCrop(playerEl); return; }
        const crop = computeCrop(playerEl);
        applyCrop(playerEl, crop);
    }

    // Schedule crop at 3 checkpoints after iframe loads
    // (embeds paint video content at different times)
    function scheduleCrop(playerEl) {
        _playerRef = playerEl;
        [600, 1800, 3500].forEach(ms => {
            setTimeout(() => {
                if (playerEl.querySelector('iframe')) runCrop(playerEl);
            }, ms);
        });
    }

    // Attach resize + orientation listeners so crop stays correct
    // when user resizes window, goes fullscreen, or rotates device
    function attachCropListeners(playerEl) {
        if (_resizeObs) _resizeObs.disconnect();
        if (window.ResizeObserver) {
            _resizeObs = new ResizeObserver(() => {
                if (_autoCrop && playerEl.querySelector('iframe')) runCrop(playerEl);
            });
            _resizeObs.observe(playerEl);
        }
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                if (_autoCrop && playerEl.querySelector('iframe')) runCrop(playerEl);
            }, 400);
        }, { once: false });
    }

    // ── Source testing ────────────────────────────────────────────────────────
    async function testSources(sources, type, params) {
        console.log(`[Arcturus] Testing ${sources.length} sources…`);
        const results = await Promise.all(
            sources.filter(s => !s.isFrench).map(async s => {
                const url = buildUrl(s, type, params);
                if (!url) return null;
                const r = await fetchTimeout(url, TIMEOUT_MS);
                if (r === null) return null;
                return {
                    source: s,
                    url,
                    castCapable: CAST_CAPABLE.has(s.id)
                };
            })
        );
        const live = results.filter(Boolean);
        console.log(`[Arcturus] ${live.length}/${sources.length} responded`);
        return live;
    }

    function rankSources(live) {
        return live
            .map(r => ({ ...r, score: score(r.source.id), verified: !!_qualityData[r.source.id] }))
            .sort((a, b) => b.score - a.score);
    }

    // ── Preloading ────────────────────────────────────────────────────────────
    function clearPreloads() {
        _preloads.forEach(f => f.parentNode?.removeChild(f));
        _preloads = [];
    }

    function preload(ranked) {
        clearPreloads();
        ranked.slice(0, PRELOAD_COUNT).forEach((r, i) => {
            if (i === 0) return;
            const f = document.createElement('iframe');
            f.src = r.url;
            f.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1280px;height:720px;opacity:0;pointer-events:none;border:none;';
            f.setAttribute('aria-hidden', 'true');
            document.body.appendChild(f);
            _preloads.push(f);
            console.log(`[Arcturus] Preloading #${i + 1}: ${r.source.id}`);
        });
    }

    // ── Failover ──────────────────────────────────────────────────────────────
    function next(playerEl) {
        if (_activeIdx >= _ranked.length - 1) {
            console.warn('[Arcturus] All sources exhausted');
            playerEl.innerHTML = `<div class="absolute inset-0 flex items-center justify-center bg-gray-900 text-white text-center p-4">All sources tried. Please try again later.</div>`;
            return;
        }
        _activeIdx++;
        const n = _ranked[_activeIdx];
        console.log(`[Arcturus] Failover → ${n.source.id} (${n.score})`);
        loadIntoPlayer(n.url, playerEl);
        if (_onSourceChange) _onSourceChange(n.url, n.source.id, n);
    }

    function loadIntoPlayer(url, playerEl) {
        playerEl.innerHTML = '';
        const f = document.createElement('iframe');
        f.src             = url;
        f.className       = 'absolute top-0 left-0 w-full h-full';
        f.frameBorder     = '0';
        f.scrolling       = 'no';
        f.allowFullscreen = true;
        f.addEventListener('load',  () => { scheduleCrop(playerEl); attachCropListeners(playerEl); });
        f.addEventListener('error', () => next(playerEl));
        playerEl.appendChild(f);
    }

    // ── Public API ────────────────────────────────────────────────────────────
    return {

        /**
         * init() — call when detail page loads (before user hits play).
         *
         * @param sources       ARCTURUS_SOURCES array from sources.js
         * @param contentId     TMDB id
         * @param contentType   'movie' | 'tv'
         * @param tvParams      { season, episode }
         * @param castingMode   true = filter to cast-compatible sources only
         * @param contentRatio  native aspect ratio of the content (optional)
         *                      e.g. 2.39 for cinemascope, 1.778 for 16:9 TV
         *                      If omitted, engine uses content-type heuristic
         * @param onReady       callback(rankedArray) when ranking complete
         * @param onNoCastSource callback(fastestFallback) if casting on but no
         *                       cast-compatible source available
         */
        async init({ sources, contentId, contentType, tvParams = {},
                     castingMode = false, contentRatio = null,
                     onReady, onNoCastSource }) {
            console.log('[Arcturus] v2.0 init…');
            _contentId      = contentId;
            _contentType    = contentType;
            _tvParams       = tvParams;
            _castingMode    = castingMode;
            _contentRatio   = contentRatio;
            _onNoCastSource = onNoCastSource || null;

            const params = contentType === 'tv'
                ? { id: contentId, ...tvParams }
                : { id: contentId };

            await loadQuality();

            const live = await testSources(sources, contentType, params);
            let ranked = rankSources(live);

            // Casting filter
            if (_castingMode) {
                const castOnly = ranked
                    .filter(r => r.castCapable)
                    .sort((a, b) => {
                        const pa = CAST_PRIORITY[a.source.id] ?? 0;
                        const pb = CAST_PRIORITY[b.source.id] ?? 0;
                        if (pb !== pa) return pb - pa;
                        return b.score - a.score;
                    });
                if (castOnly.length > 0) {
                    console.log(`[Arcturus] Casting mode: ${castOnly.length} compatible sources`);
                    ranked = castOnly;
                } else {
                    console.warn('[Arcturus] No cast-compatible sources available');
                    if (_onNoCastSource) _onNoCastSource(ranked[0] || null);
                    if (STRICT_CASTING) ranked = [];
                }
            }

            _ranked    = ranked;
            _activeIdx = 0;

            if (_ranked.length === 0) {
                console.warn('[Arcturus] No sources available');
                if (onReady) onReady([]);
                return;
            }

            _ranked.forEach((r, i) =>
                console.log(`  #${i + 1} ${r.source.id.padEnd(14)} score=${r.score}${r.castCapable ? ' 📡' : ''}${r.verified ? ' ✓' : ''}`)
            );

            preload(_ranked);
            if (onReady) onReady(_ranked);
        },

        /** play() — load best source into the player element */
        play(playerEl, onSourceChange) {
            _activeIdx      = 0;
            _onSourceChange = onSourceChange;

            if (_ranked.length === 0) {
                playerEl.innerHTML = `<div class="absolute inset-0 flex items-center justify-center bg-gray-900 text-white text-center p-4">Arcturus API: No sources available right now.</div>`;
                return;
            }

            const best = _ranked[0];
            console.log(`[Arcturus] Playing: ${best.source.id} (score:${best.score}${best.castCapable ? ' 📡' : ''})`);
            loadIntoPlayer(best.url, playerEl);
            if (_onSourceChange) _onSourceChange(best.url, best.source.id, best);
        },

        /** failover() — manually trigger switch to next source */
        failover(playerEl) { next(playerEl); },

        /**
         * setCastingMode() — toggle casting filter at runtime.
         * Immediately re-filters the current ranked list and reloads player.
         */
        setCastingMode(enabled, playerEl, onNoCastSource) {
            _castingMode    = enabled;
            _onNoCastSource = onNoCastSource || _onNoCastSource;
            console.log(`[Arcturus] Casting mode: ${enabled ? 'ON 📡' : 'OFF'}`);
            if (!playerEl) return;

            if (enabled) {
                // Re-filter current ranked list
                const castOnly = _ranked
                    .filter(r => r.castCapable)
                    .sort((a, b) => {
                        const pa = CAST_PRIORITY[a.source.id] ?? 0;
                        const pb = CAST_PRIORITY[b.source.id] ?? 0;
                        if (pb !== pa) return pb - pa;
                        return b.score - a.score;
                    });
                if (castOnly.length > 0) {
                    _ranked    = castOnly;
                    _activeIdx = 0;
                    loadIntoPlayer(_ranked[0].url, playerEl);
                    if (_onSourceChange) _onSourceChange(_ranked[0].url, _ranked[0].source.id, _ranked[0]);
                } else {
                    if (_onNoCastSource) _onNoCastSource(_ranked[0] || null);
                    if (STRICT_CASTING) {
                        _ranked = [];
                        _activeIdx = 0;
                        playerEl.innerHTML = `<div class="absolute inset-0 flex items-center justify-center bg-gray-900 text-white text-center p-4">No cast-compatible source available for this title.</div>`;
                    }
                }
            }
            // When turning OFF: full re-init is handled by caller via refresh()
        },

        /**
         * setAutoCrop() — toggle crop and immediately apply/remove.
         * Also accepts an optional contentRatio to update.
         */
        setAutoCrop(enabled, playerEl, contentRatio) {
            _autoCrop = enabled;
            if (contentRatio !== undefined) _contentRatio = contentRatio;
            if (!playerEl) return;
            if (enabled) runCrop(playerEl);
            else resetCrop(playerEl);
        },

        /** setContentRatio() — update the content's native aspect ratio.
         *  Call this after TMDB data loads, passing the video's aspect ratio.
         *  e.g. setContentRatio(2.39) for cinemascope movies
         *       setContentRatio(1.778) for 16:9 TV shows
         */
        setContentRatio(ratio, playerEl) {
            _contentRatio = ratio;
            if (_autoCrop && playerEl?.querySelector('iframe')) runCrop(playerEl);
        },

        /** recheckCrop() — force re-run crop (e.g. after fullscreen) */
        recheckCrop(playerEl) {
            if (_autoCrop && playerEl) runCrop(playerEl);
        },

        /** getScreenProfile() — returns the detected screen type */
        getScreenProfile() { return getScreenProfile(); },

        isCastingModeEnabled() { return _castingMode; },
        isAutoCropEnabled()    { return _autoCrop; },
        getRankedSources()     { return _ranked; },
        getActiveSource()      { return _ranked[_activeIdx] || null; },

        async refresh({ sources, contentId, contentType, tvParams,
                        castingMode, contentRatio, onReady, onNoCastSource }) {
            clearPreloads();
            _ranked    = [];
            _activeIdx = 0;
            await this.init({ sources, contentId, contentType, tvParams,
                              castingMode, contentRatio, onReady, onNoCastSource });
        },

        destroy() {
            clearPreloads();
            if (_cropTimeout) clearTimeout(_cropTimeout);
            if (_resizeObs)   _resizeObs.disconnect();
        },
    };

})();
