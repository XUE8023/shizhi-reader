const form = document.querySelector('#unlock');
const originalFetch = window.fetch.bind(window);
let keyMaterial;
const bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
async function readFeed(material) {
  const response = await originalFetch('./feed.enc.json', {cache:'no-store'});
  if (!response.ok) throw new Error('卡片包暂不可用');
  const pack = await response.json();
  const key = await crypto.subtle.deriveKey(
    {name:'PBKDF2',salt:bytes(pack.salt),iterations:600000,hash:'SHA-256'},
    material,{name:'AES-GCM',length:256},false,['decrypt']);
  return crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(pack.iv)},key,bytes(pack.data));
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    keyMaterial = await crypto.subtle.importKey('raw',new TextEncoder().encode(form.password.value),
      'PBKDF2',false,['deriveKey']);
    let initial = await readFeed(keyMaterial);
    window.fetch = async (url, options) => {
      if (url === './data/feed.json') {
        const result = initial || await readFeed(keyMaterial);
        initial = null;
        return new Response(result,{headers:{'Content-Type':'application/json'}});
      }
      if (String(url).startsWith('/api/')) return new Response(null,{status:404});
      return originalFetch(url, options);
    };
    await import('./app.js');
    form.reset();
    form.hidden = true;
    document.querySelector('#app').hidden = false;
  } catch (_) {
    document.querySelector('#unlockStatus').textContent = '无法解锁，请核对密码或稍后重试。';
  } finally { button.disabled = false; }
});
