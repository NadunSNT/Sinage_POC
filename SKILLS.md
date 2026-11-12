# SKILLS.md — Digital Signage Browser POC

## Project purpose
Build a small, static digital signage proof of concept (POC) that runs in desktop browsers and on a client's Android Smart TV through a URL hosted on GitHub Pages. No backend, database, authentication, cloud storage, build framework, or native Android APK is required for this phase.

## Technology and implementation constraints
- Use plain HTML5, CSS3, and modern vanilla JavaScript. Avoid npm, build steps, external JavaScript dependencies, and CDNs.
- The project must deploy directly from a GitHub Pages repository and work under a repository subpath such as `https://username.github.io/signage-poc/`.
- Use relative asset paths; never assume the app is hosted at the domain root.
- Sample video files are added by the user under `assets/videos/`. Do not invent binary video files or commit large generated media.
- Keep video metadata in a small editable `playlist.js` or `playlist.json`; choose an approach that works reliably on GitHub Pages and local HTTP servers. Document how to add or remove videos.
- Prefer MP4 H.264 video with AAC audio, 720p or 1080p, optimized for broad TV browser compatibility.
- Make the UI legible at 1920×1080 and usable with a TV remote's directional keys/OK button, keyboard, and mouse.
- Do not assume autoplay, fullscreen, kiosk mode, or background execution can be forced by a website. Browser/device policy controls those capabilities.

## Expected playback behavior
1. On launch, load the configured playlist and attempt muted, inline autoplay (`autoplay`, `muted`, `playsinline`).
2. Play one video at a time. On the `ended` event, advance to the next item; loop to the first after the last.
3. Hide player controls during normal playback and use a dark, distraction-free, full-viewport layout.
4. If autoplay is blocked, show a prominent **Start playback** action accessible via TV remote, Enter, and click.
5. Provide a user-initiated **Enter fullscreen** action; use the Fullscreen API when supported and display a helpful fallback if unsupported.
6. Gracefully handle unsupported codecs, missing files, loading stalls, and playback errors. Show readable status and allow **Retry** or **Next video** without an infinite tight error loop.
7. Avoid black flashes between videos where practical; do not sacrifice reliability for complex preloading.
8. Provide a small, optional diagnostics overlay toggled by a keyboard shortcut or accessible button, showing current filename, playlist position, playback state, and latest error.
9. Support desktop-browser testing first, then Android TV browser and compatible kiosk-browser testing.
10. Keep audio muted by default for maximum autoplay compatibility; user may explicitly unmute if permitted.

## Suggested file structure
```
/
  index.html
  styles.css
  app.js
  playlist.js
  assets/
    videos/
      .gitkeep
  README.md
  SKILLS.md
  PROMPT.md
```

## Testing and quality expectations
- Test locally using a simple HTTP server (e.g. `python -m http.server 8000`); do not rely on opening `index.html` as a `file://` URL.
- Verify playback, automatic progression, loop, muted autoplay fallback, manual start, fullscreen action, keyboard/remote navigation, missing-video handling, and responsive layout.
- Verify all resource URLs work from a GitHub Pages project subpath.
- Include clear GitHub Pages deployment instructions in README (Settings → Pages → Deploy from a branch → main / root, or equivalent current UI).
- Provide a TV test checklist: open URL, start playback if prompted, enter fullscreen if supported, observe at least two transitions, loop, leave running 30–60 minutes, power-cycle TV, and record whether kiosk browser restores the URL.
- Clearly explain that kiosk auto-launch and kiosk lockdown are **device/browser configuration**, not capabilities implemented by this static web app.
- Do not claim offline playback or seamless boot-to-app operation unless explicitly implemented and tested on the target hardware.

## GitHub Pages and media caveats
- GitHub Pages serves static files only. It is not a production video CDN and has repository/file-size, site-size, bandwidth, and usage constraints. Use short, compressed sample clips and consult GitHub's current limits before uploading.
- Large video files and Git LFS are not a solution for directly serving media through standard GitHub Pages URLs; for a later production phase use object storage/CDN.
- Never put credentials or API secrets into client-side JavaScript.
- GitHub Pages URLs are public; do not include confidential customer advertisements in the POC repository.

## Coding style
- Keep code readable, modular, and commented where device/browser quirks matter.
- Use semantic HTML, visible focus styles, robust async error handling, and no unnecessary animation.
- Favor predictable behavior on older Android WebView/TV browsers over clever browser APIs.
- When a requirement depends on the actual TV model, note it as a validation item rather than promising universal support.
