/* Static signage player. No network services, persistence, or dependencies. */
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
  var settings = {
    startMuted: typeof configuredSettings.startMuted === "boolean" ? configuredSettings.startMuted : false,
    fullscreenOnStart: typeof configuredSettings.fullscreenOnStart === "boolean" ? configuredSettings.fullscreenOnStart : true,
    hideControlsOnStart: typeof configuredSettings.hideControlsOnStart === "boolean" ? configuredSettings.hideControlsOnStart : true,
    showLogoAlways: typeof configuredSettings.showLogoAlways === "boolean" ? configuredSettings.showLogoAlways : true,
    showPlayerControlsButton: typeof configuredSettings.showPlayerControlsButton === "boolean" ? configuredSettings.showPlayerControlsButton : false,
    showAdNameAlways: typeof configuredSettings.showAdNameAlways === "boolean" ? configuredSettings.showAdNameAlways : false
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
  var configError = "";

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
    byId("status-label").textContent = { starting: "Starting", loading: "Loading", playing: "Playing", buffering: "Buffering", paused: "Paused", blocked: "Ready to start", error: "Needs attention", empty: "No playlist" }[state];
    panel.hidden = state === "playing";
    byId("loading-indicator").hidden = state !== "loading" && state !== "buffering";
    byId("setup-note").hidden = state !== "error" && state !== "empty";
    if (title) byId("status-title").textContent = title;
    if (message) byId("status-message").textContent = message;
    pauseButton.disabled = !isActive() && state !== "paused";
    pauseButton.textContent = state === "paused" ? "Resume" : "Pause";
    startButton.disabled = !!configError;
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
    // reveal hidden controls. Only a key or the optional reveal button does.
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

  function loadItem(position, manual) {
    clearTimeout(skipTimer);
    skipTimer = null;
    if (configError) return;
    if (manual) failed.clear();
    generation += 1;
    index = (position + playlist.length) % playlist.length;
    setState("loading", "Getting ready.", "Loading “" + current().title + "”. Playback starts " + (video.muted ? "muted." : "with sound."));
    video.pause();
    video.src = current().src;
    video.load();
    byId("track-label").textContent = "NOW PLAYING";
    byId("track-title").textContent = current().title;
    byId("persistent-ad-name").textContent = current().title;
    byId("track-position").textContent = String(index + 1).padStart(2, "0") + " / " + String(playlist.length).padStart(2, "0");
    updateProgress();
    resetProgress();
    attemptPlay();
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
    if (isActive()) loadItem(index + 1, false);
  });
  video.addEventListener("error", function () {
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
  retryButton.addEventListener("click", function () { loadItem(index, true); });
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
  video.addEventListener("click", function () { showControls(); });
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
    setState("empty", "Your playlist starts here.", configError);
    if (settings.hideControlsOnStart) video.focus();
    else diagnosticsButton.focus();
  } else {
    startButton.focus();
    loadItem(0, false);
    requestStartupFullscreen();
  }
}());
