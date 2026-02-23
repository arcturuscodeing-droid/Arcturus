/**
 * ================================================================
 *  ARCTURUS SMART API ENGINE  —  v3.0
 * ================================================================
 *
 *  WHAT RUNS WHEN:
 *  ───────────────
 *  Normal watching  → ONLY the active player iframe. Nothing else.
 *                     Backup source origins get a <link preconnect>
 *                     (DNS + TLS handshake only — zero video bytes).
 *
 *  Fullscreen OR    → After 30 s of stable playback the engine
 *  Casting active     upgrades to "warm standby": one hidden iframe
 *                     for the #2 source is added at 1×1 px, fully
 *                     off-screen. Its src is set WITHOUT autoplay
 *                     params so the embed page loads but the video
 *                     player inside it sits on the poster/idle state.
 *                     This pre-establishes the socket to the CDN so
 *                     failover is near-instant (<500 ms) instead of
 *                     3-7 s. One iframe only, never more.
 *
 *  Why not pause()? → We can't call pause() on cross-origin iframes.
 *                     Instead we strip autoplay query params before
 *                     setting src, so the embed loads idle by default.
 *                     Most sources respect ?autoPlay=false or simply
 *                     don't autoplay without user interaction.
 *
 *  Failover         → Warm standby iframe (if present) is moved into
 *                     the player container instantly. No new network
 *                     request needed — connection already open.
 *                     If no standby exists, normal load proceeds.
 *
 *  Bandwidth safety → The standby iframe is destroyed the moment:
 *                     • Fullscreen exits AND casting ends
 *                     • A new source is playing (refresh/init)
 *                     • destroy() is called
 *                     • The page is hidden (visibilitychange)
 * ================================================================
 */

