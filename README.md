# To-Do

A small, dependency-free to-do list that runs entirely in the browser. No build
step, no server, no `npm install` — three files and a `localStorage` key.

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
- **Inline editing** — click the ✎ button (or the pencil on any row). Enter saves,
  Escape cancels, and clearing the text removes the task.
- **Filters** — All / Active / Done, with a live "N items left" counter and a
  "Clear completed" action that appears only when something is done.
- **Due dates** — tasks show a `Today` badge on the day they're due and an
  `Overdue` badge once the date has passed while still incomplete.
- **Priority** — Low / Medium / High, shown as a colored left edge and a badge.
- **Sorting** — incomplete first, then by priority, then by soonest due date
  (undated tasks last), then by creation time.
- **Dark mode** — toggle in the header. Follows your OS preference on first visit
  and remembers your choice afterwards.
- **Keyboard and screen-reader friendly** — real form controls, labeled buttons,
  visible focus rings, and a live-updating counter.
- **Works offline** — a service worker caches the app, so an installed copy opens
  with no connection.

## Storage

Tasks are saved to `localStorage` under `todo.tasks.v1`, and the theme under
`todo.theme`, so clearing your tasks never resets your theme. Everything stays on
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

When changing `index.html`, `styles.css`, or `app.js`, bump the `CACHE` version
in `sw.js` — otherwise installed copies keep serving the old cached files.
