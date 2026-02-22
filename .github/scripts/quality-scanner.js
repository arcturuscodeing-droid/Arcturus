/**
 * Arcturus Quality Scanner
 * ─────────────────────────
 * Runs in GitHub Actions every 6 hours.
 * Pings every source in sources list, measures response time,
 * infers quality tier from response headers, and writes
 * quality-data.json to the repo root.
 *
 * Sources that block automated requests are marked unverified
 * but still included so the engine can fall back to them.
 */

import fetch from 'node-fetch';
import fs    from 'fs';
import path  from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT    = path.resolve(__dirname, '../../quality-data.json');

const TIMEOUT_MS = 5000;

const BASE_QUALITY = {
    videasy:        { base: 95, label: '4K'    },
    vidfast:        { base: 95, label: '4K'    },
    vidzee:         { base: 85, label: '1080p' },
    pstream:        { base: 82, label: '1080p' },
    embedsu:        { base: 80, label: '1080p' },
    hexa:           { base: 78, label: '1080p' },
    vidlink:        { base: 75, label: '1080p' },
    vidsrcXyz:      { base: 72, label: '1080p' },
    vidsrcrip:      { base: 70, label: '1080p' },
    vidsrcsu:       { base: 70, label: '1080p' },
    vidsrcvip:      { base: 70, label: '1080p' },
    multiembed:     { base: 68, label: '720p'  },
    moviesapi:      { base: 68, label: '720p'  },
    mapple:         { base: 65, label: '720p'  },
    autoembed:      { base: 65, label: '720p'  },
    flicky:         { base: 62, label: '720p'  },
    rive:           { base: 62, label: '720p'  },
    vidora:         { base: 60, label: '720p'  },
    nebula:         { base: 60, label: '720p'  },
    smashystream:   { base: 58, label: '720p'  },
    '2embed':       { base: 55, label: '480p'  },
    '123embed':     { base: 55, label: '480p'  },
    '111movies':    { base: 52, label: '480p'  },
    spenflix:       { base: 50, label: '480p'  },
    vidify:         { base: 50, label: '480p'  },
    vidsrccx:       { base: 48, label: '480p'  },
    uembed:         { base: 45, label: 'unknown'},
    frembed:        { base: 40, label: 'unknown'},
};

const TEST_MOVIE_ID = '550';

const SOURCES = [
    { id: 'mapple',       url: `https://mappletv.uk/watch/movie/${TEST_MOVIE_ID}` },
    { id: 'pstream',      url: `https://iframe.pstream.mov/media/tmdb-movie-${TEST_MOVIE_ID}` },
    { id: 'multiembed',   url: `https://multiembed.mov/?video_id=${TEST_MOVIE_ID}&tmdb=1` },
    { id: 'moviesapi',    url: `https://moviesapi.club/movie/${TEST_MOVIE_ID}` },
    { id: 'embedsu',      url: `https://embed.su/embed/movie/${TEST_MOVIE_ID}` },
    { id: 'hexa',         url: `https://hexa.watch/watch/movie/${TEST_MOVIE_ID}` },
    { id: 'vidlink',      url: `https://vidlink.pro/movie/${TEST_MOVIE_ID}` },
    { id: 'vidsrcXyz',    url: `https://vidsrc.xyz/embed/movie/${TEST_MOVIE_ID}` },
    { id: 'vidsrcrip',    url: `https://vidsrc.rip/embed/movie/${TEST_MOVIE_ID}` },
    { id: 'vidsrcsu',     url: `https://vidsrc.su/embed/movie/${TEST_MOVIE_ID}` },
    { id: 'vidsrcvip',    url: `https://vidsrc.vip/embed/movie/${TEST_MOVIE_ID}` },
    { id: '2embed',       url: `https://www.2embed.cc/embed/${TEST_MOVIE_ID}` },
    { id: '123embed',     url: `https://play2.123embed.net/movie/${TEST_MOVIE_ID}` },
    { id: '111movies',    url: `https://111movies.com/movie/${TEST_MOVIE_ID}` },
    { id: 'smashystream', url: `https://player.smashy.stream/movie/${TEST_MOVIE_ID}` },
    { id: 'autoembed',    url: `https://player.autoembed.cc/embed/movie/${TEST_MOVIE_ID}` },
    { id: 'videasy',      url: `https://player.videasy.net/movie/${TEST_MOVIE_ID}?color=8834ec` },
    { id: 'vidfast',      url: `https://vidfast.pro/movie/${TEST_MOVIE_ID}` },
    { id: 'vidify',       url: `https://vidify.top/embed/movie/${TEST_MOVIE_ID}` },
    { id: 'flicky',       url: `https://flicky.host/embed/movie/?id=${TEST_MOVIE_ID}` },
    { id: 'rive',         url: `https://rivestream.org/embed?type=movie&id=${TEST_MOVIE_ID}` },
    { id: 'vidora',       url: `https://vidora.su/movie/${TEST_MOVIE_ID}` },
    { id: 'nebula',       url: `https://nebulaflix.stream/movie?mt=${TEST_MOVIE_ID}&server=1` },
    { id: 'vidzee',       url: `https://player.vidzee.wtf/embed/movie/${TEST_MOVIE_ID}` },
    { id: 'spenflix',     url: `https://spencerdevs.xyz/movie/${TEST_MOVIE_ID}` },
    { id: 'vidsrccx',     url: `https://vidsrc.cx/embed/movie/${TEST_MOVIE_ID}` },
    { id: 'uembed',       url: `https://uembed.site/?id=${TEST_MOVIE_ID}` },
];

async function scanSource(source) {
    const start = Date.now();
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

        const res = await fetch(source.url, {
            signal: ctrl.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArcturusBot/1.0)' },
            redirect: 'follow',
        });
        clearTimeout(timer);

        const ms         = Date.now() - start;
        const contentLen = parseInt(res.headers.get('content-length') || '0', 10);
        const responded  = res.status < 500;
        const speedBonus = ms < 500 ? 5 : ms < 1000 ? 3 : ms < 2000 ? 1 : 0;
        const sizeBonus  = contentLen > 50000 ? 3 : contentLen > 10000 ? 1 : 0;
        const base       = BASE_QUALITY[source.id]?.base || 40;
        const finalScore = Math.min(100, base + speedBonus + sizeBonus);

        return { id: source.id, score: finalScore, label: BASE_QUALITY[source.id]?.label || 'unknown', verified: responded, avg_response_ms: ms };
    } catch {
        return { id: source.id, score: BASE_QUALITY[source.id]?.base || 40, label: BASE_QUALITY[source.id]?.label || 'unknown', verified: false, avg_response_ms: 0 };
    }
}

async function main() {
    console.log(`[QualityScanner] Scanning ${SOURCES.length} sources…`);
    const results = await Promise.all(SOURCES.map(scanSource));

    const output = {
        _meta: {
            description: 'Arcturus API — Verified Source Quality Registry',
            generated:   new Date().toISOString(),
            generator:   'GitHub Actions / quality-scanner.yml',
            note:        'Scores updated automatically every 6 hours. Do not edit manually.',
        }
    };

    results.forEach(r => {
        output[r.id] = { score: r.score, label: r.label, verified: r.verified, avg_response_ms: r.avg_response_ms };
        console.log(`  ${r.id.padEnd(16)} ${r.verified ? `✓ ${r.avg_response_ms}ms score=${r.score}` : '✗ unverified'}`);
    });

    fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
    console.log(`[QualityScanner] Written → ${OUTPUT}`);
}

main().catch(err => { console.error(err); process.exit(1); });