const ArcturusEngine = (() => {

    // ── State ─────────────────────────────────────────────────────────────────
    let _ranked          = [];
    let _activeIdx       = 0;
    let _qualityData     = {};
    let _contentId       = null;
    let _contentType     = null;
    let _tvParams        = {};
    let _onSourceChange  = null;
    let _autoCrop        = true;
    let _castingMode     = false;
    let _onNoCastSource  = null;
    let _resizeObs       = null;
    let _playerRef       = null;
    let _contentRatio    = null;

    // Warmup state
    let _warmStandby     = null;   // the single hidden standby iframe (or null)
    let _warmTimer       = null;   // 30-s stable-play timer before activating standby
    let _preconnects     = [];     // <link preconnect> elements
    let _isFullscreen    = false;
    let _isCasting       = false;
    let _warmupListened  = false;  // fullscreenchange listener attached once

    const QUALITY_URL       = './quality-data.json';
    const TIMEOUT_MS        = 7000;
    const STABLE_DELAY_MS   = 30000;  // wait 30 s of play before warm standby
    const STRICT_CASTING    = false;
    const CAST_FORCE_SOURCE = 'vidfast';

    // ── Casting-compatible sources ────────────────────────────────────────────
    const CAST_CAPABLE = new Set(['vidfast']);
    const CAST_PRIORITY = { vidfast: 100 };

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

    /**
     * Strip autoplay params from a URL so the embed loads idle.
     * We can't pause a cross-origin iframe, but most embeds respect
     * autoPlay=false or simply don't autoplay without user gesture.
     */
    function makeIdleUrl(url) {
        try {
            const u = new URL(url);
            // Remove or disable common autoplay params
            u.searchParams.set('autoPlay', 'false');
            u.searchParams.set('autoplay', '0');
            u.searchParams.delete('auto_play');
            return u.toString();
        } catch {
            return url; // if URL parsing fails, return as-is
        }
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
            if (r.ok) {
                _qualityData = await r.json();
                console.log('[Arcturus] Quality data ✓');
            }
        } catch {
            console.log('[Arcturus] Using fallback quality scores');
        }
    }

    function score(id) {
        return (_qualityData[id]?.score) ?? (FALLBACK_Q[id] ?? 40);
    }

    // ── Screen detection (for smart crop) ────────────────────────────────────
    function getScreenProfile() {
        const sw  = window.screen?.width  || window.innerWidth;
        const sh  = window.screen?.height || window.innerHeight;
        const dpr = window.devicePixelRatio || 1;
        const r   = sw / sh;

        if (r > 2.1 && sw >= 1800)
            return { type: 'ultrawide', sw, sh, dpr, r };
        if (dpr <= 1.1 && r >= 1.6 && r <= 2.1 && sw >= 1280 && sw <= 1920)
            return { type: 'tv', sw, sh, dpr, r };
        if (dpr <= 1.1 && sw === 3840 && sh === 2160)
            return { type: 'tv', sw, sh, dpr, r };
        if (sw <= 480 || (dpr >= 2.5 && sw <= 900))
            return { type: 'phone', sw, sh, dpr, r };
        if (sw <= 1024 && dpr >= 1.5)
            return { type: 'tablet', sw, sh, dpr, r };
        return { type: 'desktop', sw, sh, dpr, r };
    }

    function computeCrop(playerEl) {
        const screen = getScreenProfile();
        let targetRatio;
        switch (screen.type) {
            case 'tv':        targetRatio = screen.r; break;
            case 'ultrawide': targetRatio = 21 / 9;   break;
            default:          targetRatio = 16 / 9;   break;
        }

        let contentRatio = _contentRatio;
        if (!contentRatio) {
            contentRatio = (_contentType === 'movie') ? 2.39 : 16 / 9;
        }

        const diff = Math.abs(contentRatio - targetRatio) / targetRatio;
        if (diff < 0.03) return { needed: false, scale: 1, screen: screen.type };

        let scale = contentRatio > targetRatio
            ? contentRatio / targetRatio   // letterbox → scale up height
            : targetRatio / contentRatio;  // pillarbox → scale up width

        if (screen.type === 'tv') scale *= 1.015;
        scale = Math.min(scale, 1.50);

        const type = contentRatio > targetRatio ? 'letterbox' : 'pillarbox';
        console.log(`[Arcturus] Crop: ${type} | content=${contentRatio.toFixed(3)} target=${targetRatio.toFixed(3)} scale=${scale.toFixed(4)} screen=${screen.type}`);
        return { needed: true, scale, type, screen: screen.type };
    }

    function applyCrop(playerEl, crop) {
        const iframe = playerEl.querySelector('iframe');
        if (!iframe) return;
        if (crop.needed && _autoCrop) {
            iframe.style.transform       = `scale(${crop.scale.toFixed(4)})`;
            iframe.style.transformOrigin = 'center center';
            playerEl.style.overflow      = 'hidden';
        } else {
            iframe.style.transform       = '';
            iframe.style.transformOrigin = '';
            playerEl.style.overflow      = '';
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
        applyCrop(playerEl, computeCrop(playerEl));
    }

    function scheduleCrop(playerEl) {
        _playerRef = playerEl;
        [600, 1800, 3500].forEach(ms =>
            setTimeout(() => {
                if (playerEl.querySelector('iframe')) runCrop(playerEl);
            }, ms)
        );
    }

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
        });
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
                return { source: s, url, castCapable: CAST_CAPABLE.has(s.id) };
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

    function selectCastingCandidates(ranked) {
        const castOnly = ranked
            .filter(r => r.castCapable)
            .sort((a, b) => {
                const pa = CAST_PRIORITY[a.source.id] ?? 0;
                const pb = CAST_PRIORITY[b.source.id] ?? 0;
                return pb !== pa ? pb - pa : b.score - a.score;
            });
        if (castOnly.length === 0) return castOnly;
        const forced = castOnly.find(r => r.source.id === CAST_FORCE_SOURCE);
        return forced ? [forced] : castOnly;
    }

    // ── Preconnect (always-on, zero bandwidth) ────────────────────────────────
    function clearPreconnects() {
        _preconnects.forEach(l => l.parentNode?.removeChild(l));
        _preconnects = [];
    }

    function addPreconnects(ranked) {
        clearPreconnects();
        // Warm DNS+TLS for top 3 backup sources — no video bytes transferred
        ranked.slice(1, 4).forEach(r => {
            try {
                const origin = new URL(r.url).origin;
                if (document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) return;
                const link = document.createElement('link');
                link.rel  = 'preconnect';
                link.href = origin;
                link.setAttribute('data-arcturus-preconnect', '1');
                document.head.appendChild(link);
                _preconnects.push(link);
                console.log(`[Arcturus] Preconnect: ${r.source.id} (${origin})`);
            } catch { /* skip invalid URLs */ }
        });
    }

    // ── Warm standby iframe (fullscreen/casting only) ─────────────────────────
    function destroyStandby() {
        if (_warmStandby) {
            _warmStandby.parentNode?.removeChild(_warmStandby);
            _warmStandby = null;
            console.log('[Arcturus] Standby destroyed');
        }
        if (_warmTimer) {
            clearTimeout(_warmTimer);
            _warmTimer = null;
        }
    }

    function createStandby() {
        // Only create if we have a #2 source and are in fullscreen or casting
        if (!(_isFullscreen || _isCasting)) return;
        if (_warmStandby) return; // already exists
        if (_ranked.length < 2) return; // no backup source to warm

        const next = _ranked[_activeIdx + 1];
        if (!next) return;

        const idleUrl = makeIdleUrl(next.url);

        const f = document.createElement('iframe');
        f.src = idleUrl;
        // 1×1 px, fixed off-screen — loads page but user never sees it
        f.style.cssText = [
            'position:fixed',
            'top:-9999px',
            'left:-9999px',
            'width:1px',
            'height:1px',
            'opacity:0',
            'pointer-events:none',
            'border:none',
            'visibility:hidden',
        ].join(';');
        f.setAttribute('aria-hidden', 'true');
        f.setAttribute('data-arcturus-standby', '1');
        // No allow="autoplay" — prevents browser granting autoplay permission
        // which further reduces chance of video starting inside the hidden frame
        f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
        document.body.appendChild(f);
        _warmStandby = f;
        console.log(`[Arcturus] Warm standby ready: ${next.source.id}`);
    }

    function scheduleStandby() {
        // Cancel any pending standby timer
        if (_warmTimer) {
            clearTimeout(_warmTimer);
            _warmTimer = null;
        }
        // Only arm if we are in fullscreen or casting
        if (!(_isFullscreen || _isCasting)) return;
        // Arm the 30-second stable-play timer
        _warmTimer = setTimeout(() => {
            _warmTimer = null;
            createStandby();
        }, STABLE_DELAY_MS);
        console.log('[Arcturus] Stable-play timer armed (30s)');
    }

    function cancelStandbyAndReschedule() {
        // Called when fullscreen/casting ends — tear down standby immediately
        destroyStandby();
        // Don't reschedule — conditions no longer met
    }

    // Attach fullscreenchange listener once
    function attachFullscreenListener() {
        if (_warmupListened) return;
        _warmupListened = true;

        const onFullscreenChange = () => {
            const fsEl = document.fullscreenElement
                      || document.webkitFullscreenElement
                      || document.mozFullScreenElement
                      || null;
            _isFullscreen = !!fsEl;
            console.log(`[Arcturus] Fullscreen: ${_isFullscreen}`);
            if (_isFullscreen) {
                scheduleStandby();
            } else {
                cancelStandbyAndReschedule();
            }
        };

        document.addEventListener('fullscreenchange',       onFullscreenChange);
        document.addEventListener('webkitfullscreenchange', onFullscreenChange);
        document.addEventListener('mozfullscreenchange',    onFullscreenChange);

        // Also destroy standby when page is hidden (tab switch, etc.)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                destroyStandby();
            } else if (_isFullscreen || _isCasting) {
                // Page visible again — re-arm the timer
                scheduleStandby();
            }
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

        // If we have a warm standby iframe for this exact source, use it directly
        if (_warmStandby && _warmStandby.dataset.arcturusSourceId === n.source.id) {
            console.log('[Arcturus] Using warm standby — near-instant failover');
            // Move standby into the player — set proper full-size styles
            _warmStandby.style.cssText = '';
            _warmStandby.className     = 'absolute top-0 left-0 w-full h-full';
            _warmStandby.frameBorder   = '0';
            _warmStandby.scrolling     = 'no';
            _warmStandby.allowFullscreen = true;
            // Remove the restrictive sandbox now that it's the active player
            _warmStandby.removeAttribute('sandbox');
            // Reload with the real (autoplay-enabled) URL so video actually starts
            _warmStandby.src = n.url;

            playerEl.innerHTML = '';
            playerEl.appendChild(_warmStandby);
            _warmStandby = null; // no longer a standby

            scheduleCrop(playerEl);
            attachCropListeners(playerEl);
        } else {
            // No standby or wrong source — normal load (preconnect still helps)
            destroyStandby();
            loadIntoPlayer(n.url, playerEl);
        }

        if (_onSourceChange) _onSourceChange(n.url, n.source.id, n);

        // After failover, re-arm the standby timer for the new #2 source
        scheduleStandby();
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
         * init() — call when the watch page loads.
         *
         * @param sources        ARCTURUS_SOURCES array from sources.js
         * @param contentId      TMDB id
         * @param contentType    'movie' | 'tv'
         * @param tvParams       { season, episode }
         * @param castingMode    true = filter to cast-compatible sources only
         * @param contentRatio   native aspect ratio (e.g. 2.39). Optional.
         * @param onReady        callback(rankedArray) — called when ranking done
         * @param onNoCastSource callback(fallback) — if cast mode but no source
         */
        async init({ sources, contentId, contentType, tvParams = {},
                     castingMode = false, contentRatio = null,
                     onReady, onNoCastSource }) {

            console.log('[Arcturus] v3.0 init…');

            // Tear down any previous session
            destroyStandby();
            clearPreconnects();
            _ranked       = [];
            _activeIdx    = 0;

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

            const live   = await testSources(sources, contentType, params);
            let   ranked = rankSources(live);

            if (_castingMode) {
                const castOnly = selectCastingCandidates(ranked);
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

            // Always-on: warm DNS+TLS to backup sources (zero bandwidth)
            addPreconnects(_ranked);

            // Attach fullscreen listener once (idempotent)
            attachFullscreenListener();

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

            // Kill any standby from a previous play session
            destroyStandby();

            const best = _ranked[0];
            console.log(`[Arcturus] Playing: ${best.source.id} (score:${best.score}${best.castCapable ? ' 📡' : ''})`);
            loadIntoPlayer(best.url, playerEl);
            if (_onSourceChange) _onSourceChange(best.url, best.source.id, best);

            // If already in fullscreen or casting when play() is called, arm the timer
            scheduleStandby();
        },

        /** failover() — manually trigger switch to next source */
        failover(playerEl) { next(playerEl); },

        /**
         * notifyCasting(isActive) — call from watch.html whenever
         * casting state changes (Chromecast session start/end, AirPlay).
         * This is the hook that tells the engine to arm the warm standby.
         */
        notifyCasting(isActive) {
            _isCasting = isActive;
            console.log(`[Arcturus] Casting notified: ${isActive}`);
            if (isActive) {
                scheduleStandby();
            } else if (!_isFullscreen) {
                // Only destroy if also not in fullscreen
                cancelStandbyAndReschedule();
            }
        },

        /**
         * setCastingMode() — toggle cast-source filter at runtime.
         */
        setCastingMode(enabled, playerEl, onNoCastSource) {
            _castingMode    = enabled;
            _onNoCastSource = onNoCastSource || _onNoCastSource;
            console.log(`[Arcturus] Casting mode: ${enabled ? 'ON 📡' : 'OFF'}`);
            if (!playerEl) return;

            if (enabled) {
                const castOnly = selectCastingCandidates(_ranked);
                if (castOnly.length > 0) {
                    _ranked    = castOnly;
                    _activeIdx = 0;
                    destroyStandby();
                    loadIntoPlayer(_ranked[0].url, playerEl);
                    if (_onSourceChange) _onSourceChange(_ranked[0].url, _ranked[0].source.id, _ranked[0]);
                } else {
                    if (_onNoCastSource) _onNoCastSource(_ranked[0] || null);
                    if (STRICT_CASTING) {
                        _ranked    = [];
                        _activeIdx = 0;
                        playerEl.innerHTML = `<div class="absolute inset-0 flex items-center justify-center bg-gray-900 text-white text-center p-4">No cast-compatible source available for this title.</div>`;
                    }
                }
            }
        },

        /** setAutoCrop() — toggle crop on/off */
        setAutoCrop(enabled, playerEl, contentRatio) {
            _autoCrop = enabled;
            if (contentRatio !== undefined) _contentRatio = contentRatio;
            if (!playerEl) return;
            if (enabled) runCrop(playerEl);
            else resetCrop(playerEl);
        },

        /** setContentRatio() — update native aspect ratio from TMDB data */
        setContentRatio(ratio, playerEl) {
            _contentRatio = ratio;
            if (_autoCrop && playerEl?.querySelector('iframe')) runCrop(playerEl);
        },

        /** recheckCrop() — force re-run crop (e.g. after fullscreen exit) */
        recheckCrop(playerEl) {
            if (_autoCrop && playerEl) runCrop(playerEl);
        },

        /** getScreenProfile() — returns the detected screen type object */
        getScreenProfile() { return getScreenProfile(); },

        isCastingModeEnabled() { return _castingMode; },
        isAutoCropEnabled()    { return _autoCrop; },
        getRankedSources()     { return _ranked; },
        getActiveSource()      { return _ranked[_activeIdx] || null; },

        async refresh({ sources, contentId, contentType, tvParams,
                        castingMode, contentRatio, onReady, onNoCastSource }) {
            await this.init({ sources, contentId, contentType, tvParams,
                              castingMode, contentRatio, onReady, onNoCastSource });
        },

        destroy() {
            destroyStandby();
            clearPreconnects();
            if (_resizeObs) _resizeObs.disconnect();
        },
    };

})();
