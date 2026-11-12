// Optional regression checks: node --test tests/playback.test.cjs
// Uses only Node built-ins; Node is not needed to run or deploy the player.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function setup(options = {}) {
  let time = 0;
  let nextId = 0;
  let playCalls = 0;
  const tasks = new Map();
  const document = { activeElement: { tagName: 'BODY' }, hidden: false, listeners: {}, baseURI: 'https://example.test/signage-poc/index.html' };
  const elements = {};
  function listen(type, callback) { (this.listeners[type] ||= []).push(callback); }
  function fire(type, values = {}) {
    const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...values };
    for (const callback of this.listeners[type] || []) callback(event);
    return event;
  }
  function element(id, tag, attributes = '') {
    return {
      id, tagName: tag.toUpperCase(), hidden: /\bhidden\b/.test(attributes),
      disabled: /\bdisabled\b/.test(attributes), listeners: {}, attrs: {}, style: {}, dataset: {}, textContent: '',
      classList: { values: new Set(['controls-visible']), add(value) { this.values.add(value); }, remove(value) { this.values.delete(value); }, contains(value) { return this.values.has(value); } },
      addEventListener: listen, fire,
      setAttribute(name, value) { this.attrs[name] = value; },
      getAttribute(name) { return name === 'src' ? this.src : this.attrs[name]; },
      focus() { document.activeElement = this; }, click() { this.fire('click'); },
      getClientRects() { return this.hidden || (id === 'start-button' && elements['status-panel'].hidden) || (id === 'close-diagnostics' && elements.diagnostics.hidden) || ((id === 'cache-retry-button' || id === 'stream-without-cache') && elements['initialization-actions'].hidden) ? [] : [{}]; }
    };
  }
  for (const match of html.matchAll(/<([a-z0-9-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    elements[match[3]] = element(match[3], match[1], match[2]);
  }
  const progress = element('progress', 'div');
  document.getElementById = id => elements[id];
  document.querySelector = () => progress;
  document.addEventListener = listen;
  document.fire = fire;
  elements.player.querySelectorAll = () => Object.values(elements).filter(item => item.tagName === 'BUTTON');
  if (options.requestFullscreen) elements.player.requestFullscreen = () => options.requestFullscreen(document);
  const video = elements.video;
  let src = '';
  Object.defineProperty(video, 'src', {
    get() { return src; },
    set(value) { src = value; this.error = null; this.currentTime = 0; this.readyState = 0; }
  });
  Object.assign(video, {
    currentTime: 0, duration: NaN, readyState: 0, networkState: 0, paused: true, ended: false,
    load() {}, pause() { this.paused = true; },
    play() { playCalls++; this.paused = false; return options.play ? options.play() : Promise.resolve(); }
  });
  function schedule(callback, delay, repeat = false) {
    const id = ++nextId;
    tasks.set(id, { at: time + delay, callback, repeat: repeat ? delay : 0 });
    return id;
  }
  const context = vm.createContext({
    document, window: { SignageMediaCache: options.mediaCache, SIGNAGE_PLAYLIST: Object.hasOwn(options, 'playlist') ? options.playlist : [{ title: 'One', src: 'assets/videos/one.mp4' }, { title: 'Two', src: 'assets/videos/two.mp4' }] },
    Date: class extends Date { static now() { return time; } },
    setTimeout: (cb, ms) => schedule(cb, ms), clearTimeout: id => tasks.delete(id),
    setInterval: (cb, ms) => schedule(cb, ms, true), clearInterval: id => tasks.delete(id), console
  });
  vm.runInContext(settingsSource, context);
  // Isolate controller tests from the user's editable preferences. Cache-specific
  // tests enable preparation explicitly; other tests exercise direct playback.
  context.window.SIGNAGE_SETTINGS = Object.assign({
    startMuted: false, fullscreenOnStart: true, hideControlsOnStart: true,
    showLogoAlways: true, showPlayerControlsButton: false, showAdNameAlways: false,
    cacheVideosBeforePlayback: false, cacheVideosInBackground: false
  }, options.settings);
  vm.runInContext(source, context);
  return {
    elements, document, video, progress,
    get state() { return elements.player.dataset.state; },
    get playCalls() { return playCalls; },
    tick(ms) {
      const end = time + ms;
      while (true) {
        const pending = [...tasks.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!pending) break;
        const [id, task] = pending;
        time = task.at;
        if (task.repeat) task.at += task.repeat;
        else tasks.delete(id);
        task.callback();
      }
      time = end;
    },
    playing() { video.paused = false; video.ended = false; video.readyState = 4; video.fire('playing'); },
    fail(code = 4) { video.error = { code }; video.fire('error'); },
    key(key) { return document.fire('keydown', { key }); }
  };
}

test('starts with sound by default, uses relative paths, advances in order, and loops', () => {
  const app = setup();
  assert.equal(app.video.muted, false);
  assert.equal(app.elements['sound-button'].textContent, 'Mute');
  assert.equal(app.elements['sound-button'].attrs['aria-pressed'], 'true');
  assert.equal(app.video.playsInline, true);
  assert.equal(app.video.src, 'assets/videos/one.mp4');
  app.playing();
  app.video.fire('ended');
  assert.equal(app.video.src, 'assets/videos/two.mp4');
  app.playing();
  app.video.fire('ended');
  assert.equal(app.video.src, 'assets/videos/one.mp4');
  assert.equal(app.playCalls, 3);
});

test('skips a missing file once and stops when the whole playlist fails', () => {
  const app = setup();
  app.fail();
  app.tick(3999);
  assert.equal(app.playCalls, 1);
  app.tick(1);
  assert.equal(app.video.src, 'assets/videos/two.mp4');
  app.fail();
  app.tick(200000);
  assert.equal(app.state, 'error');
  assert.equal(app.playCalls, 2);
  assert.match(app.elements['status-message'].textContent, /No playable videos remain/);
  app.elements['retry-button'].click();
  assert.equal(app.playCalls, 3);
  assert.equal(app.state, 'loading');
});

test('a healthy clip allows a new playlist pass after a missing clip', () => {
  const app = setup();
  app.fail(); app.tick(4000); app.playing(); app.video.fire('ended');
  app.fail(); app.tick(4000);
  assert.equal(app.video.src, 'assets/videos/two.mp4');
  assert.equal(app.state, 'loading');
});

test('a single missing clip stops without an automatic retry loop', () => {
  const app = setup({ playlist: [{ src: 'assets/videos/only.mp4' }] });
  app.fail(); app.tick(120000);
  assert.equal(app.playCalls, 1);
  app.elements['start-button'].click();
  assert.equal(app.playCalls, 2);
});

test('blocked autoplay focuses Start and waits for a user gesture', async () => {
  let blocked = true;
  const app = setup({ play: () => blocked ? Promise.reject({ name: 'NotAllowedError', message: 'Gesture required' }) : Promise.resolve() });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.state, 'blocked');
  assert.equal(app.document.activeElement.id, 'start-button');
  app.tick(120000);
  assert.equal(app.playCalls, 1);
  blocked = false;
  app.elements['start-button'].click(); app.playing();
  assert.equal(app.state, 'playing');
});

test('late rejection from a replaced source cannot interrupt the next clip', async () => {
  let rejectFirst;
  let count = 0;
  const app = setup({ play: () => ++count === 1 ? new Promise((_, reject) => { rejectFirst = reject; }) : Promise.resolve() });
  app.elements['next-button'].click(); app.playing();
  rejectFirst({ name: 'NotSupportedError' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.state, 'playing');
  assert.equal(app.video.src, 'assets/videos/two.mp4');
});

test('repeated stall events cannot extend the progress timeout', () => {
  const app = setup();
  app.playing(); app.tick(10000); app.video.fire('waiting');
  app.tick(5000); app.video.fire('stalled'); app.tick(5000);
  assert.equal(app.state, 'error');
  assert.match(app.elements['status-message'].textContent, /20 seconds/);
  app.tick(4000);
  assert.equal(app.video.src, 'assets/videos/two.mp4');
});

test('time progress recovers buffering and refreshes the watchdog', () => {
  const app = setup();
  app.playing(); app.tick(15000); app.video.fire('waiting');
  app.video.currentTime = 3; app.video.duration = 10; app.video.fire('timeupdate');
  assert.equal(app.state, 'playing');
  assert.equal(app.progress.attrs['aria-valuenow'], '30');
  app.tick(4500);
  assert.equal(app.elements.player.classList.contains('controls-visible'), false);
  app.tick(14500);
  assert.equal(app.state, 'playing');
});

test('intentional pause never times out and Resume keeps the position', () => {
  const app = setup();
  app.playing(); app.video.currentTime = 5; app.elements['pause-button'].click();
  app.tick(120000);
  assert.equal(app.state, 'paused');
  app.elements['pause-button'].click(); app.playing();
  assert.equal(app.video.currentTime, 5);
  assert.equal(app.playCalls, 2);
});

test('remote arrows reveal controls, diagnostics toggles, and Escape closes it', () => {
  const app = setup();
  app.playing(); app.tick(4500);
  assert.equal(app.elements.player.classList.contains('controls-visible'), false);
  app.key('ArrowRight');
  assert.equal(app.document.activeElement.id, 'pause-button');
  assert.equal(app.elements.player.classList.contains('controls-visible'), true);
  app.key('D');
  assert.equal(app.elements.diagnostics.hidden, false);
  assert.equal(app.elements['diag-file'].textContent, 'assets/videos/one.mp4');
  app.key('Escape');
  assert.equal(app.elements.diagnostics.hidden, true);
});

test('unsupported fullscreen displays a helpful fallback', () => {
  const app = setup();
  app.elements['fullscreen-button'].click();
  assert.equal(app.elements.notice.hidden, false);
  assert.match(app.elements.notice.textContent, /Fullscreen is unavailable/);
});

test('declined fullscreen is handled without an unhandled rejection', async () => {
  const app = setup();
  app.elements.player.requestFullscreen = () => Promise.reject(new Error('Permission denied'));
  app.elements['fullscreen-button'].click();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.elements.notice.textContent, /Fullscreen is unavailable/);
});

test('invalid and empty configuration remains operable without media requests', () => {
  for (const playlist of [undefined, [], [null], [{ src: '/root.mp4' }], [{ src: '../outside.mp4' }]]) {
    const app = setup({ playlist });
    assert.equal(app.state, 'empty');
    assert.equal(app.playCalls, 0);
    assert.equal(app.elements['start-button'].disabled, true);
    app.key('D');
    assert.equal(app.elements.diagnostics.hidden, false);
  }
});

test('Next cancels pending automatic recovery and preserves user mute choice', () => {
  const app = setup({ settings: { startMuted: true, fullscreenOnStart: false } });
  app.fail(); app.elements['sound-button'].click(); app.elements['next-button'].click();
  app.tick(4000);
  assert.equal(app.playCalls, 2);
  assert.equal(app.video.src, 'assets/videos/two.mp4');
  assert.equal(app.video.muted, false);
});

test('muted startup and disabling automatic fullscreen are configurable', () => {
  let requests = 0;
  const app = setup({ settings: { startMuted: true, fullscreenOnStart: false }, requestFullscreen: () => { requests++; return Promise.resolve(); } });
  assert.equal(app.video.muted, true);
  assert.equal(app.video.defaultMuted, true);
  assert.equal(app.elements['sound-button'].textContent, 'Unmute');
  assert.equal(requests, 0);
  app.elements['start-button'].click();
  assert.equal(requests, 0);
  app.elements['fullscreen-button'].click();
  assert.equal(requests, 1);
});

test('default fullscreen is requested on launch and retried with Start', async () => {
  let requests = 0;
  const app = setup({ requestFullscreen: () => { requests++; return requests === 1 ? Promise.reject(new Error('User gesture required')) : Promise.resolve(); } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.equal(app.state, 'loading');
  assert.equal(app.video.muted, false);
  assert.match(app.elements.notice.textContent, /button press/);
  app.elements['start-button'].click();
  assert.equal(requests, 2);
  app.playing(); app.video.fire('ended');
  assert.equal(requests, 2, 'clip changes must not repeatedly request fullscreen');
});

test('Start does not exit fullscreen if the player is already fullscreen', () => {
  let requests = 0;
  const app = setup({ requestFullscreen: document => { requests++; document.fullscreenElement = {}; return Promise.resolve(); } });
  app.elements['start-button'].click();
  assert.equal(requests, 1);
});

test('sound preference survives permission rejection, Start, and clip transitions', async () => {
  let blocked = true;
  const app = setup({ play: () => blocked ? Promise.reject({ name: 'NotAllowedError' }) : Promise.resolve() });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.state, 'blocked');
  assert.equal(app.video.muted, false);
  blocked = false;
  app.elements['start-button'].click(); app.playing(); app.video.fire('ended');
  assert.equal(app.video.muted, false);
});

test('missing or malformed settings use sound-on and fullscreen-on defaults', () => {
  for (const settings of [undefined, null, {}, { startMuted: 'true', fullscreenOnStart: 'false' }]) {
    let requests = 0;
    const app = setup({ settings, requestFullscreen: () => { requests++; return Promise.resolve(); } });
    assert.equal(app.video.muted, false);
    assert.equal(requests, 1);
  }
});

test('hidden controls ignore pointer movement and background events and reveal on any key', () => {
  for (const key of ['x', 'Shift', 'Tab', 'Escape', 'Enter', 'ArrowRight']) {
    const app = setup();
    assert.equal(app.elements.player.classList.contains('controls-visible'), false);
    app.playing();
    app.elements.player.fire('mousemove');
    app.elements.player.fire('touchstart');
    app.document.fire('visibilitychange');
    app.document.fire('fullscreenchange');
    app.video.fire('waiting');
    assert.equal(app.elements.player.classList.contains('controls-visible'), false);
    app.key(key);
    assert.equal(app.elements.player.classList.contains('controls-visible'), true, key);
  }
});

test('manual hiding closes diagnostics, moves focus, and survives video transitions', () => {
  const app = setup();
  app.playing(); app.key('D');
  assert.equal(app.elements.diagnostics.hidden, false);
  app.elements['hide-controls'].click();
  assert.equal(app.elements.diagnostics.hidden, true);
  assert.equal(app.document.activeElement.id, 'video');
  assert.equal(app.elements.player.classList.contains('controls-visible'), false);
  app.video.fire('ended'); app.playing();
  assert.equal(app.elements.player.classList.contains('controls-visible'), false);
  app.key('x');
  app.elements['pause-button'].click();
  app.elements['hide-controls'].click();
  assert.equal(app.state, 'paused');
  assert.equal(app.elements.player.classList.contains('controls-visible'), false);
});

test('controls auto-hide and reveal on player clicks while ignoring mouse movement', () => {
  const app = setup({ settings: { hideControlsOnStart: false } });
  assert.equal(app.elements.player.classList.contains('controls-visible'), true);
  app.playing(); app.tick(4500);
  assert.equal(app.elements.player.classList.contains('controls-visible'), false);
  app.elements.player.fire('mousemove');
  assert.equal(app.elements.player.classList.contains('controls-visible'), false);
  app.elements.player.fire('click', { target: app.video });
  assert.equal(app.elements.player.classList.contains('controls-visible'), true);
  assert.equal(app.state, 'playing');
  app.elements['hide-controls'].click();
  app.elements.player.fire('click', { target: app.elements['hide-controls'] });
  assert.equal(app.elements.player.classList.contains('controls-visible'), false);
  app.elements.player.fire('click', { target: { tagName: 'SPAN', parentElement: app.elements['hide-controls'] } });
  assert.equal(app.elements.player.classList.contains('controls-visible'), false);
  app.elements.player.fire('click');
  assert.equal(app.elements.player.classList.contains('controls-visible'), true);
});

test('logo and floating controls button settings can be toggled during playback', () => {
  const app = setup();
  assert.equal(app.elements.player.classList.contains('logo-always'), true);
  assert.equal(app.elements['show-controls'].hidden, true);
  app.key('x');
  app.elements['logo-button'].click();
  assert.equal(app.elements.player.classList.contains('logo-always'), false);
  assert.equal(app.elements['logo-button'].attrs['aria-pressed'], 'false');
  app.elements['controls-button-toggle'].click();
  assert.equal(app.elements['show-controls'].hidden, false);
  app.elements['hide-controls'].click();
  app.elements['show-controls'].click();
  assert.equal(app.elements.player.classList.contains('controls-visible'), true);
  app.elements['controls-button-toggle'].click();
  assert.equal(app.elements['show-controls'].hidden, true);
});

test('persistent ad name follows the configured preference and current video', () => {
  const app = setup({ settings: { showLogoAlways: false, showPlayerControlsButton: true, showAdNameAlways: true } });
  assert.equal(app.elements.player.classList.contains('logo-always'), false);
  assert.equal(app.elements['show-controls'].hidden, false);
  assert.equal(app.elements['persistent-ad-name'].hidden, false);
  assert.equal(app.elements['persistent-ad-name'].textContent, 'One');
  assert.equal(app.elements['ad-name-button'].textContent, 'Ad name always: On');
  assert.equal(app.elements['ad-name-button'].attrs['aria-pressed'], 'true');
  app.key('x'); app.elements['ad-name-button'].click();
  assert.equal(app.elements['persistent-ad-name'].hidden, true);
  assert.equal(app.elements['ad-name-button'].attrs['aria-pressed'], 'false');
  app.elements['ad-name-button'].click(); app.elements['hide-controls'].click();
  assert.equal(app.elements['persistent-ad-name'].hidden, false);
  app.playing(); app.video.fire('ended');
  assert.equal(app.elements['persistent-ad-name'].textContent, 'Two');
  assert.equal(app.elements['persistent-ad-name'].hidden, false);
  assert.equal(setup().elements['persistent-ad-name'].hidden, true);
});

test('cache mode shows the TV initialization screen and waits for the whole playlist', async () => {
  let finish;
  let report;
  let sourceRequests = 0;
  const app = setup({ settings:{playbackMode:'cache-first',cacheVideosBeforePlayback:false,cacheVideosInBackground:true},mediaCache:{create:()=>({
    prepare:(_,progress)=>{report=progress;return new Promise(resolve=>{finish=resolve;});},
    getSource:async()=>{sourceRequests++;return {url:'blob:one',release(){}};}
  })}});
  assert.equal(app.state,'initializing');
  assert.equal(app.playCalls,0);
  assert.equal(app.elements['initialization-screen'].hidden,false);
  assert.equal(app.elements['initialization-brand'].hidden,false);
  assert.equal(app.elements['start-button'].hidden,true);
  assert.equal(app.elements['next-button'].disabled,true);
  report({completed:0,total:2,title:'One',loaded:5,totalBytes:10});
  assert.equal(app.elements['cache-progress'].attrs.value,'25');
  assert.match(app.elements['status-title'].textContent,/Initializing stream/);
  app.tick(120000);
  assert.equal(app.state,'initializing','playback watchdog must not interrupt initialization');
  app.video.error={code:4};app.video.fire('error');
  assert.equal(app.state,'initializing','old video errors must not interrupt initialization');
  app.elements['start-button'].click();
  assert.equal(sourceRequests,0);
  finish(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.video.src,'blob:one');
  assert.equal(app.playCalls,1);
  assert.equal(app.elements['initialization-screen'].hidden,true);
});

test('cache preparation failure is bounded, retryable, and never silently streams', async () => {
  let attempts=0;
  const app = setup({settings:{cacheVideosBeforePlayback:true},mediaCache:{create:()=>({
    prepare:()=>++attempts===1?Promise.reject(new Error('Connection lost')):Promise.resolve(),
    getSource:async()=>({url:'blob:one',release(){}})
  })}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.state,'cache-error');
  assert.equal(app.playCalls,0);
  assert.equal(app.elements['initialization-actions'].hidden,false);
  assert.equal(app.document.activeElement.id,'cache-retry-button');
  app.tick(120000);
  assert.equal(attempts,1);
  app.elements['cache-retry-button'].click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.video.src,'blob:one');
  assert.equal(app.playCalls,1);
});

test('unsupported preparation offers an explicit direct-playback fallback', () => {
  const app=setup({settings:{cacheVideosBeforePlayback:true}});
  assert.equal(app.state,'cache-error');
  assert.equal(app.playCalls,0);
  app.elements['stream-without-cache'].click();
  assert.equal(app.video.src,'assets/videos/one.mp4');
  assert.equal(app.playCalls,1);
  assert.match(app.elements['diag-cache'].textContent,/preparation skipped/);
});

test('local source transitions release previous and stale Blob URLs', async () => {
  const releases=[];
  const sources=[];
  const app=setup({settings:{cacheVideosBeforePlayback:true},mediaCache:{create:()=>({
    prepare:async()=>{},getSource:()=>new Promise(resolve=>sources.push(resolve))
  })}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.state,'preparing');
  app.elements['next-button'].click();
  sources[0]({url:'blob:stale',release:()=>releases.push('stale')});
  sources[1]({url:'blob:two',release:()=>releases.push('two')});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.video.src,'blob:two');
  assert.deepEqual(releases,['stale']);
  app.playing();app.video.fire('ended');
  sources[2]({url:'blob:one',release:()=>releases.push('one')});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.video.src,'blob:one');
  assert.deepEqual(releases,['stale','two']);
});

test('evicted local media returns to initialization recovery instead of freezing', async () => {
  const app=setup({settings:{cacheVideosBeforePlayback:true},mediaCache:{create:()=>({
    prepare:async()=>{},getSource:async()=>{throw new Error('Stored video unavailable');}
  })}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.state,'cache-error');
  assert.match(app.elements['status-message'].textContent,/Stored video unavailable/);
  assert.equal(app.playCalls,0);
});

test('background mode streams the first video after the startup interval without waiting for cache', async () => {
  let prepareCalls=0;
  let queued;
  let preparationOptions;
  const app=setup({settings:{playbackMode:'stream',cacheVideosBeforePlayback:true,cacheVideosInBackground:false,streamStartupDelaySeconds:3},mediaCache:{create:()=>({
    getSource:async()=>null,
    prepare:(items,_,options)=>{prepareCalls++;queued=items;preparationOptions=options;return new Promise(()=>{});}
  })}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.state,'initializing');
  assert.equal(app.playCalls,0);
  assert.match(app.elements['cache-progress-label'].textContent,/3 seconds/);
  app.tick(2999);
  assert.equal(app.playCalls,0);
  app.tick(1);
  assert.equal(app.video.src,'assets/videos/one.mp4');
  assert.equal(app.playCalls,1);
  assert.equal(app.elements['initialization-screen'].hidden,true);
  assert.equal(prepareCalls,1);
  assert.equal(queued[0].src,'assets/videos/two.mp4');
  assert.equal(preparationOptions.shouldDefer('assets/videos/one.mp4'),true);
  assert.equal(preparationOptions.shouldDefer('assets/videos/two.mp4'),false);
});

test('a warm visit plays the cached first video without the startup interval', async () => {
  const app=setup({settings:{cacheVideosInBackground:true,streamStartupDelaySeconds:10},mediaCache:{create:()=>({
    getSource:async()=>({url:'blob:first',release(){}}),prepare:async()=>({completed:2,total:2,deferred:[],errors:[]})
  })}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.video.src,'blob:first');
  assert.equal(app.playCalls,1);
  app.tick(10000);
  assert.equal(app.playCalls,1);
});

test('startup countdown honors configured delays above thirty seconds', () => {
  for (const seconds of [60,120]) {
    const app=setup({settings:{playbackMode:'stream',streamStartupDelaySeconds:seconds},mediaCache:{create:()=>({
      getSource:async()=>null,prepare:()=>new Promise(()=>{})
    })}});
    assert.match(app.elements['cache-progress-label'].textContent,new RegExp(seconds+' seconds'));
    app.tick(30000);
    assert.equal(app.state,'initializing');
    assert.equal(app.playCalls,0);
    app.tick(seconds*1000-30001);
    assert.equal(app.playCalls,0);
    app.tick(1);
    assert.equal(app.playCalls,1);
    assert.equal(app.video.src,'assets/videos/one.mp4');
  }
});

test('background cache completion never restarts active streaming and later clips use local copies', async () => {
  let finish;
  let cached=false;
  const app=setup({settings:{cacheVideosInBackground:true,streamStartupDelaySeconds:0},mediaCache:{create:()=>({
    getSource:async src=>cached?{url:'blob:'+src,release(){}}:null,
    prepare:()=>new Promise(resolve=>{finish=resolve;})
  })}});
  app.tick(0);app.playing();
  cached=true;finish({completed:2,total:2,deferred:[],errors:[]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.video.src,'assets/videos/one.mp4');
  assert.equal(app.state,'playing');
  assert.equal(app.playCalls,1);
  app.video.fire('ended');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.video.src,'blob:assets/videos/two.mp4');
  assert.equal(app.playCalls,2);
});

test('background storage failure leaves streaming active and already cached clips usable', async () => {
  const app=setup({settings:{cacheVideosInBackground:true,streamStartupDelaySeconds:0},mediaCache:{create:()=>({
    getSource:async src=>src.endsWith('two.mp4')?{url:'blob:two',release(){}}:null,
    prepare:async()=>{throw new Error('Storage full');}
  })}});
  app.tick(0);app.playing();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.state,'playing');
  assert.equal(app.elements['initialization-screen'].hidden,true);
  assert.match(app.elements['diag-cache'].textContent,/paused/);
  app.video.fire('ended');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.video.src,'blob:two');
});

test('unsupported cache does not prevent first-video streaming after the heads-up', () => {
  const app=setup({settings:{cacheVideosInBackground:true,streamStartupDelaySeconds:1}});
  assert.equal(app.state,'initializing');
  app.tick(1000);
  assert.equal(app.video.src,'assets/videos/one.mp4');
  assert.equal(app.playCalls,1);
  assert.match(app.elements['diag-cache'].textContent,/Network stream/);
});

test('late startup cache probes are released without replacing the active network video', async () => {
  let deliver;
  let released=0;
  const app=setup({settings:{cacheVideosInBackground:true,streamStartupDelaySeconds:1},mediaCache:{create:()=>({
    getSource:()=>new Promise(resolve=>{deliver=resolve;}),prepare:()=>new Promise(()=>{})
  })}});
  app.tick(1000);
  deliver({url:'blob:late',release:()=>{released++;}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.video.src,'assets/videos/one.mp4');
  assert.equal(app.playCalls,1);
  assert.equal(released,1);
});

test('slow transition cache lookups fall back to streaming and release late Blob URLs', async () => {
  let deliver;
  let released=0;
  let lookups=0;
  const app=setup({settings:{cacheVideosInBackground:true,streamStartupDelaySeconds:0},mediaCache:{create:()=>({
    getSource:()=>++lookups===1?Promise.resolve(null):new Promise(resolve=>{deliver=resolve;}),
    prepare:()=>new Promise(()=>{})
  })}});
  app.tick(0);app.playing();app.video.fire('ended');
  app.tick(1500);
  assert.equal(app.video.src,'assets/videos/two.mp4');
  deliver({url:'blob:late-two',release:()=>{released++;}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.video.src,'assets/videos/two.mp4');
  assert.equal(released,1);
});

test('a one-video playlist is eligible for caching after its first streamed pass', async () => {
  const decisions=[];
  const app=setup({playlist:[{src:'assets/videos/only.mp4'}],settings:{cacheVideosInBackground:true,streamStartupDelaySeconds:0},mediaCache:{create:()=>({
    getSource:async()=>null,
    prepare:async(items,_,options)=>{
      const deferred=options.shouldDefer(items[0].src);decisions.push(deferred);
      return {completed:deferred?0:1,total:1,deferred:deferred?[items[0].src]:[],errors:[]};
    }
  })}});
  app.tick(0);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(decisions,[true]);
  app.playing();app.video.fire('ended');
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(decisions,[true,false]);
});

test('direct mode bypasses storage and countdown even when legacy cache flags are enabled', () => {
  let cacheCalls=0;
  const app=setup({settings:{playbackMode:'direct',cacheVideosBeforePlayback:true,cacheVideosInBackground:true,streamStartupDelaySeconds:30},mediaCache:{create:()=>{cacheCalls++;throw new Error('Storage should not be used');}}});
  assert.equal(app.playCalls,1);
  assert.equal(app.video.src,'assets/videos/one.mp4');
  assert.equal(cacheCalls,0);
  assert.equal(app.elements['initialization-screen'].hidden,true);
  assert.match(app.elements['diag-cache'].textContent,/Direct mode/);
});

test('invalid playback modes show a settings error without media or cache requests', () => {
  for (const playbackMode of ['', 'unknown', null, false]) {
    const app=setup({settings:{playbackMode}});
    assert.equal(app.state,'empty');
    assert.equal(app.playCalls,0);
    assert.equal(app.elements['start-button'].disabled,true);
    assert.match(app.elements['status-message'].textContent,/Invalid playbackMode/);
  }
});

test('disabling the custom cache uses normal video URLs for startup, progression, and retry', () => {
  let cacheCalls=0;
  const app=setup({settings:{enableVideoCache:false,playbackMode:'cache-first',streamStartupDelaySeconds:60},mediaCache:{create:()=>{cacheCalls++;throw new Error('Custom cache must not be used');}}});
  assert.equal(app.playCalls,1);
  assert.equal(app.video.src,'assets/videos/one.mp4');
  assert.equal(app.elements['initialization-screen'].hidden,true);
  assert.match(app.elements['diag-cache'].textContent,/Browser-managed playback/);
  app.playing();app.video.fire('ended');
  assert.equal(app.video.src,'assets/videos/two.mp4');
  app.elements['retry-button'].click();
  assert.equal(app.video.src,'assets/videos/two.mp4');
  assert.equal(cacheCalls,0);
});

test('reenabling the custom cache honors the configured cache-first strategy', async () => {
  let finish;
  const app=setup({settings:{enableVideoCache:true,playbackMode:'cache-first'},mediaCache:{create:()=>({
    prepare:()=>new Promise(resolve=>{finish=resolve;}),getSource:async()=>({url:'blob:prepared',release(){}})
  })}});
  assert.equal(app.state,'initializing');
  assert.equal(app.playCalls,0);
  finish();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.video.src,'blob:prepared');
  assert.equal(app.playCalls,1);
});

test('an inactive cache mode does not prevent normal playback when custom caching is disabled', () => {
  const app=setup({settings:{enableVideoCache:false,playbackMode:'unused-mode'}});
  assert.equal(app.state,'loading');
  assert.equal(app.playCalls,1);
});
