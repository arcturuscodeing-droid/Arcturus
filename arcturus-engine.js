/**
 * ============================================================
 *  ARCTURUS SMART API ENGINE  —  v1.0
 *  One name. 30 sources. Zero manual switching.
 * ============================================================
 *
 *  How it works:
 *   1. All sources in availableSources[] are tested simultaneously
 *      via Promise.all() with a 3-second timeout.
 *   2. Responding sources are cross-referenced with quality-data.json
 *      for verified resolution ratings.
 *   3. Sources are ranked: availability first, then quality score.
 *   4. Top 2–3 sources silently preload the moment the detail page loads.
 *   5. The best source loads automatically — always labelled "Arcturus API".
 *   6. If the active source fails mid-watch, the engine switches silently
 *      to the next ranked source (already partially buffered).
 *   7. Black bar detection runs via aspect-ratio geometry on the iframe.
 *      If bars detected, a CSS scale-crop is applied before playback starts.
 * ============================================================
 */

const ArcturusEngine = (() => {

    // ── Internal state ────────────────────────────────────────────────────────
    let _rankedSources   = [];          // sorted after testing
    let _activeIndex     = 0;           // which ranked source is playing
    let _qualityData     = {};          // from quality-data.json
    let _contentId       = null;
    let _contentType     = null;        // 'movie' | 'tv'
    let _tvParams        = {};          // { season, episode }
    let _onSourceChange  = null;        // callback(url, sourceId)
    let _preloadIframes  = [];          // hidden preload iframes
    let _autoCropEnabled = true;
    let _blackBarTimeout = null;

    const QUALITY_JSON_URL = './quality-data.json';
    const TEST_TIMEOUT_MS  = 3000;
    const PRELOAD_COUNT    = 3;

    // Quality score map (fallback if JSON unavailable)
    const FALLBACK_QUALITY = {
        'videasy'   : 95,   // labelled 4K
        'vidfast'   : 95,   // labelled 4K
        'vidzee'    : 85,
        'pstream'   : 80,
        'embedsu'   : 80,
        'hexa'      : 78,
        'vidlink'   : 75,
        'vidsrcXyz' : 72,
        'vidsrcrip' : 70,
        'vidsrcsu'  : 70,
        'vidsrcvip' : 70,
        'multiembed': 68,
        'moviesapi' : 68,
        'mapple'    : 65,
        'autoembed' : 65,
        'flicky'    : 62,
        'rive'      : 62,
        'vidora'    : 60,
        'nebula'    : 60,
        'smashystream':58,
        '2embed'    : 55,
        '123embed'  : 55,
        '111movies' : 52,
        'spenflix'  : 50,
        'vidify'    : 50,
        'vidsrccx'  : 48,
        'uembed'    : 45,
        'frembed'   : 40,
    };

    // ── Utility ───────────────────────────────────────────────────────────────

    /** Build a source's embed URL from its template */
    function buildUrl(source, type, params) {
        const template = source.urls[type];
        if (!template) return null;
        return template
            .replace('{id}',      params.id      || '')
            .replace('{season}',  params.season  || 1)
            .replace('{episode}', params.episode || 1);
    }

    /** Fetch with a hard timeout. Resolves with Response or null. */
    function fetchWithTimeout(url, ms) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ms);
        return fetch(url, { signal: controller.signal, mode: 'no-cors' })
            .then(r  => { clearTimeout(timer); return r; })
            .catch(() => { clearTimeout(timer); return null; });
    }

    /** Load quality-data.json from the repo */
    async function loadQualityData() {
        try {
            const res = await fetch(QUALITY_JSON_URL);
            if (res.ok) {
                _qualityData = await res.json();
                console.log('[Arcturus] Quality data loaded ✓');
            }
        } catch {
            console.log('[Arcturus] quality-data.json unavailable — using fallback scores');
        }
    }

    /** Return quality score for a source (0–100) */
    function qualityScore(sourceId) {
        return (_qualityData[sourceId]?.score) ?? (FALLBACK_QUALITY[sourceId] ?? 40);
    }

    // ── Step 1: Simultaneous availability test ────────────────────────────────

    /**
     * Ping all non-French sources simultaneously.
     * Returns array of source ids that responded within timeout.
     */
    async function testAllSources(sources, type, params) {
        console.log(`[Arcturus] Testing ${sources.length} sources simultaneously…`);

        const tests = sources
            .filter(s => !s.isFrench)
            .map(async (source) => {
                const url = buildUrl(source, type, params);
                if (!url) return null;
                const res = await fetchWithTimeout(url, TEST_TIMEOUT_MS);
                // no-cors always returns opaque (status 0) for cross-origin —
                // a null result means the request was aborted (timeout/network error)
                if (res !== null) {
                    return { source, url, responded: true };
                }
                return null;
            });

        const results = await Promise.all(tests);
        const live = results.filter(Boolean);
        console.log(`[Arcturus] ${live.length}/${sources.length} sources responded`);
        return live;
    }

    // ── Step 2: Rank by availability then quality ─────────────────────────────

    function rankSources(liveResults) {
        return liveResults
            .map(r => ({
                ...r,
                score: qualityScore(r.source.id),
                verified: !!_qualityData[r.source.id]
            }))
            .sort((a, b) => b.score - a.score);
    }

    // ── Step 3: Silent preloading ─────────────────────────────────────────────

    function clearPreloadIframes() {
        _preloadIframes.forEach(iframe => {
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        });
        _preloadIframes = [];
    }

    function preloadTopSources(ranked) {
        clearPreloadIframes();
        const toPreload = ranked.slice(0, PRELOAD_COUNT);

        toPreload.forEach((r, i) => {
            if (i === 0) return; // #1 will load in the real player

            const iframe = document.createElement('iframe');
            iframe.src = r.url;
            iframe.style.cssText = `
                position: fixed;
                top: -9999px;
                left: -9999px;
                width: 1280px;
                height: 720px;
                opacity: 0;
                pointer-events: none;
                border: none;
            `;
            iframe.setAttribute('aria-hidden', 'true');
            iframe.setAttribute('data-arcturus-preload', r.source.id);
            document.body.appendChild(iframe);
            _preloadIframes.push(iframe);
            console.log(`[Arcturus] Preloading source #${i + 1}: ${r.source.id}`);
        });
    }

    // ── Step 4: Black bar detection & auto crop ───────────────────────────────

    /**
     * Common standard aspect ratios and their target ratio values.
     * We compare the iframe's rendered aspect ratio against these
     * to infer whether letterbox (top/bottom) or pillarbox (side) bars exist.
     */
    const STANDARD_RATIOS = [
        { name: '16:9',   ratio: 16 / 9  },
        { name: '21:9',   ratio: 21 / 9  },
        { name: '4:3',    ratio: 4  / 3  },
        { name: '2.39:1', ratio: 2.39    },
        { name: '2.35:1', ratio: 2.35    },
    ];

    const CONTAINER_RATIO = 16 / 9; // our player is always 16:9

    function detectBlackBars(playerEl) {
        const rect   = playerEl.getBoundingClientRect();
        const cW     = rect.width;
        const cH     = rect.height;
        if (!cW || !cH) return { detected: false };

        const containerRatio = cW / cH;

        // Find the closest standard content ratio
        let bestMatch = null;
        let bestDiff  = Infinity;
        for (const sr of STANDARD_RATIOS) {
            const diff = Math.abs(sr.ratio - containerRatio);
            if (diff < bestDiff) { bestDiff = diff; bestMatch = sr; }
        }

        // If the content ratio is wider than 16:9 → letterbox (top/bottom bars)
        // If narrower → pillarbox (side bars)
        const TOLERANCE = 0.05;
        const hasLetterbox = bestMatch && (bestMatch.ratio - CONTAINER_RATIO) >  TOLERANCE;
        const hasPillarbox = bestMatch && (CONTAINER_RATIO - bestMatch.ratio) >  TOLERANCE;

        if (!hasLetterbox && !hasPillarbox) {
            return { detected: false };
        }

        // Calculate crop scale
        let scaleX = 1, scaleY = 1;
        if (hasLetterbox) {
            // Scale vertically to fill height, then crop sides
            scaleY = CONTAINER_RATIO / bestMatch.ratio;
            scaleX = scaleY;
        } else if (hasPillarbox) {
            // Scale horizontally to fill width, then crop top/bottom
            scaleX = bestMatch.ratio / CONTAINER_RATIO;
            scaleY = scaleX;
        }

        return {
            detected: true,
            type: hasLetterbox ? 'letterbox' : 'pillarbox',
            scale: Math.max(scaleX, scaleY),
            bestMatch
        };
    }

    function applyAutoCrop(playerEl, cropInfo) {
        const iframe = playerEl.querySelector('iframe');
        if (!iframe) return;

        if (cropInfo.detected && _autoCropEnabled) {
            const s = cropInfo.scale.toFixed(4);
            iframe.style.transform        = `scale(${s})`;
            iframe.style.transformOrigin  = 'center center';
            iframe.style.overflow         = 'hidden';
            playerEl.style.overflow       = 'hidden';
            console.log(`[Arcturus] Auto crop applied — scale(${s}) for ${cropInfo.type}`);
        } else {
            iframe.style.transform        = '';
            iframe.style.transformOrigin  = '';
        }
    }

    function resetCrop(playerEl) {
        const iframe = playerEl.querySelector('iframe');
        if (iframe) {
            iframe.style.transform       = '';
            iframe.style.transformOrigin = '';
        }
    }

    // Run detection shortly after iframe loads (slight delay for render)
    function scheduleBlackBarCheck(playerEl) {
        if (_blackBarTimeout) clearTimeout(_blackBarTimeout);
        _blackBarTimeout = setTimeout(() => {
            const cropInfo = detectBlackBars(playerEl);
            if (cropInfo.detected) {
                console.log(`[Arcturus] Black bars detected: ${cropInfo.type}`);
                applyAutoCrop(playerEl, cropInfo);
            } else {
                resetCrop(playerEl);
            }
        }, 800); // wait for iframe to paint
    }

    // ── Step 5: Active source failover ────────────────────────────────────────

    function switchToNext(playerEl) {
        if (_activeIndex >= _rankedSources.length - 1) {
            console.warn('[Arcturus] All sources exhausted.');
            return;
        }
        _activeIndex++;
        const next = _rankedSources[_activeIndex];
        console.log(`[Arcturus] Switching to next source: ${next.source.id} (score: ${next.score})`);
        loadSource(next.url, playerEl);
        if (_onSourceChange) _onSourceChange(next.url, 'arcturusapi');
    }

    function loadSource(url, playerEl) {
        playerEl.innerHTML = '';
        const iframe = document.createElement('iframe');
        iframe.src            = url;
        iframe.className      = 'absolute top-0 left-0 w-full h-full';
        iframe.frameBorder    = '0';
        iframe.scrolling      = 'no';
        iframe.allowFullscreen = true;

        iframe.addEventListener('load',  () => {
            console.log('[Arcturus] Source loaded ✓');
            scheduleBlackBarCheck(playerEl);
        });

        iframe.addEventListener('error', () => {
            console.warn('[Arcturus] Source error — switching…');
            switchToNext(playerEl);
        });

        playerEl.appendChild(iframe);
    }

    // ── Public API ────────────────────────────────────────────────────────────

    return {

        /**
         * Initialise the engine.
         * Call this when the detail page loads (not on Play click).
         *
         * @param {Object} opts
         * @param {Array}  opts.sources        — full availableSources[] array
         * @param {string} opts.contentId      — TMDB id
         * @param {string} opts.contentType    — 'movie' | 'tv'
         * @param {Object} opts.tvParams       — { season, episode }
         * @param {Function} opts.onReady      — called when ranked list is ready
         */
        async init({ sources, contentId, contentType, tvParams = {}, onReady }) {
            console.log('[Arcturus] Engine initialising…');
            _contentId   = contentId;
            _contentType = contentType;
            _tvParams    = tvParams;

            const params = contentType === 'tv'
                ? { id: contentId, ...tvParams }
                : { id: contentId };

            await loadQualityData();

            const live   = await testAllSources(sources, contentType, params);
            _rankedSources = rankSources(live);

            if (_rankedSources.length === 0) {
                console.warn('[Arcturus] No sources available.');
                return;
            }

            console.log('[Arcturus] Ranked sources:');
            _rankedSources.forEach((r, i) =>
                console.log(`  #${i + 1}  ${r.source.id.padEnd(15)} score=${r.score}${r.verified ? ' ✓' : ' (unverified)'}`)
            );

            // Silently preload top 2-3
            preloadTopSources(_rankedSources);

            if (onReady) onReady(_rankedSources);
        },

        /**
         * Load the best source into the player container.
         * Call this when the user hits Play (or auto-play fires).
         *
         * @param {HTMLElement} playerEl       — #player-container
         * @param {Function}    onSourceChange — callback(url, 'arcturusapi')
         */
        play(playerEl, onSourceChange) {
            _activeIndex     = 0;
            _onSourceChange  = onSourceChange;

            if (_rankedSources.length === 0) {
                playerEl.innerHTML = `<div class="absolute inset-0 flex items-center justify-center bg-gray-900 text-white">Arcturus API: No sources available right now.</div>`;
                return;
            }

            const best = _rankedSources[0];
            console.log(`[Arcturus] Playing: ${best.source.id} (score: ${best.score})`);
            loadSource(best.url, playerEl);
        },

        /**
         * Call this if the current source fails (e.g. providerTimeout fires).
         * Engine switches to next pre-ranked source.
         *
         * @param {HTMLElement} playerEl
         */
        failover(playerEl) {
            switchToNext(playerEl);
        },

        /**
         * Toggle auto black-bar crop on/off.
         * @param {boolean} enabled
         * @param {HTMLElement} playerEl
         */
        setAutoCrop(enabled, playerEl) {
            _autoCropEnabled = enabled;
            if (playerEl) {
                const cropInfo = detectBlackBars(playerEl);
                if (enabled && cropInfo.detected) {
                    applyAutoCrop(playerEl, cropInfo);
                } else {
                    resetCrop(playerEl);
                }
            }
        },

        /** Returns true if auto crop is currently on */
        isAutoCropEnabled() { return _autoCropEnabled; },

        /** Returns the current ranked list (for debug or display) */
        getRankedSources() { return _rankedSources; },

        /** Returns the source currently playing */
        getActiveSource() { return _rankedSources[_activeIndex] || null; },

        /** Update tv params and re-run engine (for episode changes) */
        async refresh({ contentId, contentType, tvParams, sources, onReady }) {
            clearPreloadIframes();
            _rankedSources = [];
            _activeIndex   = 0;
            await this.init({ sources, contentId, contentType, tvParams, onReady });
        },

        /** Clean up (call on page unload) */
        destroy() {
            clearPreloadIframes();
            if (_blackBarTimeout) clearTimeout(_blackBarTimeout);
        }
    };

})();
