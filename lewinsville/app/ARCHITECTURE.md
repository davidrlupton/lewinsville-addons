# Lewinsville portal — how it is built (2026-10-25)

The family's app for the house at https://lewinsville.vip, with the Claude house assistant built in.
Home Assistant stays the brain; this app is the face.

## Pieces

| Piece | Where | What |
|---|---|---|
| `app/` | this repo | Next.js 16 (App Router, TypeScript, Tailwind v4). One page, five tabs: Home, Lounge (the open-plan first floor: Kitchen-keypad moods, accent colours, every light by room, shades, screen and sound), Rooms, Climate, Talk. Two looks, `festival` (colour) and `slate` (quiet): default per person from the add-on options, switchable with the header button, remembered per device in localStorage, applied via `data-theme` on `<html>`. |
| `addons/lewinsville/` | this repo → `/addons/lewinsville/` on the hub | Local Home Assistant add-on: Dockerfile builds the app, `run.sh` turns add-on options into env, Supervisor gives it `SUPERVISOR_TOKEN` for HA. |
| Cloudflared add-on | hub | Tunnel `lewinsville`: lewinsville.vip and app.lewinsville.vip → this add-on (`http://90b47cbd-lewinsville:3000`), ha.lewinsville.vip → Home Assistant. Cloudflare Access (email allowlist, one-time code) in front of all three. |
| `src/lib/ha.ts` | app | One WebSocket to HA (`ws://supervisor/core/websocket` in the add-on, `HA_URL` on a dev PC). Caches states and the area/floor/entity/device registries. |
| `src/lib/house.ts` | app | Turns registries + states into rooms-by-floor with the devices a person cares about. Same model feeds the UI and Claude. |
| `src/lib/identity.ts` | app | Who is using the app: `Cf-Access-Authenticated-User-Email` from Cloudflare Access, or `DEV_USER_EMAIL` on the LAN. Name, role and default theme come from the add-on `people` list. |
| `src/lib/claude.ts` | app | The agent: model from `CLAUDE_MODEL` (claude-sonnet-5-5 today) via the Anthropic SDK tool runner with four tools, `list_house`, `control` (incl. `set_color` with hs and `set_color_temp` in kelvin), `set_scene`, `set_mood`. Every action goes through `act()`, the same allowlist the buttons use. |
| `/api/state` | app | Server-Sent Events: a full house snapshot, then a new one whenever HA changes anything. |
| `/api/call` | app | Button presses → `act()` or a whole-house scene (Lutron keypad button). |
| `/api/chat` | app | Streams the agent's reply; the browser keeps the transcript and sends it back each turn. |
| `src/lib/log.ts`, `src/lib/jarvis_log.ts`, `/api/log` | app | The request log: one JSON line per ask (Talk turn, button press, Jarvis run) in `/share/lewinsville/requests-YYYY-MM.jsonl` on the hub (dev: `app/.lhh-log/`). Talk and buttons log themselves; Jarvis runs are copied out of HA's pipeline debug store once a minute. Owners see it under Talk → History and can flag misses; flags are appended lines. Reviewed monthly by Claude to tune prompts. |
| `src/lib/energy.ts`, `/api/energy` | app | Whole-home energy: live power from the EP Cube sensors (summed across cubes by regex; battery in kW, positive = charging), kWh per circuit, per cube and per home from HA long-term statistics (`recorder/statistics_during_period`, `change` per sensor and `mean` for battery level, bucketed into 24 hours / 7 or 30 days / 12 months in New York time; negative changes clamped because the daily counters reset). Never sums template sensors (false midnight jumps). Ranges today/week/month/year; 30 s cache. The Energy tab shows the live flow, the added-up card with chart, and the battery to everyone; circuits and per-cube detail to owners only. The agent has `energy_report`. Totals also carry net = bought - sold, which is what Dominion bills under net metering, plus a dollar estimate from the add-on option energy_rate_cents (env ENERGY_RATE_CENTS; 0 hides it). The chart hangs sold kWh below the axis. A $ / kWh toggle (localStorage, dollars by default when a rate exists) formats every total through one helper. Grid in/out per bucket comes from the whole-home Riemann-sum helpers sensor.home_grid_import_energy / _export_energy where they have data (from 2026-10-29) and from the per-cube counters before that, because per-cube sums double count flows that cancel at the utility meter. |
| `src/lib/sounds.ts`, `/api/sounds`, `components/Sounds.tsx` | app | Recorded sounds ("Good morning, kids!"): recorded in the browser (MediaRecorder) or uploaded, converted to mp3 by ffmpeg in the add-on image, kept in `/media/lewinsville/sounds` (add-on map media:rw) with an index.json, played on a speaker through `media_player.play_media` with a `media-source://media_source/local/...` id and `announce: true` so the Sonos resumes afterwards. Household can add, owners delete, anyone signed in can play. Speakers listed in `SPEAKERS`. |

