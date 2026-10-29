/**
 * The page the phone opens from the QR code. Self-contained (no external
 * requests), locked down by a per-response nonce CSP, and styled like the
 * editor ("lights down"). It opens the phone's camera via a file input
 * (works over plain http, unlike getUserMedia), redraws the photo to a JPEG
 * of at most 4096 px -- which also converts iPhone HEIC and applies the
 * photo's rotation -- and posts it back to the same URL + "/photo".
 */
export function phonePageHtml(nonce: string, { frameShown = false } = {}): string {
  const framingStep = frameShown
    ? 'Fit the <strong>whole glowing frame</strong> in the photo, object inside it.'
    : 'Fit the <strong>whole object</strong> in the frame.'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>Photo for MirrorCat</title>
<style nonce="${nonce}">
  :root { --room:#1d1a23; --wall:#26232e; --raised:#302c39; --plaster:#e8e3d9; --dusk:#9d96a8; --alert:#f2877a; }
  * { box-sizing: border-box; }
  html, body { margin:0; min-height:100%; background:var(--room); color:var(--plaster);
    font: 17px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing:antialiased; }
  main { max-width: 30rem; margin: 0 auto; padding: max(28px, env(safe-area-inset-top)) 22px 40px; display:flex; flex-direction:column; gap:22px; }
  h1 { margin:0; font-size:24px; font-weight:600; letter-spacing:-0.01em; }
  ol { margin:0; padding:0; list-style:none; counter-reset:step; display:flex; flex-direction:column; gap:12px; }
  li { counter-increment:step; display:flex; gap:12px; align-items:baseline; color:var(--dusk); }
  li::before { content:counter(step); flex:none; width:24px; height:24px; border-radius:50%; background:var(--wall);
    color:var(--plaster); font-size:13px; font-weight:600; display:grid; place-items:center; transform:translateY(-1px); }
  li strong { color:var(--plaster); font-weight:500; }
  .take { position:relative; display:flex; align-items:center; justify-content:center; gap:10px; height:60px;
    border-radius:16px; background:var(--plaster); color:var(--room); font-weight:600; font-size:18px; }
  .take input { position:absolute; inset:0; opacity:0; width:100%; height:100%; }
  .take:active { transform:scale(0.99); }
  .preview { width:100%; border-radius:14px; background:#000; display:none; }
  .status { min-height:1.5em; color:var(--dusk); text-align:center; }
  .status.error { color:var(--alert); }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <h1>Photo for MirrorCat</h1>
  <ol id="steps">
    <li><span><strong>Stand right beside the projector</strong>, so the photo sees what the projector sees.</span></li>
    <li><span>Use the <strong>1× lens</strong> and hold the phone level.</span></li>
    <li><span>${framingStep}</span></li>
  </ol>
  <img id="preview" class="preview" alt="The photo you took">
  <label class="take" id="take">
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="2"/></svg>
    <span class="take-label">Take photo</span>
    <input id="file" type="file" accept="image/*" capture="environment">
  </label>
  <p class="status" id="status" role="status" aria-live="polite"></p>
</main>
<script nonce="${nonce}">
(function () {
  var MAX_EDGE = 4096;
  var input = document.getElementById('file');
  var preview = document.getElementById('preview');
  var statusEl = document.getElementById('status');
  var main = document.querySelector('main');

  function say(text, isError) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (isError ? ' error' : '');
  }

  function toJpeg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('encode')); }, 'image/jpeg', 0.9);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  input.addEventListener('change', function () {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    say('Preparing the photo…');
    toJpeg(file).then(function (blob) {
      preview.src = URL.createObjectURL(blob);
      preview.style.display = 'block';
      say('Sending to your computer…');
      return fetch(location.pathname.replace(/\\/$/, '') + '/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob
      });
    }).then(function (response) {
      if (response.status === 404) throw new Error('expired');
      if (!response.ok) {
        // Only MirrorCat's own replies are shown as-is; a dropped connection
        // ("Load failed", "Failed to fetch") gets the Wi-Fi hint instead.
        return response.text().then(function (t) {
          var e = new Error(t || 'failed');
          e.fromServer = true;
          throw e;
        });
      }
      main.classList.add('done');
      document.getElementById('steps').hidden = true;
      document.querySelector('.take-label').textContent = 'Take another photo';
      say('Sent. Look at your computer to use it.');
    }).catch(function (error) {
      var message = error && error.message;
      if (message === 'decode') say('That photo couldn’t be read. Try taking it again.', true);
      else if (message === 'expired') say('This scan link has expired. Start a new scan on your computer.', true);
      else if (error && error.fromServer && message !== 'failed' && message.length < 200) say(message, true);
      else say('Couldn’t send the photo. Check that your phone is on the same Wi-Fi as your computer, then try again.', true);
    });
  });
})();
</script>
</body>
</html>`
}

/** Shown for an unknown or expired link. Deliberately the same for both. */
export const EXPIRED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark">
<title>MirrorCat</title></head>
<body style="margin:0;background:#1d1a23;color:#e8e3d9;font:17px/1.5 -apple-system,system-ui,sans-serif">
<main style="max-width:30rem;margin:0 auto;padding:40px 22px">
<h1 style="font-size:22px;font-weight:600;margin:0 0 12px">This scan link isn’t active</h1>
<p style="color:#9d96a8;margin:0">Start a new scan in MirrorCat on your computer, then scan the new code.</p>
</main></body></html>`
