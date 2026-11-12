# Digital Signage Web Player POC

A static, TV-friendly browser player that runs an ordered video playlist on repeat. By default, it shows a brief initialization screen, streams the first video without waiting for any complete file, and prepares local copies in the background. Completed files are reused at later transitions and visits. It uses plain HTML, CSS, and JavaScript with no framework, build, runtime dependencies, accounts, or backend. Deploy the files directly to GitHub Pages or serve them with any static HTTP server.

The playlist uses the three locally supplied files `ad-01.mp4`, `ad-02.mp4`, and `ad-03.mp4` in `assets/videos/`. No sample media was generated for the app. If you distribute the code without those files, supply your own MP4s and update the playlist. Missing clips report readable errors and can be skipped. The optional full-preparation mode instead waits for every file, with Retry initialization and Play without preparation recovery options. Missing-file HTTP errors in the browser console are expected until the clips are available.

## Files

```text
index.html                 Accessible player and controls
styles.css                 Responsive dark layout; video uses object-fit: contain
app.js                     Playback, recovery, remote navigation, diagnostics
media-cache.js             Complete-video storage, progress, and local playback URLs
settings.js                Playback, caching, controls, and overlay preferences
playlist.js                Editable ordered list of videos
assets/videos/.gitkeep     Place your real MP4 clips in this directory
assets/videos/ad-01.mp4     Locally supplied sample clip
assets/videos/ad-02.mp4     Locally supplied sample clip
assets/videos/ad-03.mp4     Locally supplied sample clip
.nojekyll                  Serve the static files directly on GitHub Pages
.gitignore                 Excludes temporary local verification files
tests/playback.test.cjs     Optional dependency-free regression checks
tests/media-cache.test.cjs  Browser video storage and initialization regression checks
README.md                  Setup and acceptance checklist
SKILLS.md                  Project constraints
PROMPT.md                  Implementation brief
```

## Add your videos

1. Use the three supplied `ad-01.mp4`, `ad-02.mp4`, and `ad-03.mp4` clips, or copy your own short, nonconfidential clips into `assets/videos/`.
2. Edit `playlist.js` to match the files, in playback order:

   ```js
   window.SIGNAGE_PLAYLIST = [
     { title: "Welcome", src: "assets/videos/welcome.mp4" },
     { title: "This week’s offers", src: "assets/videos/offers.mp4" }
   ];
   ```

3. Add or remove entries in the array to change the playlist. `title` is optional; `src` is required. Keep paths relative to `index.html`, with forward slashes, exact filename capitalization, and no leading `/` or `../`. Avoid external media URLs. Reload the page after editing configuration; Retry reloads the current video, not `playlist.js`.

Use **MP4 with H.264 video and AAC audio**, preferably 720p or 1080p at a moderate bitrate. An `.mp4` extension alone does not establish codec compatibility. For broad TV compatibility, use an 8-bit `yuv420p` pixel format; encoding with the MP4 metadata at the front (`faststart`) helps playback begin sooner. Test your actual encoding on the target TV. Audio is optional; its startup mute preference is configurable.

If FFmpeg is already installed, an example conversion is:

```sh
ffmpeg -i input.mov -c:v libx264 -pix_fmt yuv420p -crf 23 -c:a aac -b:a 128k -movflags +faststart assets/videos/ad-01.mp4
```

Choose suitably sized input or add an appropriate scale filter for 720p/1080p. FFmpeg is optional and is not part of the app.

## Run locally

Open a terminal in this directory:

```sh
python -m http.server 8000
```

On Windows, `py -m http.server 8000` is another option if the Python launcher is installed. Open **http://localhost:8000/**. Do not use a `file://` URL.

If Python is unavailable, use a static-server editor extension such as VS Code Live Preview, or, if PHP is already installed:

```sh
php -S 127.0.0.1:8000
```

To verify a repository subpath, run the Python command from the **parent directory** and open `http://localhost:8000/Sinage_POC/` (replace the folder name if different). All app assets and video sources resolve relative to that project path.

