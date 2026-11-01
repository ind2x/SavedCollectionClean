// No network client, credential access, persistent storage, or remote code.
export const ORIGIN = 'https://www.instagram.com';
const POST = /^\/(?:[\w.]+\/)?(?:p|reel)\/([\w-]+)\/?$/;
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function postId(value) {
  const url = new URL(value);
  const match = POST.exec(url.pathname);
  if (url.origin !== ORIGIN || url.username || url.password || !match) throw new Error('대상 게시글 주소를 확인하지 못했습니다.');
  return match[1];
}

// Serialized by chrome.scripting. All DOM helpers deliberately live inside it.
export function probePage(request) {
  const visible = (node) => {
    if (!node || node.closest('[hidden],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
  };
  const text = (node) => (node.innerText || node.textContent || '').trim();
  const name = (node) => {
    const label = node.getAttribute('aria-label');
    if (label) return label.trim();
    const labelled = node.getAttribute('aria-labelledby');
    if (labelled) return labelled.split(/\s+/).map((id) => text(document.getElementById(id) || document.createElement('span'))).join(' ').trim();
    return text(node) || Array.from(node.querySelectorAll('svg[aria-label],[role="img"][aria-label]')).map((item) => item.getAttribute('aria-label')).join(' ').trim();
  };
  const headings = (root = document) => Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')).filter(visible).map(text);
  const buttons = (root, label) => Array.from(root.querySelectorAll('button,[role="button"]')).filter((node) => visible(node) && name(node) === label);
  const dialogs = () => Array.from(document.querySelectorAll('[role="dialog"],dialog[open]')).filter(visible);
  const clickOne = (items, reason) => {
    const innermost = items.filter((item) => !items.some((other) => other !== item && item.contains(other)));
    if (innermost.length !== 1 || innermost[0].disabled || innermost[0].getAttribute('aria-disabled') === 'true') return {error: reason};
    innermost[0].click();
    return {clicked: true};
  };
  const path = location.pathname;
  if (location.origin !== 'https://www.instagram.com') return {error: 'Instagram 탭에서만 실행할 수 있습니다.'};
  if (request.postId) {
    const currentPost = /^\/(?:[\w.]+\/)?(?:p|reel)\/([\w-]+)\/?$/.exec(path);
    if (!currentPost || currentPost[1] !== request.postId) return {error: '현재 게시글이 승인한 대상과 달라 중단했습니다.'};
  }
  if (request.collection && ['options', 'delete-menu', 'confirm-delete'].includes(request.op) && path !== new URL(request.collection.url).pathname) {
    return {error: '현재 컬렉션이 승인한 대상과 달라 중단했습니다.'};
  }
  if (/\/accounts\/login|\/challenge|\/checkpoint/.test(path)) return {error: 'Instagram 탭에서 로그인 또는 계정 확인을 직접 완료하세요.'};
  if (dialogs().some((dialog) => /나중에 다시 시도|일시적으로 차단|자동화된 행동|Try again later|temporarily blocked|automated behavior/i.test(text(dialog)))) return {error: 'Instagram 제한 안내가 나타났습니다. 추가 동작을 중단합니다.'};
  if (headings().some((heading) => /문제가 발생했습니다|Something went wrong/i.test(heading))) return {error: 'Instagram에서 페이지를 읽어들이지 못했습니다. 화면이 정상화된 뒤 다시 실행하세요.'};
  const mains = Array.from(document.querySelectorAll('main,[role="main"]')).filter(visible);
  const main = mains.length === 1 ? mains[0] : null;
  const busy = Array.from(document.querySelectorAll('[role="progressbar"],[aria-busy="true"],[role="status"][aria-label="읽어들이는 중..."]')).some(visible);
  const ownSaved = () => path.replace(/\/$/, '') === '/' + request.account + '/saved' && (document.body.innerText || '').includes('저장한 내용은 회원님만 볼 수 있습니다');
  const bookmark = () => {
    if (!main || dialogs().length) return null;
    const match = /^\/(?:[\w.]+\/)?(?:p|reel)\/([\w-]+)\/?$/.exec(path);
    if (!match || match[1] !== request.postId) return null;
    for (const [label, state] of [['삭제', 'saved'], ['저장', 'unsaved']]) {
      const icons = Array.from(main.querySelectorAll('svg[aria-label],[role="img"][aria-label]')).filter((node) => visible(node) && node.getAttribute('aria-label') === label);
      if (icons.length === 1) {
        const button = icons[0].closest('button,[role="button"]');
        if (button && main.contains(button) && visible(button)) return {state, button};
      }
    }
    return null;
  };
  if (request.op === 'collections') {
    if (!main || busy || !ownSaved()) return {ready: false};
    const escaped = request.account.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
    const route = new RegExp('^/' + escaped + '/saved/(?:[^/]+/)?(\\d+)/?$');
    const items = [];
    for (const link of main.querySelectorAll('a[href]')) {
      const url = new URL(link.href, location.origin);
      const match = route.exec(url.pathname);
      if (url.origin !== location.origin || url.username || url.password || !match) continue;
      const label = text(link) || link.getAttribute('aria-label') || '';
      if (!label.trim()) return {error: '이름을 확인할 수 없는 컬렉션이 있습니다.'};
      items.push({id: match[1], name: label.trim(), url: url.origin + url.pathname});
    }
    return {ready: true, items, bottom: scrollY + innerHeight >= document.documentElement.scrollHeight - 5};
  }
  if (request.op === 'scroll') { scrollTo(0, document.documentElement.scrollHeight); return {ready: true}; }
  if (request.op === 'next') {
    if (!main || busy || path !== new URL(request.collection.url).pathname || !headings(main).includes(request.collection.name)) return {ready: false};
    for (const link of main.querySelectorAll('a[href]')) {
      const url = new URL(link.href, location.origin);
      if (url.origin === location.origin && !url.username && !url.password && /^\/(?:[\w.]+\/)?(?:p|reel)\/[\w-]+\/?$/.test(url.pathname)) return {ready: true, url: url.origin + url.pathname};
    }
    const empty = headings(main).includes('저장하기') && text(main).includes('컬렉션에 사진과 동영상을 저장해보세요.');
    return empty ? {ready: true, url: null} : {ready: false};
  }
  if (request.op === 'bookmark') { const result = bookmark(); return result ? {ready: true, state: result.state} : {ready: false}; }
  if (request.op === 'unsave') {
    const result = bookmark();
    if (!result) return {ready: false};
    if (result.state === 'unsaved') return {ready: true, state: 'unsaved'};
    return clickOne([result.button], '저장 해제 버튼이 모호해 중단했습니다.');
  }
  if (request.op === 'unsave-state') {
    const prompts = dialogs().filter((dialog) => text(dialog).includes('저장된 항목과 컬렉션에서 삭제하시겠어요?'));
    if (prompts.length === 1) return {ready: true, stage: 'confirmation'};
    const result = bookmark();
    return result && result.state === 'unsaved' ? {ready: true, stage: 'done'} : {ready: false};
  }
  if (request.op === 'confirm-unsave') {
    const prompts = dialogs().filter((dialog) => text(dialog).includes('저장된 항목과 컬렉션에서 삭제하시겠어요?'));
    return prompts.length === 1 ? clickOne(buttons(prompts[0], '삭제'), '전체 저장 해제 확인 버튼을 특정하지 못했습니다.') : {error: '알 수 없는 저장 해제 확인창입니다.'};
  }
  if (request.op === 'options') return main && headings(main).includes(request.collection.name) ? clickOne(buttons(main, '옵션 수정'), '컬렉션 옵션 버튼을 특정하지 못했습니다.') : {ready: false};
  if (request.op === 'delete-menu') {
    const menus = dialogs().filter((dialog) => buttons(dialog, '컬렉션 삭제').length > 0);
    return menus.length === 1 ? clickOne(buttons(menus[0], '컬렉션 삭제'), '컬렉션 삭제 메뉴가 모호합니다.') : {ready: false};
  }
  if (request.op === 'delete-state') {
    for (const dialog of dialogs()) {
      if (/저장된 항목에서 추가|컬렉션 수정/.test(text(dialog))) continue;
      const title = headings(dialog).join(' ');
      if (title.includes('컬렉션') && title.includes('삭제')) {
        const choices = [...buttons(dialog, '삭제'), ...buttons(dialog, '컬렉션 삭제')];
        if (choices.length !== 1) return {error: '컬렉션 삭제 확인 버튼이 모호합니다.'};
        return {ready: true, stage: 'confirmation'};
      }
    }
    return ownSaved() ? {ready: true, stage: 'check'} : {ready: false};
  }
  if (request.op === 'confirm-delete') {
    const matches = dialogs().filter((dialog) => {
      const title = headings(dialog).join(' ');
      return title.includes('컬렉션') && title.includes('삭제') && !/저장된 항목에서 추가|컬렉션 수정/.test(text(dialog));
    });
    return matches.length === 1 ? clickOne([...buttons(matches[0], '삭제'), ...buttons(matches[0], '컬렉션 삭제')], '컬렉션 삭제 확인 버튼이 모호합니다.') : {error: '알 수 없는 컬렉션 삭제 확인창입니다.'};
  }
  return {error: '지원하지 않는 화면 동작입니다.'};
}

export class Stopped extends Error {
  constructor() { super('중단했습니다. 미확정 결과는 Instagram 화면에서 확인하세요.'); }
}
export class InstagramRunner {
  constructor(tabId, account, onEvent = () => {}, onProgress = () => {}) {
    this.tabId = tabId; this.account = account; this.onEvent = onEvent; this.onProgress = onProgress;
    this.stopped = false; this.firstVerified = false; this.posts = new Map(); this.events = []; this.results = new Map();
  }
  stop() { this.stopped = true; }
  check() { if (this.stopped) throw new Stopped(); }
  emit(event, collection, url, reason) {
    const labels = {approved: '실행 승인', collection_started: '컬렉션 정리 시작', pending: '게시글 저장 해제 시작', unsaved: '게시글 저장 해제 완료', already_unsaved: '이미 저장 해제된 게시글', unknown: '게시글 결과 미확정', empty_verified: '빈 상태 확인', collection_delete_pending: '빈 컬렉션 삭제 시작', deleted_verified: '컬렉션 삭제 확인 완료', failed: '컬렉션 처리 실패', interrupted: '사용자가 중단함', first_verified: '첫 저장 해제 새로고침 확인 완료'};
    const row = {time: new Date().toISOString(), account: this.account, event, message: labels[event] || event};
    if (collection) Object.assign(row, {collection: collection.name, collection_id: collection.id, message: '[' + collection.name + '] ' + row.message});
    if (url) Object.assign(row, {url, post_id: postId(url)});
    if (reason) Object.assign(row, {reason, message: row.message + ': ' + reason});
    this.events.push(row);
    if (url && ['unsaved', 'already_unsaved'].includes(event) && this.posts.get(row.post_id) !== 'unsaved') this.posts.set(row.post_id, event);
    this.onEvent(row);
  }
  async tab() {
    this.check();
    let tab;
    try { tab = await chrome.tabs.get(this.tabId); }
    catch { throw new Error('작업할 Instagram 탭이 닫혔습니다. 탭을 다시 열고 확장 아이콘을 눌러주세요.'); }
    this.check();
    if (!tab.url || new URL(tab.url).origin !== ORIGIN) throw new Error('Instagram 탭에서 확장 아이콘을 눌러 실행하세요.');
    return tab;
  }
  async navigate(value, reload = false) {
    this.check();
    const url = new URL(value);
    if (url.origin !== ORIGIN || url.username || url.password) throw new Error('허용되지 않은 주소입니다.');
    const tab = await this.tab();
    this.check();
    if (reload || tab.url === url.href) await chrome.tabs.reload(this.tabId);
    else await chrome.tabs.update(this.tabId, {url: url.href});
    await sleep(350);
  }
  async probe(request) {
    await this.tab();
    this.check();
    let results;
    try { results = await chrome.scripting.executeScript({target: {tabId: this.tabId}, func: probePage, args: [{account: this.account, ...request}]}); }
    catch (error) {
      const message = String(error.message || error);
      if (/Cannot access|permission|not allowed|extensions gallery/i.test(message)) throw new Error('이 탭의 접근 권한이 없습니다. Instagram 탭에서 확장 아이콘을 다시 눌러주세요.');
      if (/No frame|Frame.*removed|context.*destroyed|Cannot find context|page is navigating/i.test(message)) return {ready: false};
      throw new Error('Instagram 화면을 읽지 못했습니다: ' + message);
    }
    const value = results[0] && results[0].result;
    if (!value) return {ready: false};
    if (value.error) throw new Error(value.error);
    return value;
  }
  async wait(request, accept = (value) => value.ready, message = '화면 확인 시간이 초과됐습니다.') {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      this.check();
      const value = await this.probe(request);
      if (accept(value)) return value;
      await sleep(300);
    }
    throw new Error(message);
  }
  async click(request) { return this.wait(request, (value) => value.clicked || value.state === 'unsaved', '안전하게 클릭할 대상을 확인하지 못했습니다.'); }
  async collections() {
    await this.navigate(ORIGIN + '/' + this.account + '/saved/');
    const found = new Map();
    let unchanged = 0;
    for (let i = 0; i < 200; i += 1) {
      const state = await this.wait({op: 'collections'}, (value) => value.ready, '본인 계정의 한국어 저장 목록을 확인하지 못했습니다. 로그인과 사용자 이름을 확인하세요.');
      const before = found.size;
      for (const item of state.items) found.set(item.id, item);
      unchanged = found.size === before ? unchanged + 1 : 0;
      if (state.bottom && unchanged >= 3) return [...found.values()];
      await this.probe({op: 'scroll'});
      await sleep(1000);
    }
    throw new Error('컬렉션 목록 로딩이 끝나지 않아 중단했습니다.');
  }
  async next(collection) {
    await this.navigate(collection.url);
    const state = await this.wait({op: 'next', collection}, (value) => value.ready, '게시글 또는 빈 상태를 확인하지 못했습니다: ' + collection.name);
    return state.url;
  }
  async unsave(url) {
    const id = postId(url);
    await this.navigate(url);
    const bookmark = await this.wait({op: 'bookmark', postId: id});
    if (bookmark.state === 'unsaved') return 'already_unsaved';
    await this.click({op: 'unsave', postId: id});
    const changed = await this.wait({op: 'unsave-state', postId: id}, (value) => value.ready, '저장 해제 결과가 미확정입니다. 재클릭하지 않고 중단합니다.');
    if (changed.stage === 'confirmation') await this.click({op: 'confirm-unsave', postId: id});
    await this.wait({op: 'bookmark', postId: id}, (value) => value.ready && value.state === 'unsaved', '저장 해제 후 화면 상태를 확인하지 못했습니다.');
    if (!this.firstVerified) {
      await sleep(1000);
      await this.navigate(url, true);
      await this.wait({op: 'bookmark', postId: id}, (value) => value.ready && value.state === 'unsaved', '첫 해제 후 새로고침 확인에 실패했습니다.');
      this.firstVerified = true;
      this.emit('first_verified');
    }
    return 'unsaved';
  }
  async deleteCollection(collection) {
    if (await this.next(collection) !== null || await this.next(collection) !== null) throw new Error('게시글이 남아 있어 컬렉션 삭제를 보류합니다.');
    await this.click({op: 'options', collection});
    await this.click({op: 'delete-menu', collection});
    const state = await this.wait({op: 'delete-state', collection});
    if (state.stage === 'confirmation') await this.click({op: 'confirm-delete', collection});
    const available = await this.collections();
    if (available.some((item) => item.id === collection.id)) throw new Error('목록에 컬렉션이 남아 있어 삭제 완료로 기록하지 않습니다.');
  }
  async run(selected) {
    this.emit('approved', null, null, selected.map((item) => item.name).join(', '));
    for (const item of selected) this.results.set(item.id, {name: item.name, state: '미착수'});
    let current;
    try {
      for (const collection of selected) {
        current = collection; this.check();
        this.results.set(collection.id, {name: collection.name, state: '진행 중'});
        this.emit('collection_started', collection);
        const attempts = new Map();
        while (true) {
          const url = await this.next(collection);
          if (url === null) {
            this.emit('empty_verified', collection); this.emit('collection_delete_pending', collection);
            await this.deleteCollection(collection);
            this.results.set(collection.id, {name: collection.name, state: '삭제 완료'});
            this.emit('deleted_verified', collection);
            break;
          }
          const id = postId(url);
          attempts.set(id, (attempts.get(id) || 0) + 1);
          if (attempts.get(id) > 2) throw new Error('같은 게시글이 반복돼 중단합니다. 컬렉션을 삭제하지 않습니다.');
          this.emit('pending', collection, url);
          try { this.emit(await this.unsave(url), collection, url); }
          catch (error) { this.emit('unknown', collection, url); throw error; }
          this.onProgress(this.posts.size);
          await sleep(1500);
        }
      }
      return {state: 'complete', message: '선택한 컬렉션의 정리를 완료했습니다.'};
    } catch (error) {
      const stopped = error instanceof Stopped;
      if (current) this.results.set(current.id, {name: current.name, state: stopped ? '중단' : '실패'});
      this.emit(stopped ? 'interrupted' : 'failed', current, null, error.message);
      return {state: stopped ? 'stopped' : 'failed', message: error.message};
    }
  }
}
