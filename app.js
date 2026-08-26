/* A dependency-free to-do list backed by localStorage. */

(function () {
  'use strict';

  var TASKS_KEY = 'todo.tasks.v1';
  var THEME_KEY = 'todo.theme';
  var PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  var PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

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
    filters: Array.prototype.slice.call(document.querySelectorAll('.filter'))
  };

  var tasks = loadTasks();
  var filter = 'all';
  var editingId = null;

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
      createdAt: typeof task.createdAt === 'number' ? task.createdAt : Date.now()
    };
  }

  function saveTasks() {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    } catch (e) {
      // Storage unavailable (private mode, quota). The app still works in memory.
    }
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* Mutations ------------------------------------------------------------- */

  function addTask(text, dueDate, priority) {
    tasks.push({
      id: createId(),
      text: text,
      done: false,
      dueDate: dueDate,
      priority: priority,
      createdAt: Date.now()
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
    task.done = !task.done;
    commit();
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
    tasks = tasks.filter(function (task) {
      return task.id !== id;
    });
    commit();
  }

  function clearCompleted() {
    tasks = tasks.filter(function (task) {
      return !task.done;
    });
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
    item.className = 'task' + (task.done ? ' is-done' : '');
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

    addTask(text, els.due.value, els.priority.value);
    els.form.reset();
    els.priority.value = 'medium';
    els.text.focus();
  });

  // Delegated so rendering never has to rebind per-task listeners.
  els.list.addEventListener('click', function (event) {
    var control = event.target.closest('[data-action]');
    if (!control) return;

    var item = control.closest('.task');
    if (!item) return;
    var id = item.dataset.id;

    if (control.dataset.action === 'toggle') {
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

  els.themeToggle.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      // Theme simply won't persist if storage is unavailable.
    }
  });

  render();
})();