For a TV on the same network, use the development computer’s LAN IP, for example `http://192.168.1.10:8000/`, while the server is running. The server must accept LAN connections and your firewall must allow the port. `localhost` on a TV refers to the TV itself. **Browser video storage needs a secure context:** GitHub Pages HTTPS or localhost on the computer works; a plain HTTP LAN IP generally does not. In the default background mode, streaming still starts when storage is unavailable; diagnostics records the storage failure. Use the HTTPS GitHub Pages URL for the client caching test.

## Publish to GitHub Pages

1. Create an empty GitHub repository, for example `signage-poc`. A public repository is the simplest POC setup. Keep confidential media and credentials out of the repository and site.
2. In this project directory, initialize Git and push the files. Replace the example remote with your repository URL:

   ```sh
   git init
   git add .
   git commit -m "Add static digital signage POC"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/signage-poc.git
   git push -u origin main
   ```

   If using an existing repository, use its existing branch and remote rather than initializing or adding them again. Confirm that the supplied clips are approved for public sharing before including them; otherwise replace them with approved samples and update the playlist.

3. Open **Settings → Pages → Build and deployment**. Select **Deploy from a branch**, choose **main** and **/(root)**, and save. See GitHub’s [publishing source instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
4. Wait for the Pages deployment to succeed, then open the URL shown there, normally `https://YOUR-USERNAME.github.io/signage-poc/`. Include the repository name and trailing slash.
5. Test that exact URL on desktop, then send it to the client for the TV test. Push subsequent changes to the configured branch and wait for deployment before reloading.

No GitHub repository, remote, or deployment is created automatically by this app.

## Startup settings

Edit `settings.js` and reload the page:

```js
window.SIGNAGE_SETTINGS = {
  startMuted: false,
  fullscreenOnStart: true,
  hideControlsOnStart: true,
  showLogoAlways: true,
  showPlayerControlsButton: false,
  showAdNameAlways: false,
  playbackMode: "stream",
  streamStartupDelaySeconds: 3,
  videoCacheVersion: "1"
};
```

- `startMuted: false` starts with sound enabled. Set it to `true` to start muted for broader autoplay compatibility.
- `fullscreenOnStart: true` requests fullscreen once at launch and retries when Start playback or Resume is selected. Set it to `false` to use only the manual fullscreen button or F shortcut. It does not repeatedly request fullscreen between clips or after an explicit fullscreen exit.
- `hideControlsOnStart: true` starts with the toolbar and status badge hidden. Set it to `false` to start with controls visible, then use the usual 4.5-second auto-hide during playback. **Hide controls** hides them immediately, even if a button has focus or playback is paused.
- `showLogoAlways: true` keeps the top-left logo visible when controls are hidden. Set it to `false` to show the logo only with the controls. **Logo always: On/Off** toggles this during the current session.
- `showPlayerControlsButton: false` hides the floating **Player controls** button. Set it to `true` to offer that clickable way to reopen hidden controls. **Controls button: On/Off** toggles its availability during the current session; it appears only while the toolbar is hidden.
- `showAdNameAlways: false` shows the ad name only in the visible toolbar. Set it to `true` to keep the current playlist title at the bottom-left when the toolbar is hidden. **Ad name always: On/Off** toggles this during the current session. The text updates on every video change.
- `playbackMode` selects the playback strategy; use `"stream"` or `"cache-first"` as described below. Advanced testing can use `"direct"` for immediate network playback without application-managed caching or the startup countdown.
- `streamStartupDelaySeconds: 3` sets the TV color-bar startup interval in stream mode. The first video starts streaming after that interval even if no video is fully cached. Longer waits such as `60` or `120` are supported; there is no 30-second cap. Set `0` to skip the countdown. Negative values are treated as zero; a cached first clip can start immediately without this wait.
- `videoCacheVersion: "1"` identifies the current video content. **Change this value when overwriting an existing filename**, for example to `"2"`, then reload. Otherwise an already prepared file is intentionally reused. Renaming a file or adding a new path prepares that file automatically; removed paths are pruned from this project's media storage.

Choose one mode in `settings.js`, publish the changes, and reload:

| Setting | Startup and playback |
| --- | --- |
| `playbackMode: "stream"` | Show the short initialization countdown, then stream uncached clips while preparing local copies in the background. Fully cached clips are used at later transitions; the first complete file is not required to start. |
| `playbackMode: "cache-first"` | Show initialization progress until every playlist file is fully cached, then play from browser storage. No automatic network playback if preparation fails; Retry initialization or explicitly choose Play without preparation. |

`streamStartupDelaySeconds` applies to stream mode only. Cache-first mode waits for actual file completion, regardless of that countdown setting. Changing modes does not clear already prepared videos. Diagnostics (**D**) displays the selected mode and active source. Invalid mode values stop with a readable settings error.

For older published configurations without `playbackMode`, the previous `cacheVideosBeforePlayback` / `cacheVideosInBackground` flags still work. An explicit `playbackMode` takes precedence; use the single mode setting for new configuration changes.

**Any keyboard or remote key reveals hidden controls**, including letters, arrows, Enter/OK, Tab and Escape. Clicking or tapping the video or player background also reveals them. When controls are already visible, Escape hides them (or closes open diagnostics first). Mouse movement, playback transitions, fullscreen events, and returning to the tab do not reveal hidden controls. If the floating button is enabled, clicking it is another option. Startup, paused, error, and playback-permission prompts remain available so playback can be started or recovered.

These preferences apply on each page load. Manual mute, logo, ad-name, and floating-button changes persist through clip transitions for the current page session and reset on reload. Missing or nonboolean values use the defaults above. Retry reloads the video, so reload the page to pick up settings changes.

Browsers may require a user gesture for [playback with sound](https://developer.chrome.com/blog/autoplay) and [fullscreen](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen). If blocked, press Start playback / OK to retry both from a user action, or use Enter fullscreen directly. Settings cannot override browser policy; fully automatic launch requires compatible browser/device configuration. The player never silently switches to muted playback to bypass a sound permission rejection.

## Stream startup and browser storage

In the default **background mode**, a cold visit displays static TV color bars, the signage logo, **Initializing stream…**, a progress bar, and a short startup countdown. After `streamStartupDelaySeconds`, the first video streams directly from its URL. Startup does not wait for the first complete video or the full playlist. If a cached first clip is available promptly, it starts immediately. Sound/fullscreen policies may still require Start afterward.

Background preparation runs sequentially, prioritizing upcoming clips and initially deferring the clip that is actively streaming. Deferred clips become eligible after a transition; a single-video playlist becomes eligible after its first pass. At each video change, the player selects a completed cached copy if available, otherwise it streams that clip. Cache completion never replaces or restarts the currently playing video. Diagnostics shows the active source and the number of background files ready. Slow cache lookups fall back to streaming after 1.5 seconds; a late local result is released.

The native video stream and background preparation use separate requests. A background request that was started for an upcoming file may overlap with that file's later playback. **Both share the available bandwidth**, so this mode improves time to first playback but cannot guarantee buffer-free playback on a slow first visit. Use lower-bitrate clips or full-preparation mode if that tradeoff is unsuitable. Once clips have complete local copies, later loops can use those copies.

In **cache-first mode** (`playbackMode: "cache-first"`), the initialization screen instead shows videos-ready counts and byte progress when available. Playback waits for the entire playlist. Errors stop this phase until Retry initialization or an explicit Play without preparation choice. Start, Next, and the playback watchdog do not bypass or interrupt full initialization.

The app uses the [Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache) under the current project's URL and stores only complete successful responses. Interrupted or partial responses are never treated as ready. A preparation request with no transfer progress for 60 seconds stops; slow but progressing transfers can take longer overall. Background errors do not interrupt playback. Missing files do not prevent other files from being cached; a storage failure pauses background work, and **Retry** restarts the current clip and permits another preparation attempt. Already cached clips remain usable even after a background storage failure.

Cached videos play from local Blob URLs, avoiding video network range requests during those clips. The previous URL is released after switching sources, so the app does not retain the entire playlist as active Blob URLs. This does not fix unsupported codecs, slow decoding, or device memory limits. Keep clips reasonably small because preparing and opening one complete clip still uses memory.

On subsequent visits, complete files with the same path and version are reused without fetching those videos again. Storage is scoped per project path, so another GitHub Pages project on the same origin is not cleared. In background mode, unavailable or missing storage falls back to streaming without stopping playback. Full-preparation mode retains its explicit error/recovery screen.

Browser storage is [best-effort and may be evicted](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria); clearing site data, using private browsing, or device storage pressure can require initialization again. Quotas are shared at the origin level. There is no service worker and the HTML/CSS/JavaScript page itself is not explicitly cached for offline launch. Prepared media can be reused while the page is open, but this is **not a guarantee of offline reload, offline boot, or unattended kiosk startup**. Validate storage capacity and Blob/video support on the target TV.

## Playback and controls

- After initialization, the player attempts inline autoplay with the sound preference in `settings.js` (sound on by default). If the browser blocks it, select **Start playback** with a click, Enter, or the remote’s OK button. Start also appears while loading or paused.
- Videos advance on `ended` and loop from the last entry to the first. A single video repeats. The app uses one video element for reliability; gaps between clips may occur while the next file loads. Seamless transitions are not guaranteed.
- Controls can start hidden according to settings. Press any key or remote button, or click/tap the video or player background, to reveal them; mouse movement does not reveal hidden controls. When enabled in settings, **Player controls** can also reveal them. **Hide controls** hides them immediately. Visible controls auto-hide after 4.5 seconds of playback when no button has focus; focused controls stay visible for remote navigation.
- **Pause / Resume** retains the current position. **Next video** advances immediately. **Retry** reloads the current file and begins a fresh recovery pass. **Unmute / Mute** lets you change sound during playback; mute preference lasts for the current page session.
- Fullscreen is requested at launch when configured. **Enter fullscreen** requests it manually; **F** is a shortcut. If unsupported or declined, a message explains the fallback; the layout still fills the browser window. Exit with the button or the browser’s Escape/Back behavior.
- **Arrow keys** move through visible, enabled buttons in document order; **Enter/OK** selects. **Tab / Shift+Tab** also work. **D** toggles diagnostics. **Escape** reveals hidden controls, closes open diagnostics, or hides visible controls; a TV’s Back button may instead be handled by its browser.
- Diagnostics shows the original source path, playlist position, player state, time, readiness/network codes, sound, initialization/local-source status, and latest error. Readiness is the HTML media readyState (0–4); network codes are 0=empty, 1=idle, 2=loading, 3=no source. A previous error stays visible after recovery so it can be recorded.

## Failure recovery

Background initialization/storage errors are recorded in diagnostics while streaming continues. A missing or incomplete stored file falls back to its network source. In full-preparation mode, initialization errors wait for manual retry; a missing stored file returns to initialization recovery. During actual playback, a media error or 20 seconds without playback progress produces a readable error. The player waits four seconds, then tries an unfailed playlist entry. It stops automatically once every entry in the current failure pass has failed; it does not repeatedly hammer broken files. Any successful playback starts a fresh pass so a working clip can continue looping past a broken one.

Choose **Retry**, **Next video**, or **Start playback** to try again. Autoplay permission failures instead wait for user input without skipping the video. Intentional pauses do not time out. Repeated `waiting`/`stalled` events cannot keep extending the timeout. Background suspension and execution remain browser-controlled; on returning to the page, the timeout receives a fresh deadline.

## Desktop testing

Test the HTTP URL in Chrome, Edge, and Firefox using at least two real clips. Check their console and Network panel for unexpected script/resource errors. Verify aspect ratio, configured startup sound/fullscreen behavior, ordered progression, wraparound, and sound after an explicit action if autoplay is blocked. Test both values of each setting, reloading between changes. Resize to a small window and to 1920×1080. Use only the keyboard to navigate and trigger each action.

To exercise blocked autoplay, use a browser/profile with autoplay blocked (Firefox offers site autoplay permissions), or change the browser’s autoplay policy. Confirm Start begins playback with the configured sound preference and retries fullscreen when enabled. Test fullscreen entry and exit with actual button presses; browser policy can reject programmatic requests.

For background-mode tests, clear this project's media storage or use a new `videoCacheVersion`. Throttle the connection and confirm the first video begins streaming after the configured countdown without waiting for a full file. Watch diagnostics for background progress. Confirm completing a cache write does not restart playback, and later transitions use cached clips where available. Test a single-video loop, missing clips, and unavailable/full storage. After all clips are cached, reload with the same version and check Network: app files still load, but cached video bodies should be reused.

Also test cache-first mode by setting `playbackMode: "cache-first"`: color bars/logo/progress should remain until every video is ready. Interrupt preparation, retry, and confirm completed files are reused. Once every clip is stored, disconnect and observe at least two transitions in the open page. Do not assume the page will reload offline.

To check full-initialization failure handling, rename a video **and change the cache version** so a cached copy cannot mask it, then restore the file and Retry initialization. For direct-playback skip / finite failure-pass tests, set `playbackMode: "direct"`, reload, and rename one or all files. Restore the desired mode afterward.

Optional controller regression tests, if Node.js 18+ is already installed:

```sh
node --check app.js
node --check settings.js
node --check media-cache.js
node --check playlist.js
node --test tests/playback.test.cjs tests/media-cache.test.cjs
```

These use Node’s built-in test runner, a simulated media element, and an in-memory Cache API implementation. They cover sequencing, looping, autoplay rejection, error recovery, watchdogs, remote controls, initialization gating/progress, complete-file reuse, interrupted transfers, version updates, storage failures, project isolation, eviction, and Blob URL cleanup. They do not replace real codec, storage, browser, or TV tests. No Node/npm installation is needed for the site.

## Android Smart TV / kiosk browser

1. Connect the TV to the internet and open the published URL in its browser. If the TV has no compatible web browser, separately install a compatible browser through an available device/app-store process.
2. On the first visit, the TV color-bar **Initializing stream…** screen briefly counts down, then starts the first stream while preparation continues in the background. Full-preparation mode instead waits for every video. On later visits, cached clips should be reused. Press **Start playback** if prompted. Use directional keys to focus buttons and OK to select. Default audio is enabled; configure `startMuted: true` if you prefer muted startup.
3. Select **Enter fullscreen** if supported. If not, try the browser’s own fullscreen setting or a compatible third-party kiosk browser.
4. Observe at least two transitions and a full playlist loop. Leave playback running for **30–60 minutes**. Use diagnostics to record any failures and the filename/encoding involved.
5. Record the TV make/model, Android/firmware version, browser name/version, tested URL, network, clip codecs/resolution, autoplay/fullscreen results, and duration of the run.
6. If using a kiosk browser, configure its start URL, screen-on behavior, boot launch, and exit/lockdown settings on the device as supported. Power-cycle the TV and record whether it restores the URL and whether playback needs a gesture again.

**Kiosk behavior is device/browser configuration.** A website cannot install a kiosk browser, force kiosk lockdown or fullscreen, guarantee autoplay, keep itself running in the background, or relaunch after power loss. App availability, remote key mapping, boot launch, sleep settings, browser codec support, and persistent media storage must be validated on the actual TV. This POC caches video bodies but has no offline app shell, native APK, remote management, or guaranteed boot-to-app operation.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| “Video not found or format unsupported” | Confirm the file exists, spelling/case matches `playlist.js`, and it is a real MP4 with H.264 video / AAC audio. Open the video’s relative URL directly and inspect Network for 404s. |
| Black video or decode errors | Test a short, known-compatible 720p H.264 clip. Check pixel format, codec profile, resolution and bitrate; HEVC/AV1 in MP4 is not equivalent to H.264. Source footage may also contain black frames. |
| Autoplay blocked | Focus Start playback with arrows and press OK/Enter. Inspect browser autoplay permissions, or set `startMuted: true` in `settings.js` and reload for broader autoplay compatibility. |
| Fullscreen rejected or absent | Use a direct button press; check browser support, fullscreen permissions, and device/browser UI settings. Window-filling playback still works. |
| Initialization cannot use storage | Open the HTTPS Pages URL or localhost. Plain HTTP LAN IPs and some private/TV browsers do not support Cache Storage. Background mode continues streaming; full-preparation mode offers Play without preparation. |
| Not enough browser storage | Free device/site storage or use smaller clips, then Retry. Background errors do not stop streaming, and valid cached clips remain usable. Full-preparation mode waits for Retry initialization. Browser quotas vary by device and are shared by sites on the same origin. |
| Initialization interrupted or stuck | Retry after restoring the connection. The app waits up to 60 seconds without transfer progress, retains completed clips, and never commits a partial file. |
| Old video still plays after replacement | Increase `videoCacheVersion` in `settings.js`, publish it, and reload. A same-name, same-version video is deliberately reused from storage. |
| Pages 404 / videos work only at `/` | Wait for deployment, verify `main` / root and `index.html`, use the repository subpath, check filename case, and remove leading `/` from asset paths. |
| Buffering / 20-second playback timeout | Check whether diagnostics says Network stream or Browser storage. Streaming and background preparation share bandwidth; reduce video bitrate, or use full-preparation mode to avoid first-pass streaming. Local clips can still stall due to codec, memory, or decoding limits. Preparation has a separate 60-second progress deadline. |
| Every clip fails | Supply the actual files, inspect diagnostics, fix paths/encoding, then Retry. The player deliberately stops automatic retries after the failed pass. |
| Playlist edits do not appear | Wait for Pages deployment and reload the page. If necessary clear the browser cache. Retry alone does not reload configuration. |
| Remote or TV browser incompatibility | Test desktop first, then record the TV/browser versions. Try a compatible current browser or kiosk browser; no universal Android TV compatibility is promised. |
| Playback stops after sleep / switching apps | Check TV power-saving, screensaver and browser settings. Background execution and wake behavior are outside this website’s control. |

## GitHub Pages and media limits

GitHub Pages is static hosting for this POC, not a production video CDN. Keep clips short and compressed. Repository/file-size, published-site size, bandwidth, and usage limits apply; review GitHub’s [current Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) before uploading media. Git LFS is not a workaround for serving large clips from standard Pages paths; see [Git LFS limitations](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage). For production distribution, plan separate object storage/CDN delivery.

Treat the repository and Pages URLs as public. Include only approved demo media and never credentials or API secrets in client-side files.

## Manual acceptance checklist

- [ ] Add at least two real MP4 clips; verify all app/media requests from an HTTP URL and a repository subpath.
- [ ] Confirm there are no unexpected JavaScript console errors with valid clips.
- [ ] Verify configured sound/fullscreen startup, a clear Start fallback, and manual Start with mouse and remote/Enter; test both values of each setting.
- [ ] Confirm first-visit color bars, logo and countdown; even the first video streams after the startup interval without waiting for a completed file.
- [ ] Confirm background progress and cached source selection on later transitions; cache completion does not restart the active clip.
- [ ] Test full-preparation mode separately; it should wait for the complete playlist.
- [ ] Reload with the same cache version; confirm videos are reused without video network requests.
- [ ] Interrupt initialization, Retry, and confirm completed videos are retained; test unavailable/full storage recovery.
- [ ] Replace an existing file, bump `videoCacheVersion`, and confirm refreshed content after reload.
- [ ] Observe ordered playback, at least two automatic transitions, and last-to-first looping; repeat with the connection disabled in the already open page.
- [ ] Check Pause/Resume, Retry, Next video, explicit Unmute/Mute, and controls hiding/revealing.
- [ ] Check fullscreen and exit where supported; confirm a useful message where unsupported/declined.
- [ ] Navigate with arrows, Enter/OK, Tab and Escape; check visible focus, D, and diagnostics contents.
- [ ] Test a missing uncached file during initialization; confirm manual recovery. In direct mode, break one video and confirm recovery to the next; break all and confirm automatic attempts stop. Restore and Retry.
- [ ] Check loading stalls/recovery and readable layout at 1920×1080 and smaller screens.
- [ ] Complete desktop checks in Chrome, Edge and Firefox with the actual media.
- [ ] Run on the target TV for 30–60 minutes and record results/device/browser details.
- [ ] Power-cycle the TV; record URL restoration and whether playback requires Start again.

The target hardware, supplied MP4 codec compatibility, sustained TV playback, and kiosk boot behavior require client-side validation; they cannot be certified by static or simulated tests.
