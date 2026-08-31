# To-Do

A small, dependency-free to-do list that runs entirely in the browser. No build
step, no server, no `npm install` — a handful of static files and a
`localStorage` key.

Warm neutrals carry the structure and a single amber accent marks what is
interactive or imminent. Color is never decorative: priority uses a red / amber
/ green scale kept to small marks — a dot and a 3px rule — so the rows stay
calm. Headings are set in Fraunces; everything else uses the system UI font.

**Live at:** https://jrawat2001.github.io/To-Do/

## Install it as an app

The live URL is installable — it gets its own icon and window, and works with no
internet once installed.

| Platform | How |
| --- | --- |
| Chrome / Edge (desktop) | Click **Install** in the app header, or the install icon at the right of the address bar |
| Android (Chrome) | Menu **⋮** → *Add to Home screen* |
| iPhone / iPad (Safari) | Share **⬆︎** → *Add to Home Screen* (iOS never shows an automatic prompt) |

## Running it locally

Open `index.html` in any modern browser — no build step, no install.

Or serve it over HTTP, which is required if you want the offline service worker
to register:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Features

- **Add, complete, and delete** tasks.
- **Editing** — the ✎ on any row opens a dialog covering every field: title, due
  date and time, priority, estimate and tags. Enter saves, Escape cancels, and
  clearing the title still deletes the task.
- **Filters** — All / Active / Done, with a live "N items left" counter and a
  "Clear completed" action that appears only when something is done.
- **Due dates** — a pill on each task: red once overdue, amber for today, muted
  gray for anything further out, and nothing at all when no date is set. Reads
  `Today` on the day, otherwise `Sep 3`.
- **Priority** — Low / Medium / High, shown as a colored dot and a 3px left
  border on the row (red / amber / green), plus heavier text for high priority.
- **Tags** — type in the composer and press Enter or comma to make a chip; up to
  six per task. Purely descriptive, so they never affect sort order.
- **Tab counts** — All / Active / Done each carry a live count.
- **Sorting** — incomplete first, then by priority, then by soonest due date
  (undated tasks last), then by creation time.
- **Dark mode** — toggle in the header. Follows your OS preference on first visit
  and remembers your choice afterwards.
- **Keyboard and screen-reader friendly** — real form controls, labeled buttons,
  visible focus rings, and a live-updating counter.
- **Works offline** — a service worker caches the app, so an installed copy opens
  with no connection.

## Due times and escalation

A due date says which day; a **due time** says which moment. Give a task both and
it escalates once that moment passes:

- it sorts and displays as **high priority**, whatever priority you set;
- the row turns red and its title goes bold;
- a **+15m** button appears on the row for a one-tap reprieve.

Escalation is derived, never written to the task, so pushing the time back
restores exactly the priority you originally chose. The edit dialog has larger
pushes — 15m, 1h, 3h, 1 day — and pushing from a moment already gone counts
from now rather than from the missed time.

The page checks every 15 seconds, so a task escalates while you are looking at
it, not only after a reload.

## Focus Mode

A timer tied to finishing a task rather than to a fixed interval.

1. Give a task a **time estimate** when you add it.
2. **Tap the task** (or its ▶ button) to start counting down that estimate.
3. When the time is up the app asks: **Done, or need more time?**
   - *Done* checks the task off.
   - *+5 / +10 min* extends and keeps going — as often as you need.
4. Every completed task logs **actual time against estimate**.
5. **Focus stats** (in the footer, once there is history) shows which kinds of
   task consistently run over.

**Reset** on the focus bar puts the countdown back to the full estimate and
throws away the time counted in that session — the escape hatch for a timer
started by a stray tap.

Once a few sessions are logged, choosing an estimate surfaces a suggestion
based on how much longer your tasks actually take — click it to apply.

## Standalone timer

The clock icon in the header opens a full-screen timer that has nothing to do
with your tasks. Set any duration in hours and minutes (or use a preset), press
Start, and that is the whole interface: a countdown, a ring, and one button.

