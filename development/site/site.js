'use strict';
const address = document.getElementById('browser-address');
const copy = document.getElementById('copy-address');
for (const radio of document.querySelectorAll('input[name="browser"]')) {
  radio.addEventListener('change', () => { address.textContent = radio.value === 'edge' ? 'edge://extensions' : 'chrome://extensions'; });
}
copy.addEventListener('click', async () => {
  const label = copy.querySelector('span');
  try {
    await navigator.clipboard.writeText(address.textContent);
    label.textContent = '복사됨';
    document.getElementById('copy-status').textContent = '확장 관리 주소를 복사했습니다.';
    setTimeout(() => { label.textContent = '복사'; }, 1800);
  } catch {
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(address); selection.removeAllRanges(); selection.addRange(range);
    document.getElementById('copy-status').textContent = '주소를 선택했습니다. 직접 복사해주세요.';
  }
});
document.getElementById('privacy-link').addEventListener('click', () => { document.getElementById('privacy-details').open = true; });
