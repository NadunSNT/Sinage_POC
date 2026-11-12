# PROMPT.md — Codex implementation brief

You are implementing a **Digital Signage Web Player POC** for testing in a desktop browser and then on a client's Android Smart TV using a GitHub Pages URL.

Read `SKILLS.md` before making changes. Implement the application in the current workspace. Do not stop at planning; create working code, a README, and any necessary static assets/placeholders.

## Goal
A visitor opens `https://<username>.github.io/<repository>/` in a compatible browser. The page displays a clean, TV-friendly, fullscreen-style signage player that sequentially plays sample MP4 videos and repeats the playlist indefinitely. The same site should work in a desktop browser and, subject to device compatibility, in an Android TV browser or separately installed kiosk browser.

## Scope (must implement)
- Static app only: `index.html`, `styles.css`, `app.js`, and an easily editable playlist configuration file.
- A playlist of local MP4 file paths such as `assets/videos/ad-01.mp4` and `assets/videos/ad-02.mp4`. Assume I will supply the actual video files later. Do not create fake MP4 files.
- Sequential playback and continuous playlist looping using the HTML5 `<video>` element.
- Muted autoplay attempt; visible **Start playback** button if autoplay is blocked or no video is ready.
- User-triggered **Fullscreen** button with graceful fallback. The page should visually fill the viewport even without browser fullscreen.
- A minimal startup screen, loading indicator, error state, retry action, and next-video action.
- TV remote-friendly focus and keyboard handling (arrow keys, Enter, Escape where appropriate), and accessible controls.
- Small diagnostics panel that can be toggled to see current video, playlist index, state, and errors.
- Robust event listeners for `ended`, `error`, `waiting`, `playing`, and `stalled`; sensible timeout/retry behavior to avoid getting stuck on a broken file.
- No autoplay-with-sound assumption. Default muted.
- No hardcoded root-relative paths, so GitHub Pages repository URLs work.
- No backend, API, database, accounts, or authentication.

## Design
- Minimal professional signage look: dark background, video covers or contains the screen without distortion (prefer `object-fit: contain` by default), subtle branding, controls hidden during normal playback.
- Large readable buttons and focus indicators for viewing from a distance.
- Responsive at desktop and TV resolutions, especially 1920×1080.
- No CSS/JS framework or build pipeline.

## README requirements
Document:
1. Project overview and directory structure.
2. Where I should place my sample videos and how to edit the playlist.
3. Recommended encoding: MP4 (H.264 video + AAC audio), 720p/1080p.
4. How to run locally with `python -m http.server 8000` (and an alternative if Python is unavailable).
5. How to create a GitHub repository, push files, enable GitHub Pages, and get the public URL.
6. How to test in Chrome/Edge/Firefox on desktop.
7. How the client tests on Android Smart TV: connect internet, open URL in TV browser, press Start if needed, optionally enable fullscreen, and optionally configure a compatible third-party kiosk browser.
8. Kiosk limitations: a website cannot install a kiosk browser, force kiosk mode, guarantee autoplay/fullscreen, or relaunch itself after power loss. These require compatible device settings/app capabilities.
9. Troubleshooting: unsupported video codec, black screen, autoplay blocked, GitHub Pages 404/subpath, buffering, TV browser incompatibility.
10. GitHub Pages media constraints; keep sample clips short and compressed. GitHub Pages is for a POC, not a production video distribution platform.
11. A concise manual acceptance checklist, including 30–60 minutes of continuous playback on the TV.

## Acceptance criteria
- The app loads with no JavaScript console errors when sample MP4s are present.
- Videos play in the playlist order, advance automatically, and loop.
- If autoplay fails, a clear button lets a user begin playback.
- Fullscreen can be requested from a user gesture where the browser permits it.
- A missing video does not leave the app permanently frozen.
- The app functions under a GitHub Pages project path (not just `/`).
- The UI is operable using keyboard/TV remote controls.
- The README accurately describes limitations and setup.

## Implementation workflow
1. Inspect existing workspace files and preserve user work.
2. Read `SKILLS.md` and implement the smallest reliable solution.
3. Use placeholder filenames in the playlist, clearly indicate that sample MP4s must be added by me.
4. Run any available static checks and test in a local browser if available.
5. Report what was created, how to start it, what still needs real video files, and what must be validated on the actual Android TV.

## Out of scope
Backend integration, login, pairing codes, playlists assigned by API, remote monitoring, offline caching, native Android APK, remote APK updates, and automatic kiosk installation. Those can be added in later phases.
