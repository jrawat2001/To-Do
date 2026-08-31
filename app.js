/* A dependency-free to-do list backed by localStorage. */

(function () {
  'use strict';

  var TASKS_KEY = 'todo.tasks.v1';
  var THEME_KEY = 'todo.theme';
  var TIMER_KEY = 'todo.timer.v1';
  var LOG_KEY = 'todo.focuslog.v1';
  var STANDALONE_KEY = 'todo.standalone.v1';
  var SOUND_KEY = 'todo.sound';
  var PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  var PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

  // Keep the log bounded so storage cannot grow without limit.
  var LOG_LIMIT = 200;
  // Below this many sessions the overrun ratio is too noisy to suggest from.
  var MIN_SESSIONS_FOR_HINT = 3;

  // Tags are descriptive metadata, so they are bounded rather than free-form:
  // long or numerous tags would wreck the row layout.
  var TAG_MAX_LENGTH = 24;
  var TAGS_PER_TASK = 6;

  var els = {
    form: document.getElementById('add-form'),
    text: document.getElementById('task-text'),
    due: document.getElementById('task-due'),
    priority: document.getElementById('task-priority'),
    list: document.getElementById('task-list'),
    empty: document.getElementById('empty-state'),
    counter: document.getElementById('counter'),
    clearDone: document.getElementById('clear-done'),
    themeToggle: document.getElementById('theme-toggle'),
    filters: Array.prototype.slice.call(document.querySelectorAll('.filter')),
    estimate: document.getElementById('task-estimate'),
    estimateHint: document.getElementById('estimate-hint'),
    focusBar: document.getElementById('focus-bar'),
    focusTask: document.getElementById('focus-task'),
    focusRemaining: document.getElementById('focus-remaining'),
    focusArc: document.getElementById('focus-arc'),
    focusToggle: document.getElementById('focus-toggle'),
    focusStop: document.getElementById('focus-stop'),
    timesUp: document.getElementById('times-up'),
    timesUpTask: document.getElementById('times-up-task'),
    timesUpDetail: document.getElementById('times-up-detail'),
    timesUpDone: document.getElementById('times-up-done'),
    timesUpDismiss: document.getElementById('times-up-dismiss'),
    showStats: document.getElementById('show-stats'),
    statsDialog: document.getElementById('stats'),
    statsBody: document.getElementById('stats-body'),
    statsClose: document.getElementById('stats-close'),
    showExport: document.getElementById('show-export'),
    exportDialog: document.getElementById('export'),
    exportDetail: document.getElementById('export-detail'),
    exportOptions: document.querySelector('.export-options'),
    exportText: document.getElementById('export-text'),
    exportFallback: document.getElementById('export-fallback'),
    exportFallbackSummary: document.getElementById('export-fallback-summary'),
    exportClose: document.getElementById('export-close'),
    focusReset: document.getElementById('focus-reset'),
    timerOpen: document.getElementById('timer-open'),
    timerView: document.getElementById('timer-view'),
    timerClose: document.getElementById('timer-close'),
    timerSetup: document.getElementById('timer-setup'),
    timerLive: document.getElementById('timer-live'),
    timerHours: document.getElementById('timer-hours'),
    timerMinutes: document.getElementById('timer-minutes'),
    timerPresets: document.querySelector('.timer-presets'),
    timerDisplay: document.getElementById('timer-display'),
    timerNote: document.getElementById('timer-note'),
    timerArc: document.getElementById('timer-arc'),
    timerPrimary: document.getElementById('timer-primary'),
    timerReset: document.getElementById('timer-reset'),
    priorityDot: document.getElementById('priority-dot'),
    tagInput: document.getElementById('task-tags'),
    tagChips: document.getElementById('tag-chips'),
    time: document.getElementById('task-time'),
    editDialog: document.getElementById('edit'),
    editForm: document.getElementById('edit-form'),
    editText: document.getElementById('edit-text'),
    editDue: document.getElementById('edit-due'),
    editTime: document.getElementById('edit-time'),
    editPriority: document.getElementById('edit-priority'),
    editPriorityDot: document.getElementById('edit-priority-dot'),
    editEstimate: document.getElementById('edit-estimate'),
    editTags: document.getElementById('edit-tags'),
    editChips: document.getElementById('edit-chips'),
    editPush: document.getElementById('edit-push'),
    editCancel: document.getElementById('edit-cancel'),
    soundToggle: document.getElementById('sound-toggle')
  };

  var tasks = loadTasks();
  var log = loadLog();
  var timer = loadTimer();
  var standalone = loadStandalone();
  var filter = 'all';
  var editingId = null;
  // Tags typed into the composer but not yet attached to a task.
  var draftTags = [];
  // The same, for the edit dialog, plus the task it is open on.
  var editTags = [];
  var lastEscalation = '';
  var soundOn = loadSound();
  var audio = null;
  var ringing = [];
  var ticker = null;
  var baseTitle = document.title;

  /* Storage --------------------------------------------------------------- */

  function loadTasks() {
    var raw;
    try {
      raw = localStorage.getItem(TASKS_KEY);
    } catch (e) {
      return [];
    }
    if (!raw) return [];

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isTaskLike).map(normalizeTask);
  }

  function isTaskLike(value) {
    return value && typeof value === 'object' && typeof value.text === 'string';
  }

  function normalizeTask(task) {
    return {
      id: typeof task.id === 'string' && task.id ? task.id : createId(),
      text: task.text,
      done: task.done === true,
      dueDate: normalizeDueDate(task.dueDate),
      dueTime: normalizeDueTime(task.dueTime, task.dueDate),
      priority: PRIORITY_RANK[task.priority] === undefined ? 'medium' : task.priority,
      createdAt: typeof task.createdAt === 'number' ? task.createdAt : Date.now(),
      estimateMin: typeof task.estimateMin === 'number' && task.estimateMin > 0 ? task.estimateMin : null,
      spentSec: typeof task.spentSec === 'number' && task.spentSec > 0 ? task.spentSec : 0,
      // How much of spentSec has already been written to the log, so a task
      // toggled done twice is not counted twice.
      loggedSec: typeof task.loggedSec === 'number' && task.loggedSec > 0 ? task.loggedSec : 0,
      tags: normalizeTags(task.tags)
    };
  }

  // Stored as an ISO date string (YYYY-MM-DD) or null. Older saves used '' for
  // "unset", which normalizes to null here.
  function normalizeDueDate(value) {
    if (typeof value !== 'string') return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }

  // "HH:MM", and only meaningful alongside a date - a time with no day cannot
  // say when it has passed.
  function normalizeDueTime(value, dueDate) {
    if (typeof value !== 'string') return null;
    if (!normalizeDueDate(dueDate)) return null;
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
  }

  // Trimmed, de-duplicated case-insensitively, and capped. Order is preserved
  // so tags read back the way they were typed.
  function normalizeTags(value) {
    if (!Array.isArray(value)) return [];

    var seen = {};
    var out = [];

    for (var i = 0; i < value.length && out.length < TAGS_PER_TASK; i++) {
      if (typeof value[i] !== 'string') continue;
      var tag = value[i].trim().slice(0, TAG_MAX_LENGTH);
      if (!tag) continue;

      var key = tag.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      out.push(tag);
    }

    return out;
  }

  function saveTasks() {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    } catch (e) {
      // Storage unavailable (private mode, quota). The app still works in memory.
    }
  }

  function loadLog() {
    var raw;
    try {
      raw = localStorage.getItem(LOG_KEY);
    } catch (e) {
      return [];
    }
    if (!raw) return [];

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(function (entry) {
      return entry && typeof entry === 'object' &&
        typeof entry.estimateMin === 'number' && entry.estimateMin > 0 &&
        typeof entry.actualSec === 'number' && entry.actualSec > 0;
    });
  }

  function saveLog() {
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(log));
    } catch (e) {
      // Same tolerance as tasks: history is nice to have, not load-bearing.
    }
  }

  function loadTimer() {
    var raw;
    try {
      raw = localStorage.getItem(TIMER_KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;

    var t;
    try {
      t = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    if (!t || typeof t !== 'object') return null;
    if (typeof t.taskId !== 'string' || !t.taskId) return null;
    if (typeof t.remainingMs !== 'number' || typeof t.plannedMs !== 'number') return null;

    return {
      taskId: t.taskId,
      remainingMs: Math.max(0, t.remainingMs),
      plannedMs: Math.max(0, t.plannedMs),
      elapsedMs: typeof t.elapsedMs === 'number' && t.elapsedMs > 0 ? t.elapsedMs : 0,
      running: t.running === true,
      expired: t.expired === true,
      lastTick: typeof t.lastTick === 'number' ? t.lastTick : Date.now()
    };
  }

  function loadStandalone() {
    var raw;
    try {
      raw = localStorage.getItem(STANDALONE_KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;

    var t;
    try {
      t = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    if (!t || typeof t !== 'object') return null;
    if (typeof t.remainingMs !== 'number' || typeof t.plannedMs !== 'number') return null;
    if (t.plannedMs <= 0) return null;

    return {
      remainingMs: Math.max(0, t.remainingMs),
      plannedMs: t.plannedMs,
      running: t.running === true,
      expired: t.expired === true,
      lastTick: typeof t.lastTick === 'number' ? t.lastTick : Date.now()
    };
  }

  function saveStandalone() {
    try {
      if (standalone) localStorage.setItem(STANDALONE_KEY, JSON.stringify(standalone));
      else localStorage.removeItem(STANDALONE_KEY);
    } catch (e) {
      // Same tolerance as everything else here.
    }
  }

  function saveTimer() {
    try {
      if (timer) localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
      else localStorage.removeItem(TIMER_KEY);
    } catch (e) {
      // A timer that cannot be persisted still runs for this session.
    }
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* Mutations ------------------------------------------------------------- */

  function addTask(text, dueDate, priority, estimateMin, tags, dueTime) {
    tasks.push({
      id: createId(),
      text: text,
      done: false,
      dueDate: normalizeDueDate(dueDate),
      dueTime: normalizeDueTime(dueTime, dueDate),
      priority: priority,
      createdAt: Date.now(),
      estimateMin: estimateMin || null,
      spentSec: 0,
      loggedSec: 0,
      tags: normalizeTags(tags)
    });
    commit();
  }

  function findTask(id) {
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id) return tasks[i];
    }
    return null;
  }

  function toggleTask(id) {
    var task = findTask(id);
    if (!task) return;

    // Bank any in-flight focus time first, so the logged actual includes the
    // seconds spent right up to the moment the task was checked off.
    if (timer && timer.taskId === id) endFocusSession();

    task.done = !task.done;
    if (task.done) recordCompletion(task);
    commit();
  }

  // Writes one estimate-vs-actual row, but only for time not already logged,
  // so unchecking and rechecking a task cannot double-count it.
  function recordCompletion(task) {
    if (!task.estimateMin) return;
    if (task.spentSec <= task.loggedSec) return;

    log.push({
      text: task.text,
      priority: task.priority,
      estimateMin: task.estimateMin,
      actualSec: Math.round(task.spentSec),
      finishedAt: Date.now()
    });
    if (log.length > LOG_LIMIT) log = log.slice(log.length - LOG_LIMIT);

    task.loggedSec = task.spentSec;
    saveLog();
  }

  function editTask(id, text) {
    var task = findTask(id);
    if (!task) return;
    var trimmed = text.trim();
    if (!trimmed) {
      deleteTask(id);
      return;
    }
    task.text = trimmed;
    commit();
  }

  function deleteTask(id) {
    if (timer && timer.taskId === id) endFocusSession();
    tasks = tasks.filter(function (task) {
      return task.id !== id;
    });
    commit();
  }

  function clearCompleted() {
    tasks = tasks.filter(function (task) {
      return !task.done;
    });
    if (timer && !findTask(timer.taskId)) endFocusSession();
    commit();
  }

  function setFilter(next) {
    filter = next;
    editingId = null;
    render();
  }

  function commit() {
    saveTasks();
    lastEscalation = tasks.map(function (task) {
      return isEscalated(task) ? '1' : '0';
    }).join('');
    render();
  }

  /* Dates ----------------------------------------------------------------- */

  // Date-only string comparison keeps this free of timezone drift.
  function today() {
    var now = new Date();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    return now.getFullYear() + '-' + month + '-' + day;
  }

  /* Focus timer ------------------------------------------------------------
     The countdown runs on wall-clock time, so it keeps ticking while the tab
     is backgrounded or the app is closed. Recorded time is capped at what was
     planned, so a long absence expires the timer without inventing hours of
     "focus" that never happened. */

  function formatMinutes(min) {
    if (min < 60) return min + 'm';
    var hours = Math.floor(min / 60);
    var rest = min % 60;
    return rest ? hours + 'h ' + rest + 'm' : hours + 'h';
  }

  function formatDuration(sec) {
    if (sec < 60) return Math.round(sec) + 's';
    return formatMinutes(Math.round(sec / 60));
  }

  function formatClock(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    var mm = String(minutes).padStart(2, '0');
    var ss = String(seconds).padStart(2, '0');
    return hours > 0 ? hours + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  function startFocus(id) {
    var task = findTask(id);
    if (!task || task.done || !task.estimateMin) return;
    if (timer && timer.taskId === id) return;
    if (timer) endFocusSession();

    var ms = task.estimateMin * 60000;
    timer = {
      taskId: id,
      remainingMs: ms,
      plannedMs: ms,
      elapsedMs: 0,
      running: true,
      expired: false,
      lastTick: Date.now()
    };
    saveTimer();
    startTicker();
    render();
  }

  // Moves wall-clock progress into the timer, capped at the planned duration.
  function advanceTimer() {
    if (!timer || !timer.running) return;
    var now = Date.now();
    var delta = Math.max(0, now - timer.lastTick);
    timer.lastTick = now;

    var room = Math.max(0, timer.plannedMs - timer.elapsedMs);
    timer.elapsedMs += Math.min(delta, room);
    timer.remainingMs = Math.max(0, timer.remainingMs - delta);

    if (timer.remainingMs === 0) {
      timer.running = false;
      timer.expired = true;
    }
  }

  // Banks elapsed time onto the task and tears the session down.
  function endFocusSession() {
    if (!timer) return;
    stopChime();
    advanceTimer();

    var task = findTask(timer.taskId);
    if (task && timer.elapsedMs > 0) {
      task.spentSec += Math.round(timer.elapsedMs / 1000);
      saveTasks();
    }

    timer = null;
    saveTimer();
    stopTicker();
    closeDialog(els.timesUp);
  }

  function stopFocus() {
    endFocusSession();
    render();
  }

  // Puts the countdown back to its full planned length and throws away the
  // time counted in this session - the fix for a timer started by accident.
  function resetFocus() {
    if (!timer) return;
    stopChime();
    var task = findTask(timer.taskId);
    if (!task) return;

    var planned = task.estimateMin * 60000;
    timer.remainingMs = planned;
    timer.plannedMs = planned;
    timer.elapsedMs = 0;
    timer.expired = false;
    timer.lastTick = Date.now();

    saveTimer();
    closeDialog(els.timesUp);
    if (timer.running) startTicker();
    render();
  }

  function pauseFocus() {
    if (!timer || !timer.running) return;
    advanceTimer();
    timer.running = false;
    saveTimer();
    stopTicker();
    renderFocus();
  }

  function resumeFocus() {
    if (!timer || timer.running || timer.expired) return;
    timer.running = true;
    timer.lastTick = Date.now();
    saveTimer();
    startTicker();
    renderFocus();
  }

  function extendFocus(minutes) {
    if (!timer) return;
    stopChime();
    var ms = minutes * 60000;
    timer.remainingMs += ms;
    timer.plannedMs += ms;
    timer.expired = false;
    timer.running = true;
    timer.lastTick = Date.now();
    saveTimer();
    closeDialog(els.timesUp);
    startTicker();
    render();
  }

  // "Done" from the prompt: bank the time, check the task off, log the result.
  function finishFocus() {
    if (!timer) return;
    var id = timer.taskId;
    closeDialog(els.timesUp);
    var task = findTask(id);
    if (task && task.done) {
      stopFocus();
      return;
    }
    toggleTask(id);
  }

  function anythingRunning() {
    return Boolean((timer && timer.running) || (standalone && standalone.running));
  }

  function startTicker() {
    stopTicker();
    if (anythingRunning()) ticker = setInterval(onTick, 250);
  }

  function stopTicker() {
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  // A single interval advances whichever timers are running, so the two never
  // drift apart and there is only ever one wake-up in flight.
  function onTick() {
    var focusJustExpired = false;
    var standaloneJustExpired = false;

    if (timer && timer.running) {
      advanceTimer();
      saveTimer();
      renderFocus();
      if (timer.expired) focusJustExpired = true;
    }

    if (standalone && standalone.running) {
      advanceStandalone();
      saveStandalone();
      renderStandalone();
      if (standalone.expired) standaloneJustExpired = true;
    }

    updateTitle();
    if (!anythingRunning()) stopTicker();

    if (standaloneJustExpired) {
      playChime();
      openTimerView();
    }
    if (focusJustExpired) openTimesUp();
  }

  /* Standalone timer -------------------------------------------------------
     Independent of any task: set a duration, run it full-screen. It shares the
     ticker and the same wall-clock rules as the focus timer. */

  function advanceStandalone() {
    if (!standalone || !standalone.running) return;
    var now = Date.now();
    var delta = Math.max(0, now - standalone.lastTick);
    standalone.lastTick = now;
    standalone.remainingMs = Math.max(0, standalone.remainingMs - delta);
    if (standalone.remainingMs === 0) {
      standalone.running = false;
      standalone.expired = true;
    }
  }

  function readTimerFields() {
    var hours = Math.min(23, Math.max(0, Math.floor(Number(els.timerHours.value) || 0)));
    var minutes = Math.min(59, Math.max(0, Math.floor(Number(els.timerMinutes.value) || 0)));
    return (hours * 3600 + minutes * 60) * 1000;
  }

  function startStandalone() {
    var ms = readTimerFields();
    if (ms <= 0) return;
    standalone = {
      remainingMs: ms,
      plannedMs: ms,
      running: true,
      expired: false,
      lastTick: Date.now()
    };
    saveStandalone();
    startTicker();
    renderStandalone();
    updateTitle();
  }

  function pauseStandalone() {
    if (!standalone || !standalone.running) return;
    stopChime();
    advanceStandalone();
    standalone.running = false;
    saveStandalone();
    if (!anythingRunning()) stopTicker();
    renderStandalone();
    updateTitle();
  }

  function resumeStandalone() {
    if (!standalone || standalone.running || standalone.expired) return;
    standalone.running = true;
    standalone.lastTick = Date.now();
    saveStandalone();
    startTicker();
    renderStandalone();
    updateTitle();
  }

  // Clears the timer entirely and returns to the duration picker.
  function resetStandalone() {
    stopChime();
    if (standalone) {
      var minutes = Math.round(standalone.plannedMs / 60000);
      els.timerHours.value = String(Math.floor(minutes / 60));
      els.timerMinutes.value = String(minutes % 60);
    }
    standalone = null;
    saveStandalone();
    if (!anythingRunning()) stopTicker();
    renderStandalone();
    updateTitle();
  }

  function openTimerView() {
    renderStandalone();
    openDialog(els.timerView);
  }

  function renderStandalone() {
    var live = Boolean(standalone);
    els.timerLive.hidden = !live;
    els.timerSetup.hidden = live;
    els.timerReset.hidden = !live;

    // The header button carries a dot so a running timer is visible from the list.
    els.timerOpen.dataset.state = !standalone ? 'idle'
      : (standalone.expired ? 'expired' : (standalone.running ? 'running' : 'paused'));

    if (!standalone) {
      els.timerView.dataset.state = 'setup';
      els.timerPrimary.textContent = 'Start';
      els.timerPrimary.disabled = readTimerFields() <= 0;
      return;
    }

    els.timerView.dataset.state = standalone.expired ? 'expired'
      : (standalone.running ? 'running' : 'paused');

    var clock = formatClock(standalone.remainingMs);
    if (els.timerDisplay.textContent !== clock) els.timerDisplay.textContent = clock;

    els.timerNote.textContent = standalone.expired ? 'Time’s up'
      : (standalone.running ? '' : 'Paused');

    els.timerPrimary.disabled = false;
    els.timerPrimary.textContent = standalone.expired ? 'Done'
      : (standalone.running ? 'Pause' : 'Resume');

    var circumference = 2 * Math.PI * 112;
    var fraction = standalone.plannedMs > 0 ? standalone.remainingMs / standalone.plannedMs : 0;
    els.timerArc.setAttribute('stroke-dasharray', circumference.toFixed(2));
    els.timerArc.setAttribute('stroke-dashoffset', (circumference * (1 - fraction)).toFixed(2));
  }

  // One place decides what the tab says, so the two timers cannot fight over it.
  function updateTitle() {
    if (standalone && standalone.running) {
      document.title = formatClock(standalone.remainingMs) + ' · Timer';
      return;
    }
    if (standalone && standalone.expired) {
      document.title = 'Time’s up · Timer';
      return;
    }
    if (timer && timer.running) {
      var task = findTask(timer.taskId);
      document.title = formatClock(timer.remainingMs) + (task ? ' · ' + task.text : '');
      return;
    }
    document.title = baseTitle;
  }

  function renderFocus() {
    if (!timer) {
      els.focusBar.hidden = true;
      updateTitle();
      return;
    }

    var task = findTask(timer.taskId);
    if (!task) {
      els.focusBar.hidden = true;
      return;
    }

    els.focusBar.hidden = false;
    els.focusBar.dataset.state = timer.expired ? 'expired' : (timer.running ? 'running' : 'paused');

    if (els.focusTask.textContent !== task.text) els.focusTask.textContent = task.text;

    var clock = formatClock(timer.remainingMs);
    if (els.focusRemaining.textContent !== clock) els.focusRemaining.textContent = clock;

    els.focusToggle.textContent = timer.running ? 'Pause' : 'Resume';
    els.focusToggle.hidden = timer.expired;

    var circumference = 2 * Math.PI * 19;
    var fraction = timer.plannedMs > 0 ? timer.remainingMs / timer.plannedMs : 0;
    els.focusArc.setAttribute('stroke-dasharray', circumference.toFixed(2));
    els.focusArc.setAttribute('stroke-dashoffset', (circumference * (1 - fraction)).toFixed(2));

    updateTitle();
  }

  function openTimesUp() {
    if (!timer) return;
    var task = findTask(timer.taskId);
    if (!task) return;

    els.timesUpTask.textContent = task.text;
    var planned = Math.round(timer.plannedMs / 60000);
    var spent = task.spentSec + Math.round(timer.elapsedMs / 1000);
    els.timesUpDetail.textContent = planned > task.estimateMin
      ? 'Estimated ' + formatMinutes(task.estimateMin) + ', now ' + formatDuration(spent) + ' in.'
      : formatMinutes(task.estimateMin) + ' up.';

    renderFocus();
    playChime();
    openDialog(els.timesUp);
  }

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function') {
      if (dialog.open) dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  /* Composer -------------------------------------------------------------- */

  function updatePriorityDot() {
    els.priorityDot.dataset.priority = els.priority.value;
  }

  // Reuses normalizeTags so the draft obeys exactly the same rules as storage:
  // if the list does not grow, the tag was empty, a duplicate, or over the cap.
  function addDraftTag(raw) {
    var next = normalizeTags(draftTags.concat([raw]));
    var added = next.length > draftTags.length;
    draftTags = next;
    renderDraftTags();
    return added;
  }

  function removeDraftTag(index) {
    draftTags.splice(index, 1);
    renderDraftTags();
    els.tagInput.focus();
  }

  function clearDraftTags() {
    draftTags = [];
    els.tagInput.value = '';
    renderDraftTags();
  }

  function renderDraftTags() {
    renderChips(els.tagChips, draftTags, removeDraftTag);

    var full = draftTags.length >= TAGS_PER_TASK;
    els.tagInput.disabled = full;
    els.tagInput.placeholder = full ? 'Tag limit reached' : 'Add a tag\u2026';
  }

  /* Chime ------------------------------------------------------------------
     Synthesised rather than shipped: a few sine partials cost no bytes, work
     offline, and can be tuned. A struck-bowl shape - soft attack, long decay,
     a quiet octave above for shimmer - rings three times and stops itself.

     Browsers refuse audio until the page has been interacted with, so the
     context is opened on the first gesture and kept warm; a timer that expires
     on a page nobody has touched simply stays silent. */

  var CHIME_NOTES = [440, 587.33, 739.99];   // A4, D5, F#5 - a calm rising triad
  var CHIME_REPEATS = 3;
  var CHIME_NOTE_GAP = 0.28;
  var CHIME_DECAY = 1.8;
  var CHIME_CYCLE = 2.2;

  function loadSound() {
    try {
      return localStorage.getItem(SOUND_KEY) !== 'off';
    } catch (e) {
      return true;
    }
  }

  function saveSound() {
    try {
      localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off');
    } catch (e) {
      // A preference that cannot persist still holds for this session.
    }
  }

  function ensureAudio() {
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;

    if (!audio) {
      try {
        audio = new Ctor();
      } catch (e) {
        return null;
      }
    }
    // Autoplay policy parks the context until a gesture unlocks it.
    if (audio.state === 'suspended' && audio.resume) audio.resume();
    return audio;
  }

  function stopChime() {
    if (!audio) return;
    var now = audio.currentTime;
    ringing.forEach(function (voice) {
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value || 0.0001, now);
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
        voice.osc.stop(now + 0.1);
      } catch (e) {
        // Already finished; nothing to silence.
      }
    });
    ringing = [];
  }

  function scheduleVoice(ctx, dest, freq, at, peak) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();

    osc.type = 'sine';
    // Set outright rather than scheduled: each oscillator plays one note and is
    // then discarded, so there is nothing to automate.
    osc.frequency.value = freq;

    // Exponential ramps cannot touch zero, hence the near-silent floor.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + CHIME_DECAY);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(at);
    osc.stop(at + CHIME_DECAY + 0.05);

    ringing.push({ osc: osc, gain: gain });
  }

  function playChime(repeats) {
    if (!soundOn) return;
    var ctx = ensureAudio();
    if (!ctx) return;

    stopChime();

    // A gentle lowpass keeps the partials from getting glassy.
    var master = ctx.createGain();
    master.gain.value = 0.55;
    var tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    master.connect(tone);
    tone.connect(ctx.destination);

    var start = ctx.currentTime + 0.05;
    var cycles = repeats === undefined ? CHIME_REPEATS : repeats;

    for (var cycle = 0; cycle < cycles; cycle++) {
      for (var i = 0; i < CHIME_NOTES.length; i++) {
        var at = start + cycle * CHIME_CYCLE + i * CHIME_NOTE_GAP;
        scheduleVoice(ctx, master, CHIME_NOTES[i], at, 0.5);
        // A quiet octave above gives the strike its bell colour.
        scheduleVoice(ctx, master, CHIME_NOTES[i] * 2, at, 0.12);
      }
    }
  }

  function renderSoundToggle() {
    els.soundToggle.setAttribute('aria-pressed', String(soundOn));
    els.soundToggle.dataset.state = soundOn ? 'on' : 'off';
  }

  /* Estimate learning ------------------------------------------------------
     One number drawn from history: how much longer things actually take than
     you think. Below a few sessions it stays quiet rather than guessing. */

  function estimateMultiplier() {
    if (log.length < MIN_SESSIONS_FOR_HINT) return null;
    var estimated = 0;
    var actual = 0;
    log.forEach(function (entry) {
      estimated += entry.estimateMin * 60;
      actual += entry.actualSec;
    });
    if (estimated <= 0) return null;
    return actual / estimated;
  }

  function renderEstimateHint() {
    var multiplier = estimateMultiplier();
    var chosen = Number(els.estimate.value);

    els.estimateHint.textContent = '';
    if (!multiplier || !chosen || Math.abs(multiplier - 1) < 0.1) {
      els.estimateHint.hidden = true;
      return;
    }

    // Round to the nearest 5 minutes so suggestions stay human.
    var suggested = Math.max(5, Math.round((chosen * multiplier) / 5) * 5);
    if (suggested === chosen) {
      els.estimateHint.hidden = true;
      return;
    }

    var verb = multiplier > 1 ? 'over' : 'under';
    var label = document.createElement('span');
    label.textContent = 'Your ' + log.length + ' logged sessions run ' +
      multiplier.toFixed(1) + '× ' + verb + ' estimate. ';
    els.estimateHint.appendChild(label);

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'hint-button';
    button.textContent = 'Use ' + formatMinutes(suggested) + ' instead';
    button.addEventListener('click', function () {
      applyEstimate(suggested);
    });
    els.estimateHint.appendChild(button);

    els.estimateHint.hidden = false;
  }

  function applyEstimate(minutes) {
    var value = String(minutes);
    var exists = Array.prototype.some.call(els.estimate.options, function (option) {
      return option.value === value;
    });
    if (!exists) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = formatMinutes(minutes);
      els.estimate.appendChild(option);
    }
    els.estimate.value = value;
    renderEstimateHint();
  }

  /* iCalendar export -------------------------------------------------------
     The app has no server, so it cannot push anything anywhere. What it can do
     is hand your tasks to an app that already owns reminders on your device,
     in the one interchange format those apps agree on.

     Two shapes, because no single one works everywhere: VTODO is what a task
     really is and is what Reminders on macOS imports, but iOS Calendar - the
     only thing an iPhone will open an .ics with - understands VEVENT alone. */

  function icsEscape(text) {
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  function utf8Length(codePoint) {
    if (codePoint < 0x80) return 1;
    if (codePoint < 0x800) return 2;
    if (codePoint < 0x10000) return 3;
    return 4;
  }

  // RFC 5545 caps a content line at 75 octets; longer lines continue on the
  // next line prefixed with a space. Folding on octets, not characters, so a
  // multi-byte character is never split down the middle.
  function icsFold(line) {
    var chars = Array.from(line);
    var out = '';
    var used = 0;
    var limit = 74;

    for (var i = 0; i < chars.length; i++) {
      var size = utf8Length(chars[i].codePointAt(0));
      if (used + size > limit) {
        out += '\r\n ';
        used = 1;
        limit = 74;
      }
      out += chars[i];
      used += size;
    }

    return out;
  }

  function icsStamp(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  function icsDate(iso) {
    return iso.replace(/-/g, '');
  }

  function icsDayAfter(iso) {
    var parts = iso.split('-');
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    date.setDate(date.getDate() + 1);
    return icsDate(
      date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0'));
  }

  // The task's own time when it has one, otherwise 9am local on the due date.
  // Written in UTC so it lands at the same real moment wherever it is imported.
  function icsAlarmStamp(task) {
    var at = taskDueAt(task);
    if (at !== null) return icsStamp(new Date(at));
    var parts = task.dueDate.split('-');
    return icsStamp(new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 9, 0, 0));
  }

  var ICS_PRIORITY = { high: 1, medium: 5, low: 9 };

  function exportableTasks(format) {
    return tasks.filter(function (task) {
      if (task.done) return false;
      // An event has to happen on a day; a to-do does not.
      return format === 'calendar' ? Boolean(task.dueDate) : true;
    });
  }

  function buildIcs(format) {
    var stamp = icsStamp(new Date());
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//To-Do//Export//EN',
      'CALSCALE:GREGORIAN'
    ];

    exportableTasks(format).forEach(function (task) {
      var uid = task.id + '@to-do.local';
      var alarm = task.dueDate ? [
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'TRIGGER;VALUE=DATE-TIME:' + icsAlarmStamp(task),
        'DESCRIPTION:' + icsEscape(task.text),
        'END:VALARM'
      ] : [];

      // A task with a time is a moment, not a day: give it a real one-hour
      // slot so the calendar shows it where it belongs.
      var at = taskDueAt(task);

      if (format === 'calendar') {
        lines.push(
          'BEGIN:VEVENT',
          'UID:' + uid,
          'DTSTAMP:' + stamp,
          'SUMMARY:' + icsEscape(task.text));
        if (at !== null) {
          lines.push(
            'DTSTART:' + icsStamp(new Date(at)),
            'DTEND:' + icsStamp(new Date(at + 3600000)));
        } else {
          lines.push(
            'DTSTART;VALUE=DATE:' + icsDate(task.dueDate),
            'DTEND;VALUE=DATE:' + icsDayAfter(task.dueDate));
        }
        if (task.tags.length) lines.push('CATEGORIES:' + task.tags.map(icsEscape).join(','));
        lines.push.apply(lines, alarm);
        lines.push('END:VEVENT');
        return;
      }

      lines.push(
        'BEGIN:VTODO',
        'UID:' + uid,
        'DTSTAMP:' + stamp,
        'SUMMARY:' + icsEscape(task.text),
        'STATUS:NEEDS-ACTION',
        'PRIORITY:' + ICS_PRIORITY[task.priority]);
      if (at !== null) lines.push('DUE:' + icsStamp(new Date(at)));
      else if (task.dueDate) lines.push('DUE;VALUE=DATE:' + icsDate(task.dueDate));
      if (task.tags.length) lines.push('CATEGORIES:' + task.tags.map(icsEscape).join(','));
      lines.push.apply(lines, alarm);
      lines.push('END:VTODO');
    });

    lines.push('END:VCALENDAR');

    return lines.map(icsFold).join('\r\n') + '\r\n';
  }

  // Embedded viewers sandbox the page and drop downloads it starts, without
  // raising anything catchable - the click simply does nothing. Being framed
  // is the signal available up front, so use it rather than shipping a button
  // that dies silently.
  function downloadsBlocked() {
    try {
      return window.self !== window.top;
    } catch (e) {
      // Cross-origin parent: framed, and more restricted still.
      return true;
    }
  }

  function downloadIcs(format) {
    var text = buildIcs(format);
    els.exportText.value = text;

    var name = format === 'calendar' ? 'to-do-calendar.ics' : 'to-do-reminders.ics';

    if (downloadsBlocked()) {
      els.exportFallbackSummary.textContent =
        'This preview blocks downloads \u2014 copy the text below into ' + name;
      els.exportFallback.open = true;
      els.exportText.focus();
      els.exportText.select();
      return;
    }

    var blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function renderExport() {
    var todos = exportableTasks('reminders').length;
    var events = exportableTasks('calendar').length;

    els.exportDetail.textContent = todos === 0
      ? 'Nothing to export yet - every task is done.'
      : todos + ' open task' + (todos === 1 ? '' : 's') + ', ' +
        events + ' with a due date. Completed tasks are left out.';

    els.exportOptions.querySelector('[data-format="calendar"]').disabled = events === 0;
    els.exportText.value = buildIcs('calendar');
  }

  /* Stats ------------------------------------------------------------------ */

  function renderStats() {
    els.statsBody.textContent = '';
    if (!log.length) return;

    var multiplier = estimateMultiplier();
    var totalEstimated = 0;
    var totalActual = 0;
    var buckets = {};

    log.forEach(function (entry) {
      totalEstimated += entry.estimateMin * 60;
      totalActual += entry.actualSec;
      var bucket = buckets[entry.priority] || (buckets[entry.priority] = { n: 0, est: 0, act: 0 });
      bucket.n += 1;
      bucket.est += entry.estimateMin * 60;
      bucket.act += entry.actualSec;
    });

    var summary = document.createElement('p');
    summary.className = 'stats-lede';
    var ratio = totalEstimated > 0 ? totalActual / totalEstimated : 1;
    summary.textContent = log.length + ' session' + (log.length === 1 ? '' : 's') + ' logged. ' +
      (Math.abs(ratio - 1) < 0.05
        ? 'Your estimates are about right.'
        : 'You run ' + ratio.toFixed(1) + '× your estimates on average.');
    els.statsBody.appendChild(summary);

    // Which kinds of task consistently run over.
    var order = ['high', 'medium', 'low'].filter(function (key) { return buckets[key]; });
    if (order.length) {
      var table = document.createElement('table');
      table.className = 'stats-table';

      var head = document.createElement('tr');
      ['Priority', 'Sessions', 'Estimated', 'Actual', 'Ratio'].forEach(function (label) {
        var th = document.createElement('th');
        th.textContent = label;
        head.appendChild(th);
      });
      table.appendChild(head);

      order.forEach(function (key) {
        var bucket = buckets[key];
        var bucketRatio = bucket.est > 0 ? bucket.act / bucket.est : 1;
        var row = document.createElement('tr');
        if (bucketRatio > 1.15) row.className = 'is-overrun';

        [
          PRIORITY_LABEL[key],
          String(bucket.n),
          formatDuration(bucket.est),
          formatDuration(bucket.act),
          bucketRatio.toFixed(1) + '×'
        ].forEach(function (value) {
          var cell = document.createElement('td');
          cell.textContent = value;
          row.appendChild(cell);
        });
        table.appendChild(row);
      });

      els.statsBody.appendChild(table);
    }

    var recentTitle = document.createElement('h3');
    recentTitle.className = 'stats-subtitle';
    recentTitle.textContent = 'Recent sessions';
    els.statsBody.appendChild(recentTitle);

    var list = document.createElement('ul');
    list.className = 'stats-list';
    log.slice(-5).reverse().forEach(function (entry) {
      var item = document.createElement('li');

      var name = document.createElement('span');
      name.className = 'stats-name';
      name.textContent = entry.text;
      item.appendChild(name);

      var value = document.createElement('span');
      value.className = 'stats-value';
      var entryRatio = entry.actualSec / (entry.estimateMin * 60);
      if (entryRatio > 1.15) value.classList.add('is-overrun');
      value.textContent = formatDuration(entry.actualSec) + ' of ' + formatMinutes(entry.estimateMin);
      item.appendChild(value);

      list.appendChild(item);
    });
    els.statsBody.appendChild(list);

    if (multiplier) {
      var footnote = document.createElement('p');
      footnote.className = 'stats-footnote';
      footnote.textContent = 'New estimates are compared against this history.';
      els.statsBody.appendChild(footnote);
    }
  }

  // "Sep 3" - deliberately year-less; the pill is a glance, not a record.
  function formatShortDate(value) {
    var parts = value.split('-');
    if (parts.length !== 3) return value;
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /* Escalation ------------------------------------------------------------
     A task given a time is a commitment to a moment, not just a day. Once that
     moment passes the task behaves as high priority - it sorts to the top and
     the row is marked - without overwriting the priority the user chose, so
     pushing the time back restores exactly what was there before. */

  function taskDueAt(task) {
    if (!task.dueDate || !task.dueTime) return null;
    var d = task.dueDate.split('-');
    var t = task.dueTime.split(':');
    return new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2]),
      Number(t[0]), Number(t[1]), 0, 0).getTime();
  }

  function isEscalated(task) {
    if (task.done) return false;
    var at = taskDueAt(task);
    return at !== null && Date.now() >= at;
  }

  // The priority the app acts on, which may outrank the one that was set.
  function effectivePriority(task) {
    return isEscalated(task) ? 'high' : task.priority;
  }

  // Moves a task's due moment forward, carrying the date over midnight.
  function pushTask(id, minutes) {
    var task = findTask(id);
    if (!task) return;
    var at = taskDueAt(task);
    // Push from now when the moment has already gone by, so "+15m" means
    // fifteen minutes from now rather than fifteen past a time long dead.
    var base = at === null || at < Date.now() ? Date.now() : at;
    var next = new Date(base + minutes * 60000);

    task.dueDate = next.getFullYear() + '-' +
      String(next.getMonth() + 1).padStart(2, '0') + '-' +
      String(next.getDate()).padStart(2, '0');
    task.dueTime = String(next.getHours()).padStart(2, '0') + ':' +
      String(next.getMinutes()).padStart(2, '0');

    commit();
  }

  function formatClockTime(time) {
    var parts = time.split(':');
    var date = new Date(2000, 0, 1, Number(parts[0]), Number(parts[1]));
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  // A completed task is never "overdue" - finishing it late is not a warning.
  function dueTone(task) {
    var now = today();
    if (task.dueDate === now) return 'today';
    if (task.dueDate < now && !task.done) return 'overdue';
    return 'future';
  }

  /* Selection & sorting --------------------------------------------------- */

  function visibleTasks() {
    var selected = tasks.filter(function (task) {
      if (filter === 'active') return !task.done;
      if (filter === 'done') return task.done;
      return true;
    });

    return selected.sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;

      var rank = PRIORITY_RANK[effectivePriority(a)] - PRIORITY_RANK[effectivePriority(b)];
      if (rank !== 0) return rank;

      // Undated tasks sort after dated ones.
      if (a.dueDate !== b.dueDate) {
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate < b.dueDate ? -1 : 1;
      }

      return a.createdAt - b.createdAt;
    });
  }

  /* Rendering ------------------------------------------------------------- */

  function render() {
    var visible = visibleTasks();

    els.list.textContent = '';
    visible.forEach(function (task) {
      els.list.appendChild(renderTask(task));
    });

    els.empty.hidden = visible.length > 0;
    els.empty.textContent = emptyMessage();

    var remaining = tasks.filter(function (task) {
      return !task.done;
    }).length;
    els.counter.textContent = remaining + (remaining === 1 ? ' item left' : ' items left');

    els.clearDone.hidden = remaining === tasks.length;
    els.showStats.hidden = log.length === 0;
    els.showExport.hidden = tasks.length === 0;

    renderFocus();
    renderEstimateHint();

    var counts = {
      all: tasks.length,
      active: remaining,
      done: tasks.length - remaining
    };

    els.filters.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
      var count = button.querySelector('.filter-count');
      if (count) count.textContent = '(' + counts[button.dataset.filter] + ')';
    });

  }

  function emptyMessage() {
    if (tasks.length === 0) return 'Nothing here yet — add your first task above.';
    if (filter === 'active') return 'No active tasks. Everything is done.';
    if (filter === 'done') return 'No completed tasks yet.';
    return 'Nothing to show.';
  }

  function renderTask(task) {
    var item = document.createElement('li');
    item.className = 'task' + (task.done ? ' is-done' : '') +
      (timer && timer.taskId === task.id ? ' is-focused' : '') +
      (isEscalated(task) ? ' is-escalated' : '');
    item.dataset.id = task.id;
    // The border follows the priority the app is acting on, not the stored one.
    item.dataset.priority = effectivePriority(task);

    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-checkbox';
    checkbox.checked = task.done;
    checkbox.dataset.action = 'toggle';
    checkbox.setAttribute('aria-label', (task.done ? 'Mark as not done: ' : 'Mark as done: ') + task.text);
    item.appendChild(checkbox);

    var body = document.createElement('div');
    body.className = 'task-body';

    var text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = task.text;
    body.appendChild(text);

    var meta = renderMeta(task);
    if (meta) body.appendChild(meta);

    if (task.tags.length) body.appendChild(renderTags(task));

    item.appendChild(body);
    item.appendChild(renderActions(task));
    return item;
  }

  function renderMeta(task) {
    var meta = document.createElement('div');
    meta.className = 'task-meta';

    var priority = document.createElement('span');
    priority.className = 'badge badge-priority';
    var shown = effectivePriority(task);
    priority.dataset.priority = shown;
    priority.textContent = PRIORITY_LABEL[shown];
    meta.appendChild(priority);

    if (task.estimateMin) {
      var estimate = document.createElement('span');
      estimate.className = 'badge badge-estimate';
      if (task.spentSec > 0) {
        estimate.textContent = formatDuration(task.spentSec) + ' of ' + formatMinutes(task.estimateMin);
        if (task.spentSec > task.estimateMin * 60) estimate.classList.add('is-overrun');
      } else {
        estimate.textContent = formatMinutes(task.estimateMin);
      }
      meta.appendChild(estimate);
    }

    if (task.dueDate) {
      var tone = isEscalated(task) ? 'overdue' : dueTone(task);
      var label = tone === 'today' || (isEscalated(task) && task.dueDate === today())
        ? 'Today' : formatShortDate(task.dueDate);
      if (task.dueTime) label += ' \u00b7 ' + formatClockTime(task.dueTime);
      meta.appendChild(makeBadge('badge-due badge-' + tone, label));
    }

    return meta;
  }

  // Descriptive only: tags carry no weight in sorting or filtering.
  function renderTags(task) {
    var list = document.createElement('ul');
    list.className = 'task-tags';

    task.tags.forEach(function (tag) {
      var item = document.createElement('li');
      item.className = 'task-tag';
      item.textContent = tag;
      list.appendChild(item);
    });

    return list;
  }

  function makeBadge(className, label) {
    var badge = document.createElement('span');
    badge.className = 'badge ' + className;
    badge.textContent = label;
    return badge;
  }

  /* Edit dialog ------------------------------------------------------------
     Every field a task has, in one place. The row used to offer an inline
     rename only, which left estimate, priority, dates and tags unreachable
     after creation. */

  function openEdit(id) {
    var task = findTask(id);
    if (!task) return;

    editingId = id;
    els.editText.value = task.text;
    els.editDue.value = task.dueDate || '';
    els.editTime.value = task.dueTime || '';
    els.editPriority.value = task.priority;
    els.editEstimate.value = task.estimateMin ? String(task.estimateMin) : '';
    editTags = task.tags.slice();

    renderEditDialog();
    openDialog(els.editDialog);
    els.editText.focus();
    els.editText.select();
  }

  function renderEditDialog() {
    els.editPriorityDot.dataset.priority = els.editPriority.value;
    // Pushing is only meaningful once there is a moment to push.
    els.editPush.hidden = !(els.editDue.value && els.editTime.value);
    renderChips(els.editChips, editTags, removeEditTag);

    var full = editTags.length >= TAGS_PER_TASK;
    els.editTags.disabled = full;
    els.editTags.placeholder = full ? 'Tag limit reached' : 'Add a tag\u2026';
  }

  function addEditTag(raw) {
    var next = normalizeTags(editTags.concat([raw]));
    var added = next.length > editTags.length;
    editTags = next;
    renderEditDialog();
    return added;
  }

  function removeEditTag(index) {
    editTags.splice(index, 1);
    renderEditDialog();
    els.editTags.focus();
  }

  function saveEdit() {
    var task = findTask(editingId);
    if (!task) return;

    var text = els.editText.value.trim();
    // An emptied title still means "remove this", as it did inline.
    if (!text) {
      closeDialog(els.editDialog);
      editingId = null;
      deleteTask(task.id);
      return;
    }

    task.text = text;
    task.dueDate = normalizeDueDate(els.editDue.value);
    task.dueTime = normalizeDueTime(els.editTime.value, els.editDue.value);
    task.priority = PRIORITY_RANK[els.editPriority.value] === undefined
      ? task.priority : els.editPriority.value;
    task.estimateMin = Number(els.editEstimate.value) || null;
    task.tags = normalizeTags(editTags);

    // A dropped estimate cannot leave a countdown running against nothing.
    if (!task.estimateMin && timer && timer.taskId === task.id) endFocusSession();

    closeDialog(els.editDialog);
    editingId = null;
    commit();
  }

  // Pushes from the dialog's own fields, so it composes with unsaved edits.
  function pushEditTime(minutes) {
    if (!els.editDue.value || !els.editTime.value) return;

    var d = els.editDue.value.split('-');
    var t = els.editTime.value.split(':');
    var at = new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2]),
      Number(t[0]), Number(t[1])).getTime();
    var base = at < Date.now() ? Date.now() : at;
    var next = new Date(base + minutes * 60000);

    els.editDue.value = next.getFullYear() + '-' +
      String(next.getMonth() + 1).padStart(2, '0') + '-' +
      String(next.getDate()).padStart(2, '0');
    els.editTime.value = String(next.getHours()).padStart(2, '0') + ':' +
      String(next.getMinutes()).padStart(2, '0');

    renderEditDialog();
  }

  // Shared by the composer and the edit dialog.
  function renderChips(container, list, onRemove) {
    container.textContent = '';
    container.hidden = list.length === 0;

    list.forEach(function (tag, index) {
      var item = document.createElement('li');
      item.className = 'tag-chip';

      var label = document.createElement('span');
      label.textContent = tag;
      item.appendChild(label);

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'tag-chip-remove';
      remove.textContent = '\u00d7';
      remove.setAttribute('aria-label', 'Remove tag ' + tag);
      remove.addEventListener('click', function () {
        onRemove(index);
      });
      item.appendChild(remove);

      container.appendChild(item);
    });
  }

  function renderActions(task) {
    var actions = document.createElement('div');
    actions.className = 'task-actions';

    var isFocused = timer && timer.taskId === task.id;
    if (!task.done && task.estimateMin && !isFocused) {
      var focus = document.createElement('button');
      focus.type = 'button';
      focus.className = 'task-action focus';
      focus.dataset.action = 'focus';
      focus.textContent = '▶';
      focus.setAttribute('aria-label', 'Start ' + formatMinutes(task.estimateMin) + ' focus timer: ' + task.text);
      actions.appendChild(focus);
    }

    if (isEscalated(task)) {
      var push = document.createElement('button');
      push.type = 'button';
      push.className = 'task-action task-action-wide';
      push.dataset.action = 'push';
      push.textContent = '+15m';
      push.setAttribute('aria-label', 'Push back 15 minutes: ' + task.text);
      actions.appendChild(push);
    }

    var edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'task-action';
    edit.dataset.action = 'edit';
    edit.textContent = '✎';
    edit.setAttribute('aria-label', 'Edit task: ' + task.text);
    actions.appendChild(edit);

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'task-action delete';
    remove.dataset.action = 'delete';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', 'Delete task: ' + task.text);
    actions.appendChild(remove);

    return actions;
  }

  /* Events ---------------------------------------------------------------- */

  els.form.addEventListener('submit', function (event) {
    event.preventDefault();
    var text = els.text.value.trim();
    if (!text) return;

    // A tag typed but not committed with Enter would otherwise be dropped.
    addDraftTag(els.tagInput.value);

    addTask(text, els.due.value, els.priority.value,
      Number(els.estimate.value) || null, draftTags, els.time.value);

    els.form.reset();
    els.priority.value = 'medium';
    els.estimate.value = '';
    els.time.value = '';
    clearDraftTags();
    updatePriorityDot();
    els.text.focus();
  });

  // Delegated so rendering never has to rebind per-task listeners.
  els.list.addEventListener('click', function (event) {
    var control = event.target.closest('[data-action]');

    // Tapping the task itself starts its timer, as long as there is an
    // estimate to count down and the click was not the end of a text selection.
    if (!control) {
      var textNode = event.target.closest('.task-text');
      if (!textNode) return;
      var selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      var row = textNode.closest('.task');
      if (!row) return;
      var candidate = findTask(row.dataset.id);
      if (candidate && !candidate.done && candidate.estimateMin) startFocus(candidate.id);
      return;
    }

    var item = control.closest('.task');
    if (!item) return;
    var id = item.dataset.id;

    if (control.dataset.action === 'focus') {
      startFocus(id);
    } else if (control.dataset.action === 'toggle') {
      toggleTask(id);
    } else if (control.dataset.action === 'edit') {
      openEdit(id);
    } else if (control.dataset.action === 'push') {
      pushTask(id, 15);
    } else if (control.dataset.action === 'delete') {
      if (editingId === id) editingId = null;
      deleteTask(id);
    }
  });

  els.filters.forEach(function (button) {
    button.addEventListener('click', function () {
      setFilter(button.dataset.filter);
    });
  });

  els.clearDone.addEventListener('click', clearCompleted);

  els.focusToggle.addEventListener('click', function () {
    if (!timer) return;
    if (timer.running) pauseFocus();
    else resumeFocus();
  });

  els.focusReset.addEventListener('click', resetFocus);
  els.focusStop.addEventListener('click', stopFocus);

  els.soundToggle.addEventListener('click', function () {
    soundOn = !soundOn;
    saveSound();
    renderSoundToggle();
    // Turning it on plays once, so the choice is audible rather than abstract.
    if (soundOn) playChime(1);
    else stopChime();
  });

  // The first gesture anywhere unlocks audio, so a timer expiring later can
  // actually sound. Once is enough.
  ['pointerdown', 'keydown'].forEach(function (type) {
    window.addEventListener(type, function primeAudio() {
      window.removeEventListener(type, primeAudio);
      if (soundOn) ensureAudio();
    }, { once: false });
  });

  els.timerOpen.addEventListener('click', openTimerView);
  els.timerClose.addEventListener('click', function () {
    // Closing the view never cancels the timer; it keeps running behind it.
    closeDialog(els.timerView);
  });

  els.timerPrimary.addEventListener('click', function () {
    if (!standalone) startStandalone();
    else if (standalone.expired) resetStandalone();
    else if (standalone.running) pauseStandalone();
    else resumeStandalone();
  });

  els.timerReset.addEventListener('click', resetStandalone);

  els.timerPresets.addEventListener('click', function (event) {
    var preset = event.target.closest('[data-preset]');
    if (!preset) return;
    var minutes = Number(preset.dataset.preset);
    els.timerHours.value = String(Math.floor(minutes / 60));
    els.timerMinutes.value = String(minutes % 60);
    renderStandalone();
  });

  [els.timerHours, els.timerMinutes].forEach(function (input) {
    input.addEventListener('input', renderStandalone);
  });

  // Enter anywhere in the duration fields starts the timer.
  els.timerSetup.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    startStandalone();
  });
  els.timesUpDone.addEventListener('click', finishFocus);
  els.timesUpDismiss.addEventListener('click', stopFocus);

  els.timesUp.addEventListener('click', function (event) {
    var extend = event.target.closest('[data-extend]');
    if (extend) extendFocus(Number(extend.dataset.extend));
  });

  // Escape-closing the prompt should not silently discard the session.
  els.timesUp.addEventListener('cancel', function (event) {
    event.preventDefault();
  });

  els.showExport.addEventListener('click', function () {
    renderExport();
    openDialog(els.exportDialog);
  });

  els.exportOptions.addEventListener('click', function (event) {
    var option = event.target.closest('[data-format]');
    if (!option || option.disabled) return;
    downloadIcs(option.dataset.format);
  });

  els.exportClose.addEventListener('click', function () {
    closeDialog(els.exportDialog);
  });

  els.showStats.addEventListener('click', function () {
    renderStats();
    openDialog(els.statsDialog);
  });

  els.statsClose.addEventListener('click', function () {
    closeDialog(els.statsDialog);
  });

  els.estimate.addEventListener('change', renderEstimateHint);

  els.editForm.addEventListener('submit', function (event) {
    event.preventDefault();
    saveEdit();
  });

  els.editCancel.addEventListener('click', function () {
    closeDialog(els.editDialog);
    editingId = null;
  });

  els.editPriority.addEventListener('change', renderEditDialog);
  els.editDue.addEventListener('change', renderEditDialog);
  els.editTime.addEventListener('change', renderEditDialog);

  els.editPush.addEventListener('click', function (event) {
    var button = event.target.closest('[data-push]');
    if (button) pushEditTime(Number(button.dataset.push));
  });

  els.editTags.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ',') {
      // Enter in the tag field must not submit the whole dialog.
      event.preventDefault();
      if (addEditTag(els.editTags.value)) els.editTags.value = '';
      return;
    }
    if (event.key === 'Backspace' && !els.editTags.value && editTags.length) {
      event.preventDefault();
      removeEditTag(editTags.length - 1);
    }
  });

  els.editDialog.addEventListener('close', function () {
    editingId = null;
  });
  els.priority.addEventListener('change', updatePriorityDot);

  els.tagInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ',') {
      // Enter would otherwise submit the form before the tag is captured.
      event.preventDefault();
      if (addDraftTag(els.tagInput.value)) els.tagInput.value = '';
      return;
    }

    // Backspace on an empty field peels off the last chip.
    if (event.key === 'Backspace' && !els.tagInput.value && draftTags.length) {
      event.preventDefault();
      removeDraftTag(draftTags.length - 1);
    }
  });

  // Pasting "one, two, three" should split rather than land as a single tag.
  els.tagInput.addEventListener('paste', function (event) {
    var text = (event.clipboardData || window.clipboardData).getData('text');
    if (!text || text.indexOf(',') === -1) return;
    event.preventDefault();
    text.split(',').forEach(addDraftTag);
    els.tagInput.value = '';
  });

  els.themeToggle.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      // Theme simply won't persist if storage is unavailable.
    }
  });

  // A timer can outlive the page: the app may have been closed, or the device
  // asleep. Catch up on wall-clock time before the first paint.
  if (timer) {
    if (!findTask(timer.taskId)) {
      timer = null;
      saveTimer();
    } else {
      advanceTimer();
      saveTimer();
    }
  }

  // The standalone timer catches up on wall-clock time the same way.
  if (standalone) {
    advanceStandalone();
    saveStandalone();
  }

  updatePriorityDot();
  renderSoundToggle();
  renderDraftTags();
  render();
  renderStandalone();
  updateTitle();

  // Escalation turns on a clock rather than on an interaction, so poll for the
  // moment it flips. Re-rendering only when the set of escalated tasks actually
  // changes keeps this from churning the list every few seconds.
  function escalationSignature() {
    return tasks.map(function (task) {
      return isEscalated(task) ? '1' : '0';
    }).join('');
  }

  lastEscalation = escalationSignature();
  setInterval(function () {
    var next = escalationSignature();
    if (next === lastEscalation) return;
    lastEscalation = next;
    render();
  }, 15000);

  if (anythingRunning()) startTicker();
  if (standalone && standalone.expired) {
    playChime();
    openTimerView();
  }
  if (timer && timer.expired) openTimesUp();
})();