## Secrets

Only one: the Anthropic API key, typed by David into the add-on's configuration in the HA UI. It
lives in `/data/options.json` on the hub and nowhere else. HA access inside the add-on uses the
Supervisor token, which the Supervisor issues at start. On the dev PC, `tools/dev_app.py` pulls
the HA token (and an optional Anthropic key under `LHH-Anthropic`) from the Windows credential
locker. Nothing secret is in this repo.

## Deploying a change

```
# from the repo root
tar -C addons/lewinsville -cf - config.yaml Dockerfile run.sh build.yaml | ssh root@192.168.1.237 'tar -C /addons/lewinsville -xf -'
tar -C . --exclude=app/node_modules --exclude=app/.next -cf - app | ssh root@192.168.1.237 'tar -C /addons/lewinsville -xf -'
ssh root@192.168.1.237 'ha apps reload && ha apps rebuild local_lewinsville'
```

Bump `version` in `config.yaml` so the Supervisor notices. The build runs on the Lenovo and takes a
few minutes.

## Design

Bright and bold on warm cream: marigold, saffron, rani pink, peacock, indigo. Sora for headings,
Manrope for text. Floors carry a colour each (first floor marigold, second rani, loft indigo,
basement peacock, exterior saffron) so a room's tiles say where you are. Dark mode follows the phone.
Room photos come later and become the room pages' backgrounds.

## Still to do

- Cloudflare Access in front of lewinsville.vip and the app's hostname; then route the app through the tunnel.
- Voice PE: HA Assist pipeline with the Anthropic conversation agent (same key).
- Push alerts to phones (HA Companion app), room photos, per-person favourites, kiosk mode for the iPad.

## Design system (0.2.0, 2026-11-01)

The portal follows Emil Kowalski's apple-design and design-engineering skills (installed under `~/.claude/skills`,
source github.com/emilkowalski/skills). The rules that matter when adding a screen:

- **Type**: the system font (`--font-body`, `--font-display`), no web fonts. Large text tightens (`.display`), tiny
  labels open up (`.label`). Any number that can change sits in `.num` so digits don't jitter.
- **Response**: every pressable scales to 0.97 on pointer-down through one global rule in `globals.css`; never add
  feedback on `click`. Hover effects live only inside `@media (hover: hover) and (pointer: fine)`.
- **Materials**: `.card` for content, `.glass` for floating chrome (the tab bar, the toast). Never stack two glass
  surfaces. `prefers-reduced-transparency` and `prefers-contrast` turn glass solid.
- **Motion**: tokens `--ease-out`, `--t-press` (120 ms), `--t-enter` (220 ms), `--t-move` (240 ms); nothing over
  300 ms. Screens use `.enter`; a push uses `.enter-right`, a pop `.enter-left`; a grid of tiles uses `.stagger`.
  Exits are instant. Anything that can be re-triggered quickly (the tab pill, the toast) is a CSS transition, not a
  keyframe, so it retargets mid-flight. `prefers-reduced-motion` swaps travel for a fade.
- **Controls**: choices between a few options use `components/Segmented.tsx`; icons come from `components/Icons.tsx`
  (22 px, 1.75 stroke). Whole-house actions keep the "tap again" confirmation; nothing else asks twice.
- **Phone baseline**: `viewport-fit=cover` plus `env(safe-area-inset-*)` on fixed chrome, `100dvh`, 16 px inputs,
  `overscroll-behavior: none` on the root, `touch-action: manipulation` on controls, theme-color per scheme and look.
