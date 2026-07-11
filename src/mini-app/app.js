const tg = window.Telegram?.WebApp;
const initData = tg?.initData || '';

const state = {
  action: 'chat',
  ready: false
};

const $ = (id) => document.getElementById(id);
const toast = $('toast');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': initData,
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
  return payload;
}

function fillSelect(element, items, selected) {
  element.innerHTML = '';
  for (const item of items) {
    const option = document.createElement('option');
    option.value = typeof item === 'string' ? item : item.id;
    option.textContent = typeof item === 'string' ? item : item.label;
    option.selected = option.value === selected;
    element.appendChild(option);
  }
}

function updateAction(action) {
  state.action = action;
  for (const button of document.querySelectorAll('.action-tab')) {
    button.classList.toggle('active', button.dataset.action === action);
  }
  $('targetLanguageWrap').classList.toggle('hidden', action !== 'translate');
  const placeholders = {
    chat: '直接描述你的问题或目标…',
    web: '输入要查询的最新信息，例如：今天马来西亚的重要新闻',
    translate: '输入需要翻译的文字…',
    image: '描述要生成的图片、风格、构图和比例…'
  };
  $('prompt').placeholder = placeholders[action] || placeholders.chat;
}

async function load() {
  tg?.ready();
  tg?.expand();
  tg?.setHeaderColor?.('secondary_bg_color');
  tg?.setBackgroundColor?.('bg_color');

  if (!initData) {
    $('connection').textContent = '请从 Telegram 打开';
    $('welcome').textContent = '这个页面需要通过机器人 Mini App 入口打开。';
    $('sendAction').disabled = true;
    return;
  }

  try {
    const data = await api('/mini-app/api/bootstrap');
    $('welcome').textContent = data.user.firstName
      ? `${data.user.firstName}，今天想完成什么？`
      : '今天想完成什么？';
    $('connection').textContent = '已连接';
    fillSelect($('model'), data.options.models, data.settings.model);
    fillSelect($('persona'), data.options.personas, data.settings.persona);
    fillSelect($('language'), data.options.languages, data.settings.language);
    state.ready = true;
  } catch (error) {
    $('connection').textContent = '连接失败';
    $('welcome').textContent = '身份验证已过期，请关闭后从 Telegram 重新打开。';
    showToast(error.message);
  }
}

for (const button of document.querySelectorAll('.action-tab')) {
  button.addEventListener('click', () => updateAction(button.dataset.action));
}

$('sendAction').addEventListener('click', async () => {
  const text = $('prompt').value.trim();
  if (!state.ready || !text) {
    showToast('请先输入内容');
    return;
  }

  $('sendAction').disabled = true;
  $('sendAction').textContent = '正在发送…';
  try {
    await api('/mini-app/api/action', {
      method: 'POST',
      body: JSON.stringify({
        action: state.action,
        text,
        targetLanguage: $('targetLanguage').value
      })
    });
    $('prompt').value = '';
    tg?.HapticFeedback?.notificationOccurred?.('success');
    showToast('结果正在发送到机器人聊天');
  } catch (error) {
    tg?.HapticFeedback?.notificationOccurred?.('error');
    showToast(`发送失败：${error.message}`);
  } finally {
    $('sendAction').disabled = false;
    $('sendAction').textContent = '发送到聊天';
  }
});

async function saveSetting(key, value) {
  $('saveState').textContent = '保存中…';
  try {
    await api('/mini-app/api/settings', {
      method: 'POST',
      body: JSON.stringify({ [key]: value })
    });
    $('saveState').textContent = '已保存';
    tg?.HapticFeedback?.selectionChanged?.();
  } catch (error) {
    $('saveState').textContent = '保存失败';
    showToast(error.message);
  }
}

$('model').addEventListener('change', (event) => saveSetting('model', event.target.value));
$('persona').addEventListener('change', (event) => saveSetting('persona', event.target.value));
$('language').addEventListener('change', (event) => saveSetting('language', event.target.value));

$('clearMemory').addEventListener('click', async () => {
  if (!window.confirm('确定清空当前对话和长期记忆吗？')) return;
  $('clearMemory').disabled = true;
  try {
    await api('/mini-app/api/memory/clear', { method: 'POST', body: '{}' });
    tg?.HapticFeedback?.notificationOccurred?.('success');
    showToast('记忆已清空');
  } catch (error) {
    showToast(error.message);
  } finally {
    $('clearMemory').disabled = false;
  }
});

$('closeApp').addEventListener('click', () => tg?.close?.());

updateAction('chat');
load();