Closing the view does not stop it — a dot on the header icon shows it is still
running, amber while counting and red once the time is up. It survives reloads,
and if it finishes while the view is closed the view opens itself. It runs
independently of a task timer, so both can count at once.

The countdown runs on wall-clock time, so it keeps going while the tab is in
the background or the app is closed. Recorded time is capped at the planned
duration, so leaving the app closed overnight expires the timer without
inventing hours of focus that never happened. A running timer survives a
reload; stopping early keeps the time you spent but logs nothing, since a
half-finished task says nothing useful about the estimate.

## The chime

Both timers ring when they end: a soft three-note figure (A4 · D5 · F#5) with a
long decay, repeating every 2.2 seconds. It is synthesised with the Web Audio
API rather than shipped as an audio file, so it costs no bytes and works
offline.

It keeps ringing for **two minutes** unless you stop it — long enough to be
heard from another room — then stops on its own. Cycles are scheduled a few
seconds ahead and topped up rather than queued all at once, so silencing takes
effect immediately instead of after a backlog of notes drains.

**Silence the chime** appears on the alert while it is ringing: it quiets the
sound but leaves the decision open, so you can stop the noise before choosing
Done or an extension. Dealing with the timer any other way — Done, an
extension, Stop, Reset, closing the timer view — also silences it.

The speaker icon in the header mutes it altogether, and the choice persists.
Turning it back on plays the chime once so you can hear what you are agreeing to.

Browsers refuse to play audio until the page has been interacted with, so the
chime stays silent if a timer expires on a page nobody has touched since it
loaded. The visual alert always appears regardless.

## Getting reminders on your phone

The app has no server, so it cannot push anything anywhere — and no web app can
write into Apple Reminders, which has no import API. What it can do is hand your
tasks to an app that already owns notifications on your device.

**Export** in the footer offers two files:

| File | Format | Where it lands |
| --- | --- | --- |
| Reminders file | `VTODO` | macOS Reminders, Things, and most task apps. **iOS Reminders cannot import files.** |
| Calendar file | `VEVENT` with a 9am alarm | Calendar on any platform — **this is the one that notifies you on iPhone** |

Open the downloaded `.ics` and the receiving app takes over: the alert is then
a native one, and fires whether or not this app is running.

A task with a due time exports as a real one-hour slot at that time with the
alarm on it; a date-only task exports as an all-day entry alerting at 9am.

Completed tasks are left out. The export is a snapshot, not a live sync — re-run
it after adding tasks. Tags travel as `CATEGORIES` and priority maps to the
RFC 5545 scale (high 1, medium 5, low 9).

## Storage

Tasks are saved to `localStorage` under `todo.tasks.v1`, the theme under
`todo.theme`, a running task timer under `todo.timer.v1`, the standalone timer under
`todo.standalone.v1`, the chime preference under `todo.sound`, and focus history
under `todo.focuslog.v1` (capped at 200 sessions). Keeping them separate means
clearing your tasks never resets your theme or your history. Everything stays on
your machine — nothing is sent anywhere. If storage is unavailable (private
browsing, blocked cookies), the app still runs; it just won't persist between
reloads.

Browser storage is per-origin, so the hosted app and a local copy keep separate
task lists, and nothing syncs between devices. The page is public; the tasks
never leave the device they were typed on.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup, the pre-paint theme script, and install handling |
| `styles.css` | Styling and the light/dark color tokens |
| `app.js` | State, persistence, rendering, and event handling |
| `manifest.webmanifest` | App name, icons, and colors used when installing |
| `sw.js` | Service worker that caches the app for offline use |
| `icons/` | App icons (192, 512, maskable, and Apple touch) |
| `fonts/` | Fraunces, self-hosted so headings survive offline |

When changing `index.html`, `styles.css`, or `app.js`, bump the `CACHE` version
in `sw.js` — otherwise installed copies keep serving the old cached files.
