import {InstagramRunner, ORIGIN} from './runner.js';
const $ = (id) => document.getElementById(id);
const targetTab = Number(new URL(location.href).searchParams.get('tab'));
let collections = [], loadedAccount = '', runner, busy = false, loading = false, events = [], lastResults = [];
const expectedPhrase = () => loadedAccount + ' 저장 해제 및 컬렉션 삭제';
const selected = () => collections.filter((item) => $('collection-' + item.id)?.checked);
async function ensureSingleWindow() {
  const current = await chrome.tabs.getCurrent();
  const contexts = await chrome.runtime.getContexts({contextTypes: ['TAB']});
  const owners = contexts.filter((item) => item.documentUrl === location.href && item.tabId >= 0).map((item) => item.tabId);
  if (current && owners.length && current.id !== Math.min(...owners)) throw new Error('이 Instagram 탭의 정리 창이 이미 열려 있습니다. 먼저 열린 창을 사용하세요.');
}
function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function updateConfirmation(reset = false) {
  if (reset) { $('ack').checked = false; $('phrase').value = ''; }
  const targets = selected();
  $('selected').replaceChildren();
  if (!targets.length) {
    const empty = document.createElement('li');
    empty.className = 'empty'; empty.textContent = '선택한 컬렉션이 없습니다.'; $('selected').append(empty);
  }
  for (const target of targets) { const item = document.createElement('li'); item.textContent = target.name; $('selected').append(item); }
  $('expected-phrase').textContent = loadedAccount ? expectedPhrase() : '사용자 이름과 대상을 먼저 확인하세요.';
  $('start').disabled = busy || loading || !targets.length || !loadedAccount || $('account').value.trim().toLowerCase() !== loadedAccount || !$('ack').checked || $('phrase').value.trim() !== expectedPhrase();
}
function setBusy(value) {
  busy = value;
  for (const id of ['account','load','ack','phrase']) $(id).disabled = value;
  $('stop').disabled = !value;
  for (const checkbox of $('collections').querySelectorAll('input')) checkbox.disabled = value;
  updateConfirmation();
}
function addEvent(row) {
  events.push(row);
  if (events.length === 1) $('events').replaceChildren();
  const li = document.createElement('li'); li.dataset.event = row.event;
  const time = document.createElement('time'); time.dateTime = row.time;
  time.textContent = new Date(row.time).toLocaleTimeString('ko-KR', {hour12: false});
  const message = document.createElement('span'); message.textContent = row.message + (row.post_id ? ' · ' + row.post_id : '');
  li.append(time, message); $('events').append(li);
  while ($('events').children.length > 180) $('events').firstElementChild.remove();
  $('events').scrollTop = $('events').scrollHeight; $('export').disabled = false;
}
function renderCollections() {
  $('collections').replaceChildren(); $('count').textContent = collections.length + '개';
  if (!collections.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '현재 계정에 확인할 수 있는 컬렉션이 없습니다.'; $('collections').append(empty);
  }
  const nameCounts = new Map();
  for (const item of collections) nameCounts.set(item.name, (nameCounts.get(item.name) || 0) + 1);
  for (const item of collections) {
    const row = document.createElement('label'); row.className = 'collection-row';
    const input = document.createElement('input'); input.type = 'checkbox'; input.id = 'collection-' + item.id;
    input.addEventListener('change', () => updateConfirmation(true));
    const label = document.createElement('span'); label.textContent = item.name;
    if (nameCounts.get(item.name) > 1) { const id = document.createElement('small'); id.textContent = 'ID ' + item.id; label.append(id); }
    row.append(input, label); $('collections').append(row);
  }
  updateConfirmation(true);
}
$('load-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || loading) return;
  const account = $('account').value.trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(account)) return status('URL이나 @ 없이 사용자 이름만 입력하세요.', true);
  if (!Number.isInteger(targetTab) || targetTab <= 0) return status('Instagram 탭에서 확장 아이콘을 다시 눌러 실행하세요.', true);
  loading = true; $('load').disabled = true; $('account').disabled = true; updateConfirmation(true);
  status('Instagram의 현재 컬렉션 목록을 읽고 있습니다…');
  try {
    await ensureSingleWindow();
    runner = new InstagramRunner(targetTab, account);
    collections = await runner.collections(); loadedAccount = account; renderCollections();
    status('컬렉션 ' + collections.length + '개를 불러왔습니다. 정리할 대상을 선택하세요.');
  } catch (error) {
    collections = []; loadedAccount = ''; renderCollections(); status(error.message, true);
  } finally {
    loading = false; $('load').disabled = false; $('account').disabled = false; updateConfirmation();
  }
});
$('account').addEventListener('input', () => {
  if (loadedAccount && $('account').value.trim().toLowerCase() !== loadedAccount) {
    collections = []; loadedAccount = ''; renderCollections(); status('계정이 바뀌었습니다. 현재 목록을 다시 불러오세요.');
  }
});
$('ack').addEventListener('change', () => updateConfirmation());
$('phrase').addEventListener('input', () => updateConfirmation());
$('start').addEventListener('click', async () => {
  updateConfirmation(); if ($('start').disabled) return;
  try { await ensureSingleWindow(); } catch (error) { status(error.message, true); return; }
  const targets = selected().map((item) => ({...item}));
  events = []; lastResults = []; $('events').replaceChildren(); $('export').disabled = true;
  runner = new InstagramRunner(targetTab, loadedAccount, addEvent, (count) => { $('progress').textContent = '이번 실행에서 고유 게시글 ' + count + '건을 확인했습니다.'; });
  setBusy(true); status('정리 중입니다. Instagram 탭과 이 창을 열어두세요.');
  try {
    const result = await runner.run(targets);
    lastResults = [...runner.results.values()];
    status(result.message, result.state === 'failed');
    $('progress').textContent = lastResults.map((item) => item.name + ': ' + item.state).join(' / ');
    collections = []; loadedAccount = ''; renderCollections();
  } catch (error) { status('작업이 중단됐습니다: ' + error.message, true); }
  finally { setBusy(false); }
});
$('stop').addEventListener('click', () => {
  runner?.stop(); $('stop').disabled = true;
  status('중단을 요청했습니다. 이미 진행된 클릭의 결과는 Instagram에서 확인하세요.');
});
$('export').addEventListener('click', () => {
  if (!events.length) return;
  const summary = ['savedpoststree · 이번 작업 기록', '계정: ' + events[0].account];
  const results = busy && runner ? [...runner.results.values()] : lastResults;
  for (const value of results) summary.push(value.name + ': ' + value.state);
  summary.push('', ...events.map((row) => new Date(row.time).toLocaleString('ko-KR') + ' ' + row.message + (row.post_id ? ' (게시글 ' + row.post_id + ')' : '')));
  const url = URL.createObjectURL(new Blob(['\uFEFF' + summary.join('\n') + '\n'], {type: 'text/plain;charset=utf-8'}));
  const anchor = document.createElement('a'); anchor.href = url;
  anchor.download = 'savedpoststree-' + new Date().toISOString().slice(0, 10) + '.txt'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('beforeunload', (event) => { if (busy || loading) { event.preventDefault(); event.returnValue = ''; } });
async function initialize() {
  if (!Number.isInteger(targetTab) || targetTab <= 0) return;
  try {
    const tab = await chrome.tabs.get(targetTab); const url = new URL(tab.url);
    if (url.origin !== ORIGIN) return;
    const match = /^\/([a-zA-Z0-9._]+)\/saved(?:\/|$)/.exec(url.pathname);
    if (match) $('account').value = match[1];
    status('연결된 Instagram 탭을 확인했습니다. 사용자 이름을 확인하고 목록을 불러오세요.');
  } catch { status('Instagram 탭에서 확장 아이콘을 다시 눌러 실행하세요.', true); }
}
initialize();
