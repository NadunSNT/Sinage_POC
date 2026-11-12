// Startup preferences. Reload the page after editing this file.
// Browser permissions can still require a click or remote OK press.
window.SIGNAGE_SETTINGS = {
  startMuted: false,       // false = start with sound; true = start muted
  fullscreenOnStart: true, // Request on launch and again when Start/Resume is selected
  hideControlsOnStart: false,     // A key, remote key, or player click reveals controls
  showLogoAlways: true,         // Keep the logo visible while controls are hidden
  showPlayerControlsButton: false, // Show the floating button when controls are hidden
  showAdNameAlways: true,      // Keep the current ad name visible during playback
  playbackMode: "cache-first", // "stream" = stream + background cache; "cache-first" = cache all, then play
  streamStartupDelaySeconds: 60, // Initial stream countdown in seconds; 0 skips it
  videoCacheVersion: "1"        // Change this when replacing a video without renaming it
};
