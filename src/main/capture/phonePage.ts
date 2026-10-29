/**
 * The page the phone opens from the QR code. Self-contained (no external
 * requests), locked down by a per-response nonce CSP, and lit like the
 * editor ("lights down").
 *
 * Cat's eyes lead: big, glowing, and they talk you through it. Each
 * instruction is something Cat says; as each line lands the eyes squint
 * and glance where it matters. They look about while the photo sends,
 * smile when it's in, and widen when something goes wrong. One short
 * sequence on load; still after that apart from a blink. Reduced motion
 * gets everything at once.
 *
 * The photo itself: a file input opens the phone's camera (works over
 * plain http, unlike getUserMedia); the photo is redrawn to a JPEG of at
 * most 4096 px -- which also converts iPhone HEIC and applies its rotation
 * -- and posted back to the same URL + "/photo".
 */

/** Cat's eyes, the same shapes as the editor's (24×12 units), with a smile for "done". */
const EYES = `<svg class="eyes" viewBox="-1 -3 26 18" aria-hidden="true">
  <g transform="rotate(-14 5.5 6)"><g class="eye eye-l">
    <path class="iris" d="M0.8 6 Q5.5 -2.6 10.2 6 Q5.5 14.6 0.8 6 Z"/>
    <ellipse class="pupil" cx="5.5" cy="6" rx="1" ry="3.4"/>
    <path class="smile" d="M1.6 7.4 Q5.5 2 9.4 7.4"/>
  </g></g>
  <g transform="rotate(14 18.5 6)"><g class="eye eye-r">
    <path class="iris" d="M13.8 6 Q18.5 -2.6 23.2 6 Q18.5 14.6 13.8 6 Z"/>
    <ellipse class="pupil" cx="18.5" cy="6" rx="1" ry="3.4"/>
    <path class="smile" d="M14.6 7.4 Q18.5 2 22.4 7.4"/>
  </g></g>
</svg>`

