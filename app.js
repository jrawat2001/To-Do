/* A dependency-free to-do list backed by localStorage. */

(function () {
  'use strict';

  var TASKS_KEY = 'todo.tasks.v1';
  var THEME_KEY = 'todo.theme';
  var TIMER_KEY = 'todo.timer.v1';
  var LOG_KEY = 'todo.focuslog.v1';
  var STANDALONE_KEY = 'todo.standalone.v1';
  var PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  var PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

  // Keep the log bounded so storage cannot grow without limit.
  var LOG_LIMIT = 200;
  // Below this many sessions the overrun ratio is too noisy to suggest from.
  var MIN_SESSIONS_FOR_HINT = 3;

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
    timerReset: document.getElementById('timer-reset')
  };

  var tasks = loadTasks();
  var log = loadLog();
  var timer = loadTimer();
  var standalone = loadStandalone();
  var filter = 'all';
  var editingId = null;
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
      dueDate: typeof task.dueDate === 'string' ? task.dueDate : '',
      priority: PRIORITY_RANK[task.priority] === undefined ? 'medium' : task.priority,
      createdAt: typeof task.createdAt === 'number' ? task.createdAt : Date.now(),
      estimateMin: typeof task.estimateMin === 'number' && task.estimateMin > 0 ? task.estimateMin : null,
      spentSec: typeof task.spentSec === 'number' && task.spentSec > 0 ? task.spentSec : 0,
      // How much of spentSec has already been written to the log, so a task
      // toggled done twice is not counted twice.
      loggedSec: typeof task.loggedSec === 'number' && task.loggedSec > 0 ? task.loggedSec : 0
    };
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

  function addTask(text, dueDate, priority, estimateMin) {
    tasks.push({
      id: createId(),
      text: text,
      done: false,
      dueDate: dueDate,
      priority: priority,
      createdAt: Date.now(),
      estimateMin: estimateMin || null,
      spentSec: 0,
      loggedSec: 0
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

  function formatDueDate(value) {
    var parts = value.split('-');
    if (parts.length !== 3) return value;
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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

    if (standaloneJustExpired) openTimerView();
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

  /* Selection & sorting --------------------------------------------------- */

  function visibleTasks() {
    var selected = tasks.filter(function (task) {
      if (filter === 'active') return !task.done;
      if (filter === 'done') return task.done;
      return true;
    });

    return selected.sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;

      var rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
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

    renderFocus();
    renderEstimateHint();

    els.filters.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
    });

    if (editingId) {
      var input = els.list.querySelector('.task-edit-input');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
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
      (timer && timer.taskId === task.id ? ' is-focused' : '');
    item.dataset.id = task.id;
    item.dataset.priority = task.priority;

    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-checkbox';
    checkbox.checked = task.done;
    checkbox.dataset.action = 'toggle';
    checkbox.setAttribute('aria-label', (task.done ? 'Mark as not done: ' : 'Mark as done: ') + task.text);
    item.appendChild(checkbox);

    var body = document.createElement('div');
    body.className = 'task-body';

    if (editingId === task.id) {
      body.appendChild(renderEditInput(task));
    } else {
      var text = document.createElement('span');
      text.className = 'task-text';
      text.textContent = task.text;
      body.appendChild(text);

      var meta = renderMeta(task);
      if (meta) body.appendChild(meta);
    }

    item.appendChild(body);
    item.appendChild(renderActions(task));
    return item;
  }

  function renderMeta(task) {
    var meta = document.createElement('div');
    meta.className = 'task-meta';

    var priority = document.createElement('span');
    priority.className = 'badge badge-priority';
    priority.dataset.priority = task.priority;
    priority.textContent = PRIORITY_LABEL[task.priority];
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
      var due = document.createElement('span');
      due.textContent = 'Due ' + formatDueDate(task.dueDate);
      meta.appendChild(due);

      var now = today();
      if (!task.done && task.dueDate < now) {
        meta.appendChild(makeBadge('badge-overdue', 'Overdue'));
      } else if (task.dueDate === now) {
        meta.appendChild(makeBadge('badge-today', 'Today'));
      }
    }

    return meta;
  }

  function makeBadge(className, label) {
    var badge = document.createElement('span');
    badge.className = 'badge ' + className;
    badge.textContent = label;
    return badge;
  }

  function renderEditInput(task) {
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-edit-input';
    input.value = task.text;
    input.maxLength = 200;
    input.setAttribute('aria-label', 'Edit task');

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        var value = input.value;
        editingId = null;
        editTask(task.id, value);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        editingId = null;
        render();
      }
    });

    input.addEventListener('blur', function () {
      if (editingId !== task.id) return;
      var value = input.value;
      editingId = null;
      editTask(task.id, value);
    });

    return input;
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

    addTask(text, els.due.value, els.priority.value, Number(els.estimate.value) || null);
    els.form.reset();
    els.priority.value = 'medium';
    els.estimate.value = '';
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
      editingId = id;
      render();
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

  els.showStats.addEventListener('click', function () {
    renderStats();
    openDialog(els.statsDialog);
  });

  els.statsClose.addEventListener('click', function () {
    closeDialog(els.statsDialog);
  });

  els.estimate.addEventListener('change', renderEstimateHint);

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

  render();
  renderStandalone();
  updateTitle();

  if (anythingRunning()) startTicker();
  if (standalone && standalone.expired) openTimerView();
  if (timer && timer.expired) openTimesUp();
})();
