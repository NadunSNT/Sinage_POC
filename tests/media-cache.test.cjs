// Optional tests: node --test tests/*.test.cjs (Node built-ins only).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'media-cache.js'), 'utf8');
const playlist = [{ title: 'One', src: 'assets/videos/one.mp4' }, { title: 'Two', src: 'assets/videos/two.mp4' }];

function environment(options = {}) {
  const stores = new Map();
  const requests = [];
  const createdUrls = [];
  const revokedUrls = [];
  const progress = [];
  let allowNetwork = true;
  let fetchImpl = options.fetch;
  const key = value => typeof value === 'string' ? value : value.url;
  const caches = {
    async open(name) {
      if (options.openError) throw options.openError;
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async keys() { return [...entries.keys()].map(url => new Request(url)); },
        async match(request) { return entries.get(key(request))?.clone(); },
        async delete(request) { return entries.delete(key(request)); },
        async put(request, response) {
          if (options.putError) throw options.putError;
          entries.set(key(request), response.clone());
        }
      };
    }
  };
  class LocalURL extends URL {
    static createObjectURL(blob) { createdUrls.push(blob); return 'blob:local-' + createdUrls.length; }
    static revokeObjectURL(url) { revokedUrls.push(url); }
  }
  const window = {
    caches: options.unsupported ? undefined : caches,
    async fetch(url, init) {
      requests.push({ url, init });
      if (!allowNetwork) throw new TypeError('Network disabled');
      if (fetchImpl) return fetchImpl(url, init);
      return new Response('test-video-bytes', { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '16' } });
    }
  };
  const context = vm.createContext({ window, document: { baseURI: 'https://example.test/signage-poc/index.html' }, URL: LocalURL, Request, Response, Blob, AbortController, setTimeout, clearTimeout });
  vm.runInContext(source, context);
  return {
    stores, caches, requests, progress, createdUrls, revokedUrls,
    factory: window.SignageMediaCache,
    create(extra = {}) { return window.SignageMediaCache.create({ timeoutMs: 1000, ...extra }); },
    report: event => progress.push(event),
    network(value) { allowNetwork = value; },
    setFetch(value) { fetchImpl = value; }
  };
}

test('prepares full relative-path videos, reports progress, and reuses across page instances', async () => {
  const env = environment();
  await env.create().prepare(playlist, env.report);
  assert.equal(env.requests.length, 2);
  assert.equal(env.requests[0].url, 'https://example.test/signage-poc/assets/videos/one.mp4');
  assert.equal(env.requests[0].init.cache, 'no-store');
  assert.equal(env.progress.at(-1).completed, 2);
  assert.equal(env.progress.at(-1).total, 2);
  assert.ok(env.progress.some(event => event.loaded === 16));
  env.network(false);
  const nextVisit = env.create();
  await nextVisit.prepare(playlist);
  const local = await nextVisit.getSource(playlist[0].src);
  assert.equal(local.url, 'blob:local-1');
  assert.equal(env.createdUrls[0].size, 16);
  assert.equal(env.requests.length, 2, 'prepared videos must not hit the network again');
  local.release(); local.release();
  assert.deepEqual(env.revokedUrls, ['blob:local-1']);
});

test('retry reuses completed files after a later video fails', async () => {
  let broken = true;
  const env = environment({ fetch: url => url.endsWith('two.mp4') && broken ? new Response('missing', {status:404}) : new Response('complete-video', {headers:{'Content-Type':'video/mp4'}}) });
  await assert.rejects(env.create().prepare(playlist), /HTTP 404/);
  assert.equal([...env.stores.values()][0].size, 1);
  broken = false;
  await env.create().prepare(playlist);
  assert.equal(env.requests.length, 3);
  assert.ok(env.requests[2].url.endsWith('two.mp4'));
});

test('rejects partial, empty, incomplete, and HTML responses without marking them ready', async () => {
  const cases = [
    () => new Response('partial', {status:206,headers:{'Content-Type':'video/mp4'}}),
    () => new Response('', {headers:{'Content-Type':'video/mp4'}}),
    () => new Response('short', {headers:{'Content-Type':'video/mp4','Content-Length':'500'}}),
    () => new Response('<html>not a video</html>', {headers:{'Content-Type':'text/html'}})
  ];
  for (const response of cases) {
    const env = environment({fetch:response});
    await assert.rejects(env.create().prepare([playlist[0]]));
    assert.equal([...env.stores.values()][0].size, 0);
  }
});