export function phonePageHtml(nonce: string, { frameShown = false } = {}): string {
  // Each line: what Cat says, and where the eyes glance while saying it.
  const lines: { html: string; look: string }[] = [
    { html: 'Hi, I’m Cat. Let’s take a photo of your wall.', look: 'ahead' },
    { html: 'Stand <strong>right next to the projector</strong>, so you see what it sees.', look: 'side' },
    { html: 'Use the <strong>1× lens</strong> and hold your phone level.', look: 'down' },
    frameShown
      ? { html: 'Fit my <strong>whole glowing frame</strong> in the picture.', look: 'up' }
      : { html: 'Get the <strong>whole thing</strong> in the picture.', look: 'up' }
  ]
  const said = lines
    .map((l) => `<p class="line" data-look="${l.look}">${l.html}</p>`)
    .join('\n    ')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#1d1a23">
<title>Cat’s camera · MirrorCat</title>
<style nonce="${nonce}">
  :root { --room:#1d1a23; --wall:#26232e; --plaster:#e8e3d9; --dusk:#9d96a8; --alert:#f2877a;
    --cyan:#5fe7d6; --magenta:#ff5fa0; --ease:cubic-bezier(.3,.7,.2,1); }
  * { box-sizing:border-box; }
  html, body { margin:0; min-height:100%; background:var(--room); color:var(--plaster);
    font:17px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing:antialiased; -webkit-tap-highlight-color:transparent; }
  main { max-width:28rem; min-height:100svh; margin:0 auto; display:flex; flex-direction:column;
    padding:max(36px, env(safe-area-inset-top)) 24px max(28px, env(safe-area-inset-bottom)); }

  /* The eyes: the only bright thing on the page, like eyeshine in a dark room. */
  .cat { display:block; width:min(72vw, 300px); margin:8px auto 34px; padding:0; border:0; background:none; }
  .eyes { display:block; width:100%; height:auto; overflow:visible; }
  .eye { transform-box:fill-box; transform-origin:center; transition:transform .35s var(--ease); }
  .eye-l { --eye:var(--cyan); }
  .eye-r { --eye:var(--magenta); }
  .iris { fill:var(--eye); filter:drop-shadow(0 0 1.2px var(--eye)) drop-shadow(0 0 4px color-mix(in srgb, var(--eye) 55%, transparent));
    transition:opacity .25s; }
  .pupil { fill:var(--room); transform-box:fill-box; transform-origin:center;
    transition:transform .45s var(--ease); transform:translate(var(--px,0), var(--py,0)) scale(var(--pw,1), 1); }
  .smile { fill:none; stroke:var(--eye); stroke-width:1.5; stroke-linecap:round; opacity:0;
    filter:drop-shadow(0 0 2px var(--eye)); transition:opacity .25s; }

  /* Where the eyes look (set per line, and by state). */
  .cat[data-look="side"] { --px:2.4px; --py:.3px; }
  .cat[data-look="down"] { --px:0px; --py:1.6px; }
  .cat[data-look="up"] { --px:0px; --py:-1.6px; }
  .cat.talk .eye { animation:squint .32s var(--ease); }
  .cat.sending { --pw:1.7; }
  .cat.sending .pupil { animation:dart 1.4s ease-in-out infinite; }
  .cat.happy .iris, .cat.happy .pupil { opacity:0; }
  .cat.happy .smile { opacity:1; }
  .cat.worried { --pw:.6; }
  .cat.worried .eye-l { transform:rotate(10deg); }
  .cat.worried .eye-r { transform:rotate(-10deg); }

  @keyframes squint { 40% { transform:scaleY(.55); } }
  @keyframes dart { 0%,100% { transform:translate(-1.8px,0) scale(1.7,1); } 50% { transform:translate(1.8px,0) scale(1.7,1); } }
  @keyframes blink { 0%,94%,100% { transform:scaleY(1); } 97% { transform:scaleY(.08); } }
  .cat.idle .eye { animation:blink 5s ease-in-out infinite; }
  .cat.idle .eye-r { animation-delay:.06s; }

  /* What Cat says. */
  .said { display:flex; flex-direction:column; gap:14px; margin:0 0 28px; }
  .line { margin:0; font-size:21px; line-height:1.35; letter-spacing:-.01em; color:var(--dusk); }
  .line strong { color:var(--plaster); font-weight:600; }
  .line:first-child { color:var(--plaster); font-size:24px; font-weight:600; letter-spacing:-.02em; }
  .js .line { opacity:0; transform:translateY(6px); transition:opacity .35s var(--ease), transform .35s var(--ease); }
  .js .line.on { opacity:1; transform:none; }

  .reply { min-height:1.4em; margin:0 0 18px; font-size:21px; line-height:1.35; font-weight:600; letter-spacing:-.01em; }
  .reply:empty { display:none; }
  .reply.error { color:var(--alert); font-weight:500; }
  .preview { display:none; width:100%; margin:0 0 18px; border-radius:14px; background:#000; }

  .take { position:relative; margin-top:auto; display:flex; align-items:center; justify-content:center; gap:10px;
    height:62px; border-radius:31px; background:var(--plaster); color:var(--room); font-weight:600; font-size:18px; }
  .take input { position:absolute; inset:0; opacity:0; width:100%; height:100%; }
  .take:active { transform:scale(.985); }
  .take:focus-within { outline:3px solid var(--cyan); outline-offset:3px; }
  [hidden] { display:none !important; }

  @media (prefers-reduced-motion: reduce) {
    .js .line { opacity:1; transform:none; transition:none; }
    .cat .eye, .cat .pupil { animation:none !important; transition:none; }
  }
</style>
</head>
<body>
<main>
  <button class="cat idle" id="cat" type="button" aria-label="Cat. Tap to hear that again.">${EYES}</button>
  <div class="said" id="said">
    ${said}
  </div>
  <img id="preview" class="preview" alt="The photo you took">
  <p class="reply" id="reply" role="status" aria-live="polite"></p>
  <label class="take" id="take">
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="2"/></svg>
    <span class="take-label">Take photo</span>
    <input id="file" type="file" accept="image/*" capture="environment">
  </label>
</main>
<script nonce="${nonce}">
(function () {
  var MAX_EDGE = 4096;
  var STEP_MS = 900;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var input = document.getElementById('file');
  var preview = document.getElementById('preview');
  var reply = document.getElementById('reply');
  var cat = document.getElementById('cat');
  var said = document.getElementById('said');
  var lines = Array.prototype.slice.call(document.querySelectorAll('.line'));
  var timers = [];
  document.documentElement.classList.add('js');

  /** Eyes: a mood (idle, sending, happy, worried) and where they look. */
  function mood(name, look) {
    cat.className = 'cat ' + name;
    cat.setAttribute('data-look', look || 'ahead');
  }

  /** A little squint, as if saying something. */
  function talk() {
    if (reduced) return;
    cat.classList.remove('talk');
    void cat.getBoundingClientRect();
    cat.classList.add('talk');
  }

  /** Cat says the instructions, one line at a time. */
  function introduce() {
    timers.forEach(clearTimeout);
    timers = [];
    lines.forEach(function (l) { l.classList.toggle('on', reduced); });
    if (reduced) return;
    lines.forEach(function (line, i) {
      timers.push(setTimeout(function () {
        line.classList.add('on');
        mood('idle', line.getAttribute('data-look'));
        talk();
      }, 250 + i * STEP_MS));
    });
    timers.push(setTimeout(function () { mood('idle', 'ahead'); }, 250 + lines.length * STEP_MS + 600));
  }

  function say(text, state) {
    reply.textContent = text;
    reply.className = 'reply' + (state === 'worried' ? ' error' : '');
    mood(state === 'worried' ? 'worried' : state === 'happy' ? 'happy' : state === 'sending' ? 'sending' : 'idle');
    if (state !== 'sending') talk();
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

  cat.addEventListener('click', function () {
    if (!said.hidden) introduce();
    else talk();
  });

  input.addEventListener('change', function () {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    timers.forEach(clearTimeout);
    say('Ooh, let me look…', 'sending');
    toJpeg(file).then(function (blob) {
      if (preview.src) URL.revokeObjectURL(preview.src);
      preview.src = URL.createObjectURL(blob);
      preview.style.display = 'block';
      said.hidden = true;
      say('Sending it to your computer…', 'sending');
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
      document.querySelector('.take-label').textContent = 'Take another photo';
      say('Got it! Look at your computer to use it.', 'happy');
    }).catch(function (error) {
      var message = error && error.message;
      if (message === 'decode') say('I couldn’t read that photo. Try taking it again.', 'worried');
      else if (message === 'expired') say('This scan link has expired. Start a new scan on your computer.', 'worried');
      else if (error && error.fromServer && message !== 'failed' && message.length < 200) say(message, 'worried');
      else say('I couldn’t send the photo. Check that your phone is on the same Wi-Fi as your computer, then try again.', 'worried');
    });
  });

  introduce();
})();
</script>
</body>
</html>`
}

/** Shown for an unknown or expired link. Deliberately the same for both. Cat's eyes are shut. */
export const EXPIRED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark">
<title>MirrorCat</title></head>
<body style="margin:0;background:#1d1a23;color:#e8e3d9;font:17px/1.45 -apple-system,system-ui,sans-serif">
<main style="max-width:28rem;margin:0 auto;padding:48px 24px">
<svg viewBox="0 0 24 12" width="180" style="display:block;margin:0 auto 32px;overflow:visible" aria-hidden="true">
<path d="M1.5 7 Q5.5 9.5 9.5 5.8" fill="none" stroke="#5fe7d6" stroke-width="1.3" stroke-linecap="round"/>
<path d="M14.5 5.8 Q18.5 9.5 22.5 7" fill="none" stroke="#ff5fa0" stroke-width="1.3" stroke-linecap="round"/></svg>
<h1 style="font-size:24px;font-weight:600;letter-spacing:-.02em;margin:0 0 12px">This scan link has gone to sleep</h1>
<p style="color:#9d96a8;font-size:19px;margin:0">Start a new scan in MirrorCat on your computer, then point your camera at the new code.</p>
</main></body></html>`
