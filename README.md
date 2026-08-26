# To-Do

A small, dependency-free to-do list that runs entirely in the browser. No build
step, no server, no `npm install` — three files and a `localStorage` key.

## Running it

Open `index.html` in any modern browser.

Or serve it locally if you prefer a real origin:

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

## Storage

Tasks are saved to `localStorage` under `todo.tasks.v1`, and the theme under
`todo.theme`, so clearing your tasks never resets your theme. Everything stays on
your machine — nothing is sent anywhere. If storage is unavailable (private
browsing, blocked cookies), the app still runs; it just won't persist between
reloads.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup and the pre-paint theme script |
| `styles.css` | Styling and the light/dark color tokens |
| `app.js` | State, persistence, rendering, and event handling |