test('a version change replaces files while same-version reloads reuse them', async () => {
  const env = environment();
  await env.create({version:'1'}).prepare(playlist);
  await env.create({version:'2'}).prepare(playlist);
  assert.equal(env.requests.length, 4);
  await env.create({version:'2'}).prepare(playlist);
  assert.equal(env.requests.length, 4);
});

test('removed clips are pruned only inside this project cache', async () => {
  const env = environment();
  await env.create().prepare(playlist);
  const otherProject = env.create({baseUrl:'https://example.test/other-project/'});
  await otherProject.prepare([playlist[0]]);
  await env.create().prepare([playlist[1]]);
  assert.equal(env.stores.size, 2);
  for (const entries of env.stores.values()) assert.equal(entries.size, 1);
  assert.equal(env.requests.length, 3);
  assert.equal((await otherProject.getSource(playlist[0].src)).url, 'blob:local-1');
});

test('duplicate playlist paths are prepared once', async () => {
  const env = environment();
  await env.create().prepare([playlist[0], playlist[0]], env.report);
  assert.equal(env.requests.length, 1);
  assert.equal(env.progress.at(-1).total, 1);
});

test('storage quota failures and unsupported storage give useful recovery messages', async () => {
  const env = environment({putError:Object.assign(new Error('quota'),{name:'QuotaExceededError'})});
  await assert.rejects(env.create().prepare(playlist), /not enough browser storage/);
  assert.equal([...env.stores.values()][0].size, 0);
  await assert.rejects(environment({unsupported:true}).create().prepare(playlist), /HTTPS/);
});

test('a stalled initial connection times out and aborts instead of hanging', async () => {
  let aborted = false;
  const env = environment({fetch:(_, init) => new Promise((resolve,reject) => {
    init.signal.addEventListener('abort',()=>{aborted=true;reject(Object.assign(new Error('aborted'),{name:'AbortError'}));});
  })});
  await assert.rejects(env.create({timeoutMs:15}).prepare(playlist), /stopped responding/);
  assert.equal(aborted, true);
  assert.equal([...env.stores.values()][0].size, 0);
});

test('a response body failure never commits an incomplete clip', async () => {
  const env = environment({fetch:() => ({
    status:200, headers:new Headers({'Content-Type':'video/mp4'}),
    body:{getReader:()=>({read:()=>Promise.reject(new TypeError('connection lost')),releaseLock(){}})}
  })});
  await assert.rejects(env.create().prepare(playlist), /network connection/);
  assert.equal([...env.stores.values()][0].size, 0);
});

test('a stalled response body times out, cancels its reader, and is not cached', async () => {
  let cancelled=false;
  const env=environment({fetch:()=>({
    status:200,headers:new Headers({'Content-Type':'video/mp4'}),
    body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel:()=>{cancelled=true;return Promise.resolve();},releaseLock(){}})}
  })});
  await assert.rejects(env.create({timeoutMs:15}).prepare(playlist), /stopped responding/);
  assert.equal(cancelled,true);
  assert.equal([...env.stores.values()][0].size,0);
});

test('TV browsers without response streams still prepare whole blobs', async () => {
  const env = environment({fetch:() => ({
    status:200, headers:new Headers({'Content-Type':'video/mp4'}),body:null,
    blob:()=>Promise.resolve(new Blob(['complete-video']))
  })});
  await env.create().prepare([playlist[0]]);
  assert.equal(env.requests.length, 1);
  assert.equal((await env.create().getSource(playlist[0].src)).url, 'blob:local-1');
});

test('evicted entries require reinitialization and can be restored', async () => {
  const env = environment();
  const manager = env.create();
  await manager.prepare(playlist);
  [...env.stores.values()][0].clear();
  await assert.rejects(manager.getSource(playlist[0].src), /no longer available/);
  await manager.prepare(playlist);
  assert.equal(env.requests.length, 4);
});

test('a corrupt stored body is removed so initialization can repair it', async () => {
  const env = environment();
  const manager = env.create();
  await manager.prepare([playlist[0]]);
  const entries = [...env.stores.values()][0];
  const [url,response] = [...entries.entries()][0];
  entries.set(url,new Response('short',{headers:response.headers}));
  await assert.rejects(manager.getSource(playlist[0].src), /stored video is incomplete/);
  assert.equal(entries.size,0);
  await manager.prepare([playlist[0]]);
  assert.equal(env.requests.length,2);
});

test('project paths cannot read or prune a different project’s videos', async () => {
  const env = environment();
  await assert.rejects(env.create().prepare([{src:'../outside.mp4'}]), /inside this signage project/);
  await assert.rejects(env.create().prepare([{src:'https://elsewhere.test/video.mp4'}]), /inside this signage project/);
  assert.equal(env.requests.length,0);
});
