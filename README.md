# Arcturus Smart API — Deployment Guide

## Files
| File | Purpose |
|------|---------|
| `watch.html` | Your main watch page — fully patched |
| `sources.js` | ARCTURUS_SOURCES (28 sources) + availableSources (1: Arcturus API) |
| `arcturus-engine.js` | The smart engine — test, rank, preload, crop |
| `quality-data.json` | Verified quality scores (auto-updated by GitHub Actions) |
| `.github/workflows/quality-scanner.yml` | Scheduled quality scanner (runs every 6h) |
| `.github/scripts/quality-scanner.js` | Scanner script |

## Deploy Steps
1. Copy `watch.html`, `sources.js`, `arcturus-engine.js`, `quality-data.json` into your repo root
2. Copy `.github/` folder into your repo root (for auto quality updates)
3. Push to GitHub — Actions will activate automatically
4. Done. Arcturus API is live.

## How it works
- Page loads → engine tests all 28 sources simultaneously (Promise.all, 3s timeout)
- Sources ranked by availability first, then verified quality score
- Top 2–3 silently preload in hidden iframes
- Best source auto-plays → labelled "Arcturus API" in UI
- If source fails → engine silently switches to next ranked source
- Black bars detected via aspect ratio math → CSS crop applied automatically
- Quality scores auto-updated every 6 hours via GitHub Actions
