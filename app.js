/* Static signage player with optional browser video storage. No dependencies. */
(function () {
  "use strict";

  var byId = function (id) { return document.getElementById(id); };
  var player = byId("player");
  var video = byId("video");
  var startButton = byId("start-button");
  var pauseButton = byId("pause-button");
  var nextButton = byId("next-button");
  var retryButton = byId("retry-button");
  var soundButton = byId("sound-button");
  var fullscreenButton = byId("fullscreen-button");
  var diagnosticsButton = byId("diagnostics-button");
  var diagnostics = byId("diagnostics");
  var revealButton = byId("show-controls");
  var panel = byId("status-panel");
  var configuredSettings = window.SIGNAGE_SETTINGS || {};
  var playbackMode = "stream";
  var modeConfigError = "";
  if (typeof configuredSettings.playbackMode !== "undefined") {
    var requestedMode = typeof configuredSettings.playbackMode === "string" ? configuredSettings.playbackMode.trim().toLowerCase() : "";
    if (["stream", "cache-first", "direct"].indexOf(requestedMode) !== -1) playbackMode = requestedMode;
    else modeConfigError = 'Invalid playbackMode in settings.js. Use "stream", "cache-first", or "direct".';
  } else {
    // Keep previously published settings working. The explicit mode above takes
    // precedence over the older pair of caching flags when both are present.
    if (configuredSettings.cacheVideosBeforePlayback === true) playbackMode = "cache-first";
    else if (configuredSettings.cacheVideosInBackground === false) playbackMode = "direct";
  }
  var settings = {
    playbackMode: playbackMode,
    startMuted: typeof configuredSettings.startMuted === "boolean" ? configuredSettings.startMuted : false,
    fullscreenOnStart: typeof configuredSettings.fullscreenOnStart === "boolean" ? configuredSettings.fullscreenOnStart : true,
    hideControlsOnStart: typeof configuredSettings.hideControlsOnStart === "boolean" ? configuredSettings.hideControlsOnStart : true,
    showLogoAlways: typeof configuredSettings.showLogoAlways === "boolean" ? configuredSettings.showLogoAlways : true,
    showPlayerControlsButton: typeof configuredSettings.showPlayerControlsButton === "boolean" ? configuredSettings.showPlayerControlsButton : false,
    showAdNameAlways: typeof configuredSettings.showAdNameAlways === "boolean" ? configuredSettings.showAdNameAlways : false,
    cacheVideosBeforePlayback: playbackMode === "cache-first",
    cacheVideosInBackground: playbackMode === "stream",
    streamStartupDelaySeconds: typeof configuredSettings.streamStartupDelaySeconds === "number" && Number.isFinite(configuredSettings.streamStartupDelaySeconds) ? Math.max(0, Math.min(30, configuredSettings.streamStartupDelaySeconds)) : 3,
    videoCacheVersion: typeof configuredSettings.videoCacheVersion === "string" && configuredSettings.videoCacheVersion.trim() ? configuredSettings.videoCacheVersion.trim() : "1"
  };
  var playlist = [];
  var state = "starting";
  var index = 0;
  var latestError = "";
  var failed = new Set();
  var generation = 0;
  var skipTimer = null;
  var hideTimer = null;
  var noticeTimer = null;
  var lastProgressAt = Date.now();
  var lastMediaTime = 0;
  var LOAD_TIMEOUT_MS = 20000;
  var ERROR_DELAY_MS = 4000;
  var HIDE_CONTROLS_MS = 4500;
  var configError = modeConfigError;
  var mediaCache = null;
  var cacheReady = false;
  var cacheStatus = settings.cacheVideosBeforePlayback ? "Awaiting initialization" : "Network playback";
  var activeSource = null;
  var backgroundCacheStatus = "";
  var backgroundRunning = false;
  var backgroundDisabled = false;
  var backgroundComplete = false;
  var deferredCacheSources = [];
  var startupTimer = null;
  var startupCountdown = null;
  var streamedSources = new Set();

  function backgroundMode() { return settings.cacheVideosInBackground && !settings.cacheVideosBeforePlayback; }

  // Fail visibly on malformed configuration instead of silently dropping entries.
  if (!Array.isArray(window.SIGNAGE_PLAYLIST)) {
    configError = "The playlist could not be loaded. Check playlist.js, then reload this page.";
  } else if (!window.SIGNAGE_PLAYLIST.length) {
    configError = "Your playlist is empty. Add video entries to playlist.js, then reload this page.";
  } else {
    window.SIGNAGE_PLAYLIST.forEach(function (item, position) {
      if (!item || typeof item.src !== "string" || !item.src.trim()) {
        configError = "Playlist entry " + (position + 1) + " needs a nonempty src path in playlist.js.";
        return;
      }
      var source = item.src.trim();
      // Keep playback local to this project; root-relative URLs break Pages subpaths.
      if (/^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(source) || source.split(/[\\/]/).indexOf("..") !== -1) {
        configError = "Playlist entry " + (position + 1) + " must use a relative path inside this project.";
        return;
      }
      playlist.push({ src: source, title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : source.split("/").pop() });
    });
  }

  function current() { return playlist[index]; }
  function isActive() { return state === "loading" || state === "buffering" || state === "playing"; }

  function updateDiagnostics() {
    byId("diag-file").textContent = current() ? current().src : "No video configured";
    byId("diag-position").textContent = playlist.length ? (index + 1) + " / " + playlist.length : "0 / 0";
    byId("diag-state").textContent = state;
    byId("diag-time").textContent = formatTime(video.currentTime) + " / " + formatTime(video.duration);
    byId("diag-ready").textContent = video.readyState + " / 4 · network " + video.networkState;
    byId("diag-sound").textContent = video.muted ? "Muted" : "Sound on";
    var modeLabel = { stream: "Stream mode", "cache-first": "Cache-first mode", direct: "Direct mode" }[settings.playbackMode];
    byId("diag-cache").textContent = modeLabel + " · " + cacheStatus + (backgroundCacheStatus ? " · " + backgroundCacheStatus : "");
    byId("diag-error").textContent = latestError || "None";
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "—";
    var total = Math.max(0, Math.floor(seconds));
    return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
  }

  function setState(nextState, title, message) {
    state = nextState;
    player.dataset.state = state;
    byId("status-label").textContent = { starting: "Starting", initializing: "Initializing stream", "cache-error": "Initialization paused", preparing: "Preparing playback", loading: "Loading", playing: "Playing", buffering: "Buffering", paused: "Paused", blocked: "Ready to start", error: "Needs attention", empty: "No playlist" }[state];
    var initializationScreen = state === "initializing" || state === "cache-error";
    byId("initialization-screen").hidden = !initializationScreen;
    byId("initialization-brand").hidden = !initializationScreen;
    byId("initialization-progress").hidden = !initializationScreen;
    byId("initialization-actions").hidden = state !== "cache-error";
    panel.hidden = state === "playing";
    byId("loading-indicator").hidden = ["loading", "buffering", "initializing", "preparing"].indexOf(state) === -1;
    byId("setup-note").hidden = state !== "error" && state !== "empty";
    if (title) byId("status-title").textContent = title;
    if (message) byId("status-message").textContent = message;
    pauseButton.disabled = !isActive() && state !== "paused";
    pauseButton.textContent = state === "paused" ? "Resume" : "Pause";
    startButton.hidden = initializationScreen || state === "preparing";
    startButton.disabled = !!configError || initializationScreen || state === "preparing";
    nextButton.disabled = !!configError || state === "initializing" || (settings.cacheVideosBeforePlayback && !cacheReady);
    retryButton.disabled = !!configError || state === "initializing";
    if (state !== "playing") showControls();
    else scheduleHide();
    updateDiagnostics();
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    if (state !== "playing" || !diagnostics.hidden) return;
    hideTimer = setTimeout(function () {
      // Never hide a control while someone is navigating it with a remote.
      if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
      hideControls();
    }, HIDE_CONTROLS_MS);
  }

  function showControls(force) {
    // Background events, pointer movement, and programmatic focus must not
    // reveal hidden controls. A key, player click, or reveal button can do so.
    if (force !== true && !player.classList.contains("controls-visible")) return;
    player.classList.add("controls-visible");
    revealButton.setAttribute("aria-expanded", "true");
    scheduleHide();
  }

  function hideControls(force) {
    if (force !== true && (state !== "playing" || !diagnostics.hidden)) return;
    diagnostics.hidden = true;
    diagnosticsButton.setAttribute("aria-expanded", "false");
    if (document.activeElement && document.activeElement.tagName === "BUTTON") video.focus();
    clearTimeout(hideTimer);
    player.classList.remove("controls-visible");
    revealButton.setAttribute("aria-expanded", "false");
  }

  function updatePresentation() {
    if (settings.showLogoAlways) player.classList.add("logo-always");
    else player.classList.remove("logo-always");
    byId("logo-button").textContent = "Logo always: " + (settings.showLogoAlways ? "On" : "Off");
    byId("logo-button").setAttribute("aria-pressed", String(settings.showLogoAlways));
    byId("ad-name-button").textContent = "Ad name always: " + (settings.showAdNameAlways ? "On" : "Off");
    byId("ad-name-button").setAttribute("aria-pressed", String(settings.showAdNameAlways));
    byId("controls-button-toggle").textContent = "Controls button: " + (settings.showPlayerControlsButton ? "On" : "Off");
    byId("controls-button-toggle").setAttribute("aria-pressed", String(settings.showPlayerControlsButton));
    revealButton.hidden = !settings.showPlayerControlsButton;
    if (settings.showPlayerControlsButton) player.classList.add("reveal-button-enabled");
    else player.classList.remove("reveal-button-enabled");
    byId("persistent-ad-name").hidden = !settings.showAdNameAlways;
  }

  function notice(message) {
    clearTimeout(noticeTimer);
    byId("notice").textContent = message;
    byId("notice").hidden = false;
    noticeTimer = setTimeout(function () { byId("notice").hidden = true; }, 8500);
  }

  function resetProgress() {
    lastProgressAt = Date.now();
    lastMediaTime = video.currentTime;
  }

  function ensureMediaCache() {
    if (!window.SignageMediaCache) throw new Error("Stream preparation is unavailable. Reload the page, or select Play without preparation.");
    if (!mediaCache) mediaCache = window.SignageMediaCache.create({ baseUrl: document.baseURI, version: settings.videoCacheVersion });
    return mediaCache;
  }

  function backgroundError(error) {
    backgroundCacheStatus = "Background preparation paused";
    latestError = "Background preparation: " + (error.message || String(error));
    updateDiagnostics();
  }

  function prepareInBackground() {
    if (!backgroundMode() || backgroundDisabled || backgroundRunning || backgroundComplete) return;
    backgroundRunning = true;
    deferredCacheSources = [];
    backgroundCacheStatus = "Preparing local videos";
    // Prioritize the upcoming clips. Do not deliberately issue a second full
    // transfer for the clip currently streaming through the video element.
    var ordered = playlist.slice(index + 1).concat(playlist.slice(0, index + 1));
    try {
      Promise.resolve(ensureMediaCache().prepare(ordered, function (progress) {
        backgroundCacheStatus = "Background: " + progress.completed + " / " + progress.total + " ready";
        updateDiagnostics(); // Never replace the active video or its status panel.
      }, {
        shouldDefer: function (src) { return activeSource && activeSource.network && current().src === src && !streamedSources.has(src); },
        continueOnError: true
      })).then(function (result) {
        backgroundRunning = false;
        result = result || { completed: ordered.length, total: ordered.length, deferred: [], errors: [] };
        deferredCacheSources = result.deferred || [];
        backgroundComplete = result.completed === result.total;
        backgroundCacheStatus = "Background: " + result.completed + " / " + result.total + " ready";
        if (result.errors && result.errors.length) {
          latestError = "Background preparation: " + result.errors[0].message;
          backgroundCacheStatus += " · retry available";
        }
        updateDiagnostics();
        // A clip may have changed while the queue was busy. Resume once if a
        // deferred file is now free, without looping on a still-active stream.
        if (deferredCacheSources.some(function (src) { return !activeSource || !activeSource.network || current().src !== src; })) prepareInBackground();
      }).catch(function (error) {
        backgroundRunning = false;
        backgroundDisabled = true; // Explicit Retry can resume; no tight error loop.
        backgroundError(error);
      });
    } catch (error) {
      backgroundRunning = false;
      backgroundDisabled = true;
      backgroundError(error);
    }
  }

  function initializeStreaming() {
    generation += 1;
    var startupGeneration = generation;
    setState("initializing", "Initializing stream…", "Connecting your stream. Local videos will be prepared while playback continues.");
    video.pause();
    byId("cache-progress").value = 0;
    byId("cache-progress").setAttribute("value", "0");
    var startedAt = Date.now();
    var delayMs = settings.streamStartupDelaySeconds * 1000;
    function countdown() {
      var elapsed = Date.now() - startedAt;
      var percent = delayMs ? Math.min(100, Math.floor(elapsed / delayMs * 100)) : 100;
      byId("cache-progress").value = percent;
      byId("cache-progress").setAttribute("value", String(percent));
      byId("cache-progress-label").textContent = "Starting playback in " + Math.max(0, Math.ceil((delayMs - elapsed) / 1000)) + " seconds";
    }
    function begin(source) {
      clearTimeout(startupTimer);
      clearInterval(startupCountdown);
      if (generation !== startupGeneration) { if (source && source.release) source.release(); return; }
      loadItem(index, false, source || { url: current().src, network: true });
    }
    countdown();
    startupCountdown = setInterval(countdown, 250);
    startupTimer = setTimeout(function () { begin(null); }, delayMs);
    // A warm visit can use the first cached file immediately. Slow/unavailable
    // storage never extends the startup interval; late Blob URLs are released.
    try {
      ensureMediaCache().getSource(current().src, { allowMissing: true }).then(function (source) {
        if (source) begin(source);
      }).catch(function (error) {
        backgroundDisabled = true;
        backgroundError(error);
      });
    } catch (error) {
      backgroundDisabled = true;
      backgroundError(error);
    }
  }

  function displayInitializationProgress(progress) {
    var fraction = progress.totalBytes > 0 ? Math.min(progress.loaded / progress.totalBytes, .99) : 0;
    var percent = progress.total ? Math.floor((progress.completed + fraction) / progress.total * 100) : 0;
    byId("cache-progress").value = percent;
    byId("cache-progress").setAttribute("value", String(percent));
    var detail = "";
    if (progress.loaded > 0) {
      detail = " · " + (progress.loaded / 1048576).toFixed(1) + " MB";
      if (progress.totalBytes > 0) detail += " / " + (progress.totalBytes / 1048576).toFixed(1) + " MB";
    }
    byId("cache-progress-label").textContent = progress.completed + " / " + progress.total + " videos ready · " + percent + "%" + detail;
    byId("status-message").textContent = progress.completed === progress.total ? "Your playlist is ready." : "Preparing “" + (progress.title || progress.src) + "” for local playback.";
    cacheStatus = "Initializing: " + progress.completed + " / " + progress.total;
    updateDiagnostics();
  }

  function initializationFailed(error) {
    generation += 1;
    cacheReady = false;
    video.pause();
    latestError = error.message || String(error);
    cacheStatus = "Initialization incomplete";
    setState("cache-error", "Let’s get your stream ready.", latestError + " Select Retry initialization to continue, or Play without preparation to use the connection directly.");
    byId("cache-retry-button").focus();
  }

  function initializePlaylist() {
    if (configError || state === "initializing") return;
    clearTimeout(skipTimer);
    generation += 1;
    var initializationGeneration = generation;
    cacheReady = false;
    setState("initializing", "Initializing stream…", "Preparing your playlist. Playback will begin when every video is ready.");
    video.pause();
    byId("cache-progress").value = 0;
    byId("cache-progress").setAttribute("value", "0");
    byId("cache-progress-label").textContent = "Checking your playlist…";
    cacheStatus = "Checking browser storage";
    updateDiagnostics();
    try {
      Promise.resolve(ensureMediaCache().prepare(playlist, function (progress) {
        if (generation === initializationGeneration) displayInitializationProgress(progress);
      })).then(function () {
        if (generation !== initializationGeneration) return;
        cacheReady = true;
        cacheStatus = "Browser storage · playlist ready";
        loadItem(index, false);
      }).catch(function (error) {
        if (generation === initializationGeneration) initializationFailed(error);
      });
    } catch (error) { initializationFailed(error); }
  }

  function attachSource(source) {
    var previousSource = activeSource;
    video.pause();
    video.src = source.url;
    activeSource = source;
    if (backgroundMode()) cacheStatus = source.network ? "Network stream" : "Browser storage";
    video.load();
    // Release only after detaching the old source; retain one Blob URL at a time.
    if (previousSource && previousSource.release) previousSource.release();
    setState("loading", "Getting ready.", "Loading “" + current().title + "”. Playback starts " + (video.muted ? "muted." : "with sound."));
    resetProgress();
    attemptPlay();
    prepareInBackground();
  }

  function loadItem(position, manual, sourceOverride) {
    clearTimeout(skipTimer);
    skipTimer = null;
    if (configError) return;
    if (state === "initializing" && backgroundMode() && !sourceOverride) return;
    if (settings.cacheVideosBeforePlayback && !cacheReady) return;
    if (manual) failed.clear();
    generation += 1;
    index = (position + playlist.length) % playlist.length;
    var sourceGeneration = generation;
    setState("preparing", "Preparing playback.", "Opening “" + current().title + "”.");
    video.pause();
    byId("track-label").textContent = "NOW PLAYING";
    byId("track-title").textContent = current().title;
    byId("persistent-ad-name").textContent = current().title;
    byId("track-position").textContent = String(index + 1).padStart(2, "0") + " / " + String(playlist.length).padStart(2, "0");
    updateProgress();
    if (sourceOverride) {
      attachSource(sourceOverride);
    } else if (settings.cacheVideosBeforePlayback) {
      mediaCache.getSource(current().src).then(function (source) {
        if (sourceGeneration !== generation) { source.release(); return; }
        attachSource(source);
      }).catch(function (error) {
        if (sourceGeneration === generation) initializationFailed(error);
      });
    } else if (backgroundMode()) {
      var decided = false;
      function useNetwork() {
        if (decided) return;
        decided = true;
        if (sourceGeneration !== generation) return;
        backgroundComplete = false;
        attachSource({ url: current().src, network: true });
      }
      // A slow local cache read must not hold up an ordinary video transition.
      var lookupTimer = setTimeout(useNetwork, 1500);
      try {
        ensureMediaCache().getSource(current().src, { allowMissing: true }).then(function (source) {
          if (decided || sourceGeneration !== generation) {
            clearTimeout(lookupTimer);
            if (source && source.release) source.release();
            return;
          }
          if (!source) { clearTimeout(lookupTimer); useNetwork(); return; }
          decided = true;
          clearTimeout(lookupTimer);
          attachSource(source);
        }).catch(function (error) {
          clearTimeout(lookupTimer);
          if (sourceGeneration !== generation) return;
          backgroundError(error);
          useNetwork();
        });
      } catch (error) {
        clearTimeout(lookupTimer);
        backgroundError(error);
        useNetwork();
      }
    } else {
      attachSource({ url: current().src, network: true });
    }
  }

  function attemptPlay() {
    var attemptGeneration = generation;
    resetProgress();
    try {
      var result = video.play();
      // Older TV WebViews may return undefined from play().
      if (result && typeof result.catch === "function") {
        result.catch(function (error) {
          if (attemptGeneration !== generation || state === "error" || state === "paused") return;
          handlePlayRejection(error);
        });
      }
    } catch (error) {
      handlePlayRejection(error);
    }
  }

  function handlePlayRejection(error) {
    if (error.name === "AbortError") return; // Expected when load() replaces a source.
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      latestError = "Playback permission: " + (error.message || error.name);
      setState("blocked", "Ready when you are.", "Your browser needs a button press to begin. Select Start playback with Enter or your remote’s OK button.");
      startButton.focus();
    } else {
      fail("Unable to play this file. Check its path and MP4 H.264/AAC encoding. " + (error.message || error.name || "Unknown playback error."));
    }
  }

  function fail(message) {
    if (state === "error" || state === "empty") return;
    latestError = message;
    generation += 1; // Ignore a pending play() rejection for the failed attempt.
    video.pause();
    failed.add(index);
    var exhausted = failed.size >= playlist.length;
    setState("error", exhausted ? "Let’s get your videos ready." : "This video couldn’t play.", message + (exhausted ? " No playable videos remain. Add or fix the files, then select Retry or Start playback." : " Trying the next video in 4 seconds. You can also Retry now."));
    startButton.focus();
    if (!exhausted) {
      skipTimer = setTimeout(function () {
        var candidate = (index + 1) % playlist.length;
        while (failed.has(candidate)) candidate = (candidate + 1) % playlist.length;
        loadItem(candidate, false);
      }, ERROR_DELAY_MS);
    }
  }

  function startPlayback() {
    if (configError) return;
    if (state === "initializing" || state === "preparing") return;
    if (settings.cacheVideosBeforePlayback && !cacheReady) {
      initializePlaylist();
      requestStartupFullscreen();
      return;
    }
    if (state === "error" || !video.getAttribute("src")) {
      loadItem(index, true);
    } else {
      setState("loading", "Starting playback.", "Waiting for the video to begin.");
      attemptPlay(); // Keep this inside the user gesture for TV autoplay policies.
    }
    requestStartupFullscreen();
  }

  function updateProgress() {
    var progress = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(100, video.currentTime / video.duration * 100) : 0;
    byId("progress-fill").style.width = progress + "%";
    document.querySelector(".progress-track").setAttribute("aria-valuenow", String(Math.round(progress)));
    if (!diagnostics.hidden) updateDiagnostics();
  }

  video.addEventListener("playing", function () {
    if (!isActive() && state !== "blocked") return;
    clearTimeout(skipTimer);
    failed.clear();
    resetProgress();
    setState("playing");
    if (document.activeElement === startButton) video.focus();
    scheduleHide();
  });
  video.addEventListener("ended", function () {
    if (isActive()) {
      if (activeSource && activeSource.network) streamedSources.add(current().src);
      loadItem(index + 1, false);
    }
  });
  video.addEventListener("error", function () {
    if (state === "initializing" || state === "cache-error" || state === "preparing") return;
    if (!video.error) return;
    var descriptions = {
      1: "Video loading was interrupted.",
      2: "A network error stopped the video. Check the connection and file availability.",
      3: "The browser could not decode the video. Try MP4 H.264 video with AAC audio.",
      4: "Video not found or format unsupported. Check the filename, path, and MP4 H.264/AAC encoding."
    };
    fail((descriptions[video.error.code] || "A playback error occurred.") + " File: " + (current() ? current().src : "unknown"));
  });
  ["waiting", "stalled"].forEach(function (eventName) {
    video.addEventListener(eventName, function () {
      if (!isActive()) return;
      // Do not extend the deadline on repeated stalled/waiting events.
      setState("buffering", "A moment, please.", "Buffering the video. If loading does not recover, the player will try the next clip.");
    });
  });
  video.addEventListener("timeupdate", function () {
    if (isActive() && video.currentTime > lastMediaTime + 0.05) {
      resetProgress();
      if (state === "buffering" && !video.paused) setState("playing");
    }
    updateProgress();
  });
  video.addEventListener("pause", function () {
    // Ignore pause events from source replacement; a real pause keeps time intact.
    if (isActive() && video.paused && !video.ended && video.readyState >= 2 && !video.error) {
      setState("paused", "Playback paused.", "Select Start playback or Resume to continue.");
    }
  });
  function updateSoundControls() {
    soundButton.textContent = video.muted ? "Unmute" : "Mute";
    soundButton.setAttribute("aria-pressed", String(!video.muted));
    updateDiagnostics();
  }
  video.addEventListener("volumechange", updateSoundControls);

  startButton.addEventListener("click", startPlayback);
  nextButton.addEventListener("click", function () { loadItem(index + 1, true); });
  retryButton.addEventListener("click", function () {
    if (backgroundMode()) { backgroundDisabled = false; backgroundComplete = false; }
    if (settings.cacheVideosBeforePlayback && !cacheReady) initializePlaylist();
    else loadItem(index, true);
  });
  byId("cache-retry-button").addEventListener("click", function () { initializePlaylist(); requestStartupFullscreen(); });
  byId("stream-without-cache").addEventListener("click", function () {
    if (state !== "cache-error") return;
    settings.cacheVideosBeforePlayback = false;
    settings.cacheVideosInBackground = false;
    settings.playbackMode = "direct";
    cacheStatus = "Network playback · preparation skipped";
    loadItem(index, true);
    requestStartupFullscreen();
  });
  pauseButton.addEventListener("click", function () {
    if (state === "paused") { startPlayback(); return; }
    if (!isActive()) return;
    setState("paused", "Playback paused.", "Select Start playback or Resume to continue.");
    video.pause();
  });
  soundButton.addEventListener("click", function () {
    video.muted = !video.muted;
    if (!video.muted) notice("Sound enabled. Audio also depends on the video and your TV volume.");
  });
  byId("hide-controls").addEventListener("click", function () { hideControls(true); });
  byId("logo-button").addEventListener("click", function () {
    settings.showLogoAlways = !settings.showLogoAlways;
    updatePresentation();
  });
  byId("ad-name-button").addEventListener("click", function () {
    settings.showAdNameAlways = !settings.showAdNameAlways;
    updatePresentation();
  });
  byId("controls-button-toggle").addEventListener("click", function () {
    settings.showPlayerControlsButton = !settings.showPlayerControlsButton;
    updatePresentation();
  });

  function fullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement; }
  function fullscreenChanged() {
    fullscreenButton.textContent = fullscreenElement() ? "Exit fullscreen" : "Enter fullscreen";
    showControls();
  }
  function fullscreenFallback(error) {
    if (error) {
      latestError = "Fullscreen: " + (error.message || error.name || String(error));
      updateDiagnostics();
    }
    notice("Fullscreen is unavailable or was declined. Select Start playback or Enter fullscreen to try with a button press. You can also use your browser’s fullscreen option.");
  }
  function enterFullscreen() {
    if (fullscreenElement()) return;
    try {
      var request = player.requestFullscreen || player.webkitRequestFullscreen;
      if (!request) { fullscreenFallback(); return; }
      var result = request.call(player);
      if (result && typeof result.catch === "function") result.catch(fullscreenFallback);
    } catch (error) { fullscreenFallback(error); }
  }
  function requestStartupFullscreen() {
    // Make only one launch attempt, then retry from Start/Resume's user gesture.
    // Do not re-enter on each clip or repeatedly fight a user's fullscreen exit.
    if (settings.fullscreenOnStart) enterFullscreen();
  }
  function toggleFullscreen() {
    if (!fullscreenElement()) { enterFullscreen(); return; }
    try {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (!exit) { fullscreenFallback(); return; }
      var result = exit.call(document);
      if (result && typeof result.catch === "function") result.catch(fullscreenFallback);
    } catch (error) { fullscreenFallback(error); }
  }
  fullscreenButton.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", fullscreenChanged);
  document.addEventListener("webkitfullscreenchange", fullscreenChanged);

  function toggleDiagnostics(force) {
    diagnostics.hidden = typeof force === "boolean" ? !force : !diagnostics.hidden;
    diagnosticsButton.setAttribute("aria-expanded", String(!diagnostics.hidden));
    showControls(true);
    updateDiagnostics();
    if (!diagnostics.hidden) byId("close-diagnostics").focus();
    else diagnosticsButton.focus();
  }
  diagnosticsButton.addEventListener("click", function () { toggleDiagnostics(); });
  byId("close-diagnostics").addEventListener("click", function () { toggleDiagnostics(false); });
  revealButton.addEventListener("click", function () {
    showControls(true);
    (pauseButton.disabled ? nextButton : pauseButton).focus();
  });
  player.addEventListener("mousemove", function () { showControls(); });
  player.addEventListener("touchstart", function () { showControls(); }, { passive: true });
  player.addEventListener("click", function (event) {
    // A button handles its own action. In particular, do not immediately undo
    // Hide controls when its click bubbles up to the player.
    var target = event.target;
    while (target && target !== player) {
      if (target.tagName === "BUTTON") return;
      target = target.parentElement;
    }
    showControls(true);
  });
  player.addEventListener("focusin", function (event) {
    // Focusing the reveal button via Tab should leave it visible until activated.
    if (event.target !== revealButton) showControls();
  });

  document.addEventListener("keydown", function (event) {
    var wasHidden = !player.classList.contains("controls-visible");
    showControls(true); // Every key reveals controls, including modifiers and Tab.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    var key = event.key;
    if (key === "d" || key === "D") { event.preventDefault(); toggleDiagnostics(); return; }
    if (key === "f" || key === "F") { event.preventDefault(); toggleFullscreen(); return; }
    if (key === "Escape" || key === "BrowserBack") {
      if (wasHidden) { event.preventDefault(); return; }
      if (!diagnostics.hidden) { event.preventDefault(); toggleDiagnostics(false); }
      else { event.preventDefault(); hideControls(true); }
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(key) !== -1) {
      event.preventDefault();
      showControls();
      var buttons = Array.prototype.filter.call(player.querySelectorAll("button"), function (button) {
        return !button.disabled && button !== revealButton && button.getClientRects().length > 0;
      });
      if (!buttons.length) return;
      var activeIndex = buttons.indexOf(document.activeElement);
      var step = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
      var targetIndex = activeIndex < 0 ? 0 : (activeIndex + step + buttons.length) % buttons.length;
      buttons[targetIndex].focus();
      return;
    }
    // Native button behavior handles Enter/Space; only handle the video/page here.
    if ((key === "Enter" || key === " " || key === "Select") && document.activeElement.tagName !== "BUTTON") {
      event.preventDefault();
      if (state === "playing") { showControls(); pauseButton.focus(); }
      else startPlayback();
    } else if (key === "Select" && document.activeElement.tagName === "BUTTON") {
      event.preventDefault(); document.activeElement.click();
    }
  });

  // Detect loading AND silent playback freezes. Paused/blocked/error states do not
  // retry in the background. Repeated failure stops after one pass of the list.
  setInterval(function () {
    if (isActive() && Date.now() - lastProgressAt >= LOAD_TIMEOUT_MS) {
      fail("No playback progress for 20 seconds. Check the connection, file, or video encoding.");
    }
    if (!diagnostics.hidden) updateDiagnostics();
  }, 1000);
  document.addEventListener("visibilitychange", function () {
    // Background execution is browser-controlled; allow a fresh deadline on return.
    if (!document.hidden) { resetProgress(); showControls(); }
  });

  video.muted = settings.startMuted;
  video.defaultMuted = settings.startMuted;
  video.playsInline = true;
  updateSoundControls();
  updatePresentation();
  if (settings.hideControlsOnStart) hideControls(true);
  if (configError) {
    latestError = configError;
    nextButton.disabled = true;
    retryButton.disabled = true;
    setState("empty", modeConfigError ? "Check your playback settings." : "Your playlist starts here.", configError);
    if (settings.hideControlsOnStart) video.focus();
    else diagnosticsButton.focus();
  } else {
    startButton.focus();
    if (settings.cacheVideosBeforePlayback) initializePlaylist();
    else if (backgroundMode()) initializeStreaming();
    else loadItem(0, false);
    requestStartupFullscreen();
  }
}());
