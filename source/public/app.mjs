import {
  newSession,
  tick,
  pause,
  resume,
  resolveGap,
  finish,
  totals
} from './engine.mjs';

const $ = id => document.getElementById(id);

const KEY = 'personal-os-focus-v1';
const ACCESS_KEY = 'personal-os-focus-access-key';

let data = {
  session: null,
  pending: [],
  projects: [],
  tasks: []
};

let owner = false;
let ready = false;
let syncing = false;
let audio = null;
let accessKey = '';
let lastStats = null;


const notify = message => {
  $('notice').textContent = message;
};


function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    ready = false;
    notify(
      '浏览器无法保存记录。请在独立窗口中打开并允许本地存储；计时已锁定。'
    );
  }
}


function read() {
  try {
    accessKey = localStorage.getItem(ACCESS_KEY) || '';

    const raw = localStorage.getItem(KEY);

    if (raw) {
      const parsed = JSON.parse(raw);

      if (
        !Array.isArray(parsed.pending) ||
        !Array.isArray(parsed.projects) ||
        !Array.isArray(parsed.tasks)
      ) {
        throw Error();
      }

      data = parsed;
    }
  } catch {
    ready = false;
    notify(
      '无法读取本地记录，请先备份浏览器数据；本次没有覆盖原记录。'
    );
  }
}


const clock = ms =>
  `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(
    Math.floor(ms / 1000) % 60
  ).padStart(2, '0')}`;


