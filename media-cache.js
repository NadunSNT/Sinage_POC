/* Cache complete video files, then expose one local Blob URL at a time.
   No service worker is needed: the video element never requests network ranges
   for a prepared clip. Cache Storage persists independently of the HTTP cache. */
(function () {
  "use strict";

  var FORMAT_HEADER = "X-Signage-Complete";
  var VERSION_HEADER = "X-Signage-Version";

  function create(options) {
    options = options || {};
    var base = new URL("./", options.baseUrl || document.baseURI);
    // GitHub Pages projects share an origin. Keep each project's videos separate.
    var cacheName = "signage-media-v1:" + encodeURIComponent(base.href);
    var version = encodeURIComponent(String(options.version || "1"));
    var timeoutMs = options.timeoutMs || 60000;
    var openedCache;

    function resolveSource(source) {
      var url = new URL(source, base);
      if (url.origin !== base.origin || url.pathname.indexOf(base.pathname) !== 0) {
        throw new Error("Video files must be inside this signage project.");
      }
      return url.href;
    }

    function deadline(promise, onTimeout) {
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          reject(new Error("Stream preparation stopped responding. Check the connection and retry."));
          if (onTimeout) onTimeout();
        }, timeoutMs);
        Promise.resolve(promise).then(function (result) {
          clearTimeout(timer); resolve(result);
        }, function (error) {
          clearTimeout(timer); reject(error);
        });
      });
    }

    async function openCache() {
      if (!window.caches || typeof window.fetch !== "function" || !URL.createObjectURL) {
        throw new Error("This browser cannot prepare videos for local playback. Use the HTTPS link in a compatible browser, or select Play without preparation.");
      }
      if (!openedCache) openedCache = await deadline(window.caches.open(cacheName));
      return openedCache;
    }

    function complete(response) {
      return response && response.status === 200 &&
        response.headers.get(FORMAT_HEADER) === "1" &&
        response.headers.get(VERSION_HEADER) === version &&
        Number(response.headers.get("Content-Length")) > 0;
    }

    function friendlyError(error) {
      if (error.name === "QuotaExceededError") {
        return new Error("There is not enough browser storage for this playlist. Free space or use smaller clips, then retry.");
      }
      if (error.name === "SecurityError" || error.name === "NotAllowedError") {
        return new Error("Browser storage is unavailable. Open the HTTPS link and allow site storage, or select Play without preparation.");
      }
      if (error.name === "TypeError" || error.name === "AbortError") {
        return new Error("A video could not be prepared. Check the network connection and the published video files, then retry.");
      }
      return error;
    }

    async function fetchComplete(url, report) {
      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var reader;
      var abort = function () {
        if (controller) controller.abort();
        // Cancel the reader as well for browsers without AbortController.
        if (reader && typeof reader.cancel === "function") {
          Promise.resolve(reader.cancel()).catch(function () {});
        }
      };
      try {
        var response = await deadline(window.fetch(url, {
          cache: "no-store", credentials: "same-origin",
          signal: controller ? controller.signal : undefined
        }), abort);
        // A partial response must never be marked as a complete prepared video.
        if (response.status !== 200) {
          throw new Error("Video unavailable (HTTP " + response.status + "). Check its filename and published path.");
        }
        var type = response.headers.get("Content-Type") || "video/mp4";
        if (/^(text\/|application\/(?:json|xml|xhtml))/i.test(type)) {
          throw new Error("The video URL returned a page instead of a video. Check its filename and published path.");
        }
        var length = Number(response.headers.get("Content-Length")) || 0;
        var bytes = 0;
        var blob;
        report(0, length);
        if (response.body && typeof response.body.getReader === "function") {
          reader = response.body.getReader();
          var chunks = [];
          var lastReport = 0;
          try {
            while (true) {
              // Each received chunk gets a fresh deadline; slow but progressing
              // connections are allowed to take longer than a minute overall.
              var part = await deadline(reader.read(), abort);
              if (part.done) break;
              bytes += part.value.byteLength;
              chunks.push(part.value);
              if (Date.now() - lastReport > 150) {
                report(bytes, length); lastReport = Date.now();
              }
            }
          } finally {
            reader.releaseLock();
          }
          blob = new Blob(chunks, { type: type });
        } else {
          // Some TV browsers support Fetch/Cache but not readable response streams.
          blob = await deadline(response.blob(), abort);
          bytes = blob.size;
        }
        if (!blob.size) throw new Error("The video file is empty. Replace it and retry.");
        var encoding = response.headers.get("Content-Encoding");
        if (length && (!encoding || encoding === "identity") && blob.size !== length) {
          throw new Error("The video was incomplete. Check the connection and retry initialization.");
        }
        report(bytes, length || bytes);
        return new Response(blob, { status: 200, headers: {
          "Content-Type": type, "Content-Length": String(blob.size),
          "X-Signage-Complete": "1", "X-Signage-Version": version
        } });
      } catch (error) {
        abort(); throw error;
      }
    }

    async function prepare(playlist, onProgress) {
      try {
        var cache = await openCache();
        var entries = [];
        var seen = new Set();
        playlist.forEach(function (item) {
          var url = resolveSource(item.src);
          if (!seen.has(url)) { seen.add(url); entries.push({ src: item.src, title: item.title, url: url }); }
        });
        // Free space only inside this project's cache, retaining completed files
        // from an interrupted preparation pass so Retry can resume efficiently.
        var keys = await deadline(cache.keys());
        for (var key of keys) {
          if (!seen.has(key.url)) await deadline(cache.delete(key));
        }
        for (var position = 0; position < entries.length; position += 1) {
          var entry = entries[position];
          var report = function (loaded, totalBytes, phase) {
            if (onProgress) onProgress({
              completed: position, total: entries.length, src: entry.src,
              title: entry.title, loaded: loaded, totalBytes: totalBytes, phase: phase || "preparing"
            });
          };
          report(0, 0, "checking");
          var saved = await deadline(cache.match(entry.url));
          if (!complete(saved)) {
            var response = await fetchComplete(entry.url, report);
            // Store only after the full body is received and verified. A failed
            // network request never leaves a seemingly usable partial cache entry.
            report(Number(response.headers.get("Content-Length")), Number(response.headers.get("Content-Length")), "saving");
            await deadline(cache.put(entry.url, response));
          }
          if (onProgress) onProgress({ completed: position + 1, total: entries.length, src: entry.src, title: entry.title, loaded: 0, totalBytes: 0, phase: "ready" });
        }
      } catch (error) { throw friendlyError(error); }
    }

    async function getSource(source) {
      try {
        var cache = await openCache();
        var response = await deadline(cache.match(resolveSource(source)));
        if (!complete(response)) throw new Error("A prepared video is no longer available in browser storage. Retry initialization to restore it.");
        var blob = await deadline(response.blob());
        if (!blob.size || blob.size !== Number(response.headers.get("Content-Length"))) {
          await deadline(cache.delete(resolveSource(source)));
          throw new Error("A stored video is incomplete. Retry initialization to restore it.");
        }
        var objectUrl = URL.createObjectURL(blob);
        var released = false;
        return { url: objectUrl, release: function () {
          if (!released) { URL.revokeObjectURL(objectUrl); released = true; }
        } };
      } catch (error) { throw friendlyError(error); }
    }

    return { prepare: prepare, getSource: getSource };
  }

  window.SignageMediaCache = { create: create };
}());