const duration = seconds =>
  seconds >= 3600
    ? `${Math.floor(seconds / 3600)}h ${Math.floor(
        (seconds % 3600) / 60
      )}m`
    : seconds > 0 && seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)}m`;


function render() {
  const session = data.session;
  const active = !!session;
  const minutes = Number($('minutes').value) || 25;

  $('clock').textContent = clock(
    Math.max(
      0,
      session
        ? session.targetMs - session.elapsedMs
        : minutes * 60000
    )
  );

  $('phase').textContent = session
    ? {
        running: '正在专注',
        paused: '已暂停',
        complete: '本段专注已完成',
        review: '待确认离开时间'
      }[session.status]
    : '准备开始';

  $('elapsed').textContent = session
    ? `已专注 ${clock(session.elapsedMs)}`
    : '专注于眼前这一件事';

  $('progress').style.strokeDashoffset = String(
    672.3 *
      (1 -
        (session
          ? session.elapsedMs / session.targetMs
          : 0))
  );

  $('start').hidden =
    active && session.status !== 'paused';

  $('start').textContent =
    active ? '继续专注' : '开始专注';

  $('pause').hidden =
    !active || session.status !== 'running';

  $('finish').hidden = !active;

  $('finish').disabled =
    !ready || session?.status === 'review';

  $('start').disabled = !ready;
  $('pause').disabled = !ready;

  $('discard').hidden = !active;
  $('discard').disabled = !ready;

  $('project').disabled = active || !ready;
  $('task').disabled = active || !ready;
  $('minutes').disabled = active || !ready;

  document
    .querySelectorAll('[data-minutes]')
    .forEach(button => {
      button.disabled = active || !ready;

      button.classList.toggle(
        'selected',
        Number(button.dataset.minutes) === minutes
      );
    });

  $('recovery').hidden =
    session?.status !== 'review';

  if (session?.status === 'review') {
    $('recovery-text').textContent =
      `页面曾中断或离开 ${duration(
        Math.floor(session.gapMs / 1000)
      )}。这段时间是否仍在专注？确认后保持暂停，由你决定何时继续。`;
  }

  $('pending-box').hidden =
    data.pending.length === 0;

  $('pending-text').textContent =
    `${data.pending.length} 条 · ${
      duration(
        data.pending.reduce(
          (sum, item) => sum + item.duration,
          0
        )
      )
    } 待保存（尚未计入统计）`;

  $('retry').disabled = syncing || !owner;

  $('account').textContent =
    owner ? '已连接 · 账户' : '连接记录';

  document.title =
    session?.status === 'running'
      ? `${clock(
          session.targetMs - session.elapsedMs
        )} · 专注`
      : '专注 · Personal OS';
}


function options(element, rows, label, selected) {
  element.replaceChildren(
    new Option(label, '')
  );

  for (const row of rows) {
    element.add(
      new Option(row.name, row.id)
    );
  }

  if (element === $('project')) {
    element.add(
      new Option('不关联项目', 'none')
    );
  }

  element.value = selected || '';
}


function setOptions() {
  options(
    $('project'),
    data.projects,
    'projet',
    data.session
      ? data.session.projectId || 'none'
      : $('project').value
  );

  setTasks();
}


function setTasks() {
  const projectId = $('project').value;

  options(
    $('task'),
    data.tasks.filter(
      task => task.projectId === projectId
    ),
    'action',
    data.session?.taskId ||
      $('task').value
  );
}


function wakeAudio() {
  if (!$('sound').checked) return;

  try {
    audio ||= new (
      window.AudioContext ||
      window.webkitAudioContext
    )();

    audio.resume();
  } catch {}
}


function chime() {
  if (
    !$('sound').checked ||
    !audio
  ) {
    return;
  }

  try {
    for (let i = 0; i < 3; i++) {
      const oscillator =
        audio.createOscillator();

      const gain =
        audio.createGain();

      const time =
        audio.currentTime + i * 0.24;

      oscillator.frequency.value =
        [523, 659, 784][i];

      gain.gain.setValueAtTime(
        0,
        time
      );

      gain.gain.linearRampToValueAtTime(
        0.1,
        time + 0.02
      );

      gain.gain.exponentialRampToValueAtTime(
        0.001,
        time + 0.2
      );

      oscillator.connect(gain);
      gain.connect(audio.destination);

      oscillator.start(time);
      oscillator.stop(time + 0.22);
    }
  } catch {}
}


async function api(path, body) {
  const headers = {
    Authorization:
      'Bearer ' + accessKey
  };

  if (body) {
    headers['Content-Type'] =
      'application/json';
  }

  const response = await fetch(
    '/api/focus/' + path,
    {
      method: body ? 'POST' : 'GET',
      headers,
      body: body
        ? JSON.stringify(body)
        : undefined,
      signal:
        AbortSignal.timeout(55000)
    }
  );

  let result;

  try {
    result =
      await response.json();
  } catch {
    throw Error(
      '自动保存服务尚未连接。记录会保留在本浏览器，可导出备份。'
    );
  }

  if (!response.ok) {
    throw Error(
      result.message ||
        '连接失败，记录仍保留在本地。'
    );
  }

  return result;
}


async function refresh() {
  try {
    const result =
      await api('bootstrap');

    owner = true;

    data.projects =
      result.projects;

    data.tasks =
      result.tasks;

    persist();
    setOptions();

    lastStats = result;

    drawStats();

    notify('');
  } catch (error) {
    owner = false;
    notify(error.message);
  }

  render();
}


function drawStats() {
  if (!lastStats) return;

  for (
    const [key, value]
    of Object.entries(
      totals(lastStats.sessions)
    )
  ) {
    $(key).textContent =
      duration(value);
  }

  $('stat-status').textContent =
    'Notion 已保存 · ' +
    new Date().toLocaleTimeString(
      'zh-CN',
      {
        hour: '2-digit',
        minute: '2-digit'
      }
    );
}


async function sync() {
  if (
    syncing ||
    !owner ||
    !ready
  ) {
    return;
  }

  syncing = true;
  render();

  try {
    for (
      const item
      of [...data.pending]
    ) {
      const result =
        await api(
          'sessions',
          item
        );

      if (result.saved !== true) {
        throw Error(
          '保存结果待确认，请保留此记录。'
        );
      }

      data.pending =
        data.pending.filter(
          row =>
            row.id !== item.id
        );

      persist();
    }

    await refresh();

    notify(
      '已保存到 Notion，并关联当天日记录。'
    );
  } catch (error) {
    notify(error.message);
  } finally {
    syncing = false;
    render();
  }
}


$('start').onclick = () => {
  try {
    wakeAudio();

    data.session =
      data.session
        ? resume(data.session)
        : newSession({
            minutes:
              Number(
                $('minutes').value
              ),
            projectId:
              $('project').value,
            taskId:
              $('task').value ||
              null
          });

    persist();
    render();
  } catch (error) {
    notify(error.message);
  }
};


$('pause').onclick = () => {
  data.session =
    pause(data.session);

  persist();
  render();
};


$('discard').onclick = () => {
  if (
    confirm(
      '放弃本段计时？本段不会保存到 Notion。'
    )
  ) {
    data.session = null;

    persist();
    render();
  }
};


$('finish').onclick = () => {
  try {
    const item =
      finish(data.session);

    if (
      !data.pending.some(
        row =>
          row.id === item.id
      )
    ) {
      data.pending.push(item);
    }

    data.session = null;

    persist();
    render();

    if (owner) {
      sync();
    } else {
      notify(
        '本段已保存在此浏览器，连接后可同步到 Notion。清理浏览器数据前请导出备份。'
      );
    }
  } catch (error) {
    data.session =
      tick(data.session);

    persist();
    render();

    notify(error.message);
  }
};


for (
  const [id, include]
  of [
    ['include', true],
    ['exclude', false]
  ]
) {
  $(id).onclick = () => {
    data.session =
      resolveGap(
        data.session,
        include
      );

    persist();
    render();
  };
}


document
  .querySelectorAll(
    '[data-minutes]'
  )
  .forEach(button => {
    button.onclick = () => {
      $('minutes').value =
        button.dataset.minutes;

      render();
    };
  });


$('minutes').oninput =
  render;

$('project').onchange =
  setTasks;

$('retry').onclick =
  sync;


$('export').onclick = () => {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          format:
            'personal-os-focus-v1',
          exportedAt:
            new Date()
              .toISOString(),
          pending:
            data.pending,
          active:
            data.session
        },
        null,
        2
      )
    ],
    {
      type:
        'application/json'
    }
  );

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement('a');

  link.href = url;

  link.download =
    'focus-backup-' +
    new Date()
      .toISOString()
      .slice(0, 10) +
    '.json';

  link.click();

  setTimeout(
    () =>
      URL.revokeObjectURL(url),
    1000
  );
};


$('account').onclick = () => {
  $('logout').hidden =
    !accessKey;

  $('password').value = '';

  $('login-error').textContent =
    '';

  $('login-dialog').showModal();
};


$('close-login').onclick =
  () =>
    $('login-dialog').close();


$('login-form').onsubmit =
  async event => {
    event.preventDefault();

    $('login-submit').disabled =
      true;

    try {
      const key =
        $('password')
          .value
          .trim();

      if (!key) {
        throw Error();
      }

      accessKey = key;

      localStorage.setItem(
        ACCESS_KEY,
        accessKey
      );

      await refresh();

      if (!owner) {
        localStorage.removeItem(
          ACCESS_KEY
        );

        accessKey = '';

        throw Error();
      }

      $('password').value = '';

      $('login-dialog').close();

      await sync();
    } catch {
      $('login-error').textContent =
        '访问密钥无效，或后台服务尚未完成配置。';
    } finally {
      $('login-submit').disabled =
        false;
    }
  };


$('logout').onclick = () => {
  localStorage.removeItem(
    ACCESS_KEY
  );

  accessKey = '';
  owner = false;
  lastStats = null;

  for (
    const key
    of [
      'today',
      'week',
      'month',
      'year'
    ]
  ) {
    $(key).textContent = '—';
  }

  $('stat-status').textContent =
    '已断开连接，待保存记录仍保留在本浏览器';

  $('login-dialog').close();

  render();
};


window.addEventListener(
  'online',
  () => {
    if (owner) {
      sync();
    }
  }
);


async function boot() {
  ready = true;

  read();

  if (!ready) {
    return render();
  }

  persist();

  if (data.session) {
    $('minutes').value =
      data.session.targetMs /
      60000;
  }

  if (
    data.session?.status ===
    'running'
  ) {
    data.session =
      tick(
        data.session,
        Date.now(),
        true
      );

    persist();
  }

  setOptions();
  render();

  if (accessKey) {
    await refresh();

    if (owner) {
      sync();
    }
  } else {
    notify(
      '当前为本地计时。输入个人访问密钥后，可自动保存到 Notion。'
    );
  }

  setInterval(
    () => {
      if (!ready) return;

      const before =
        data.session?.status;

      data.session =
        tick(data.session);

      if (data.session) {
        persist();
      }

      if (
        before === 'running' &&
        data.session.status ===
          'complete'
      ) {
        chime();
      }

      render();
    },
    1000
  );
}


if (navigator.locks) {
  navigator.locks.request(
    KEY,
    {
      ifAvailable: true
    },
    async lock => {
      if (!lock) {
        notify(
          '计时器已在另一个窗口打开。请在那个窗口继续，避免重复计时。'
        );

        render();
        return;
      }

      await boot();

      await new Promise(
        () => {}
      );
    }
  );
} else {
  notify(
    '此浏览器不支持安全恢复计时，请使用近期版本的 Chrome、Safari 或 Firefox。'
  );

  render();
}