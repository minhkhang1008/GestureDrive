# AI gesture pipeline

## Model decision

GestureDrive uses the MediaPipe **Hand Landmarker full float16 task model**.
The model returns handedness plus 21 normalized 3D landmarks for each of at
most two hands.

This model is a better fit than a general image classifier because the
controls are partly discrete and partly continuous:

- open/fist selects the control and speed roles;
- the control-hand displacement is a continuous analog joystick vector
  (the eight direction codes are display-only labels);
- palm/back orientation validates forward and reverse movement;
- thumb-index pinch grabs a relative-drag speed slider.

A gesture classifier can label poses, but it cannot directly provide the
low-latency continuous position needed by the direction and speed controls.
MediaPipe Gesture Recognizer also includes a classifier that is unnecessary
for this control vocabulary. MoveNet and BlazePose do not expose finger
landmarks. A custom CNN/ONNX classifier would require a representative
dataset and would still need a separate tracker for continuous control.

Official reference material:

- [Hand Landmarker overview and benchmark](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
- [Hand Landmarker for Web](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js)
- [Two-hand browser benchmark for MediaPipe Hands and TensorFlow.js](https://blog.tensorflow.org/2021/11/3D-handpose.html)

The Google benchmark for the current Hand Landmarker full pipeline on Pixel 6
is 17.12 ms on CPU and 12.27 ms on GPU. These figures are reference values,
not a guarantee for the operator laptop. GestureDrive displays the measured
inference and capture-to-result latency in the camera panel.

## Low-latency architecture

`detectForVideo()` is synchronous. Running it in the React animation loop
blocks rendering, Web Serial heartbeat scheduling, and input handling.
GestureDrive therefore transfers `ImageBitmap` frames to a dedicated worker.

```text
1280x720 camera (requestVideoFrameCallback, rAF fallback)
      |
      | latest frame only, downscaled to <=360 px height
      | (ImageBitmap, transferable)
      v
Hand Landmarker worker ---- GPU first, CPU fallback, warm-up inference
      |
      | 2 x 21 landmarks + handedness
      v
hand tracker ---- persistent ids, jump rejection, quality score, velocity
      |
      | tracked hands (smoothed + latency-compensated centers)
      v
deterministic gesture logic (mirrored, planar, span-normalized)
      |
      v
STOP / DRIVE command state
```

- **Capture scheduling.** Frames are captured with
  `video.requestVideoFrameCallback`, which fires exactly once per delivered
  camera frame; `requestAnimationFrame` polling remains as the fallback for
  browsers without it.
- **Capture downscale.** The camera still runs at 1280x720 (ideal 30 FPS, max
  60), but each frame is downscaled to at most 360 px height inside
  `createImageBitmap` before transfer. The landmark model consumes ~224 px
  inputs, so shipping full 720p bitmaps only adds copy and preprocessing cost.
- **Single inference in flight.** Frames arriving while the worker is busy are
  not queued; the next fresh camera frame is captured after the result. This
  keeps the result close to real time instead of processing a backlog.
- **Warm-up inference.** The worker runs one inference on a black 64x64 canvas
  right after model creation, so GPU shader compilation and memory allocation
  do not appear as a several-hundred-ms hitch on the first real frame.
- **Worker recycle.** After 5 consecutive `detectForVideo()` errors the worker
  is terminated and rebuilt once with the CPU delegate forced. A second string
  of failures stops recognition with an error status instead of looping.
- **Adaptive delegate.** A GPU delegate that silently lands on a software
  rasterizer is slower than the CPU one and adds latency to every command. The
  worker watches its own inference times and, if at least 80% of a 30-frame
  window exceeds 55 ms, rebuilds itself on CPU once. Frames are dropped for the
  duration of the rebuild rather than reported as "no hands", so the host
  watchdog stops the vehicle while no recognition is running.
- **AI-result watchdog.** A 150 ms-interval watchdog, independent of the
  capture loop, forces STOP and shows a banner whenever no worker result has
  arrived for 350 ms. A separate 250 ms camera-frame timeout resets the hand
  roles when the camera stops delivering frames.
- **Self-hosted assets.** `npm run vendor:mediapipe` (run automatically before
  `dev`/`build`) copies the MediaPipe WASM runtime and downloads
  `hand_landmarker.task` into `public/mediapipe/`. The worker prefers these
  same-origin copies and falls back to the CDN when they are absent, so AUTO
  mode can run fully offline.
- **Dev-server asset route.** MediaPipe fetches its ESM WASM loader with a
  runtime `import(url)`. In `vite dev` that request would reach Vite's
  transform middleware, which refuses anything under `public/` and breaks AUTO
  initialization entirely. `vite.config.ts` therefore installs a middleware
  ahead of the internal ones that serves `/mediapipe/*` verbatim off disk
  (ignoring the `?fallback=cpu` query the worker appends to force the CPU
  loader to re-evaluate). Production is unaffected — `vite build` copies
  `public/` as-is. Do not remove that plugin without re-testing `npm run dev`.

## Control contract

### Coordinate space

Landmarks are mirrored **once at ingestion** (`x -> 1 - x`), so all gesture
math and all overlay drawing happen in the same mirrored, user-facing space
the operator sees on screen; handedness labels keep MediaPipe's original
meaning. "Planar" space additionally multiplies x by the video aspect ratio so
distances are isotropic (a circle in planar space is a circle on screen). All
displacement thresholds are expressed in **span units**: planar distance
divided by the palm scale, `max(wrist->middle-MCP, index-MCP->pinky-MCP)`,
which is pose-invariant (does not change between an open hand and a fist), so
every threshold is independent of how far the hand sits from the camera.

### Hand identity and tracking quality

MediaPipe returns an unordered list of hands per frame with no stable identity:
the array order can swap between frames, and the handedness label flips on an
ambiguous view. `src/lib/handTracking.ts` therefore assigns each hand a
persistent id before any gesture logic runs.

- **Association.** Each track predicts its next position from its own velocity;
  detections are matched cheapest-pair-first, in palm-span units, with a soft
  penalty for a handedness disagreement and a 3-span gate. The driving roles
  bind to these ids, so a role stays attached to a physical hand even when the
  operator's hands cross the screen midline.
- **Jump rejection.** A detection that moves a track faster than
  **14 spans/second** is velocity-limited rather than followed. A human hand
  sweeping across the frame in 0.2 s moves at roughly 8 spans/s; a
  mis-detection that latches onto a face or a bystander teleports at 40+, so
  the threshold separates them cleanly. This is what stops a single bad frame
  from becoming a full-throttle command.
- **Re-acquisition.** If the detection insists for three consecutive frames,
  the track snaps to it, drops its smoothing history and restarts its quality
  from zero — the vehicle is stopped for the ~5 frames the track needs to earn
  confidence back. A detection beyond the association gate entirely creates a
  separate track instead, which cannot inherit a role.
- **Coasting.** A track survives 120 ms without a detection, holding its last
  position while its quality decays, so a single dropped frame does not cost
  the operator the role setup.
- **Quality (0..1)** multiplies handedness score, track age, coast decay, palm
  size, association residual and a jump penalty. Any factor collapsing to zero
  stops the vehicle. Driving requires **>= 0.5** on *both* role hands; the
  camera panel shows the worse of the two as `bám tay`, and the skeleton is
  drawn blue / amber / red accordingly.

### Role setup

1. Place one hand on each half of the mirrored preview.
2. Open the intended control hand.
3. Make a fist with the intended speed hand (thumb ignored; the four long
   fingers decide open/fist).
4. Hold for six valid inference results (`SETUP_STABLE_FRAMES = 6`).

Setup requires exactly two tracked hands, both already above the quality
threshold, one on each half. The control hand's smoothed palm center at
confirmation becomes the joystick anchor.

Once bound, a role follows its track id. If the track is dropped, the role is
kept for a further 800 ms (vehicle stopped) and re-binds to an unclaimed,
trusted hand of the same handedness on the same side — a hand that briefly
left the frame keeps its role. Only after that grace period, or after both
hands are absent for 800 ms, does the open/fist setup have to be repeated.

### Direction hand: fully analog joystick

The drive command is **analog**, not sector-based. Per frame:

1. The palm center (average of wrist and the four finger MCPs) is smoothed by
   the track's One-Euro filter (`minCutoffHz = 1.2`, `beta = 0.025`) — adaptive
   low-pass that stays smooth on a near-still hand yet tracks fast motion with
   minimal lag — and then extrapolated along the track's own velocity by the
   measured capture-to-result latency. The horizon is capped at **45 ms** and
   the resulting displacement at **0.15 span**, so an over-estimated velocity
   can add at most a fraction of the dead-zone-to-full-scale travel and never
   invent a command on its own. This is what removes the perceived lag between
   moving the hand and the wheels responding.
2. The displacement from the anchor is divided by an EMA of the palm scale,
   giving a span-normalized vector.
3. A radial dead zone with hysteresis gates activity: driving starts above
   **0.18 span** and stops below **0.12 span**.
4. Outside the dead zone, the magnitude is normalized to reach 1.0 at
   **1.1 span** and shaped by an RC-style expo curve (`expo = 0.3`) — finer
   control near the center, full authority at the edge.
5. The result maps to throttle/steering in -1000..1000 (screen up = forward,
   screen right = turn right), quantized to steps of 20 to bound serial churn.

While the hand rests inside the dead zone the anchor slowly re-centers toward
the filtered palm (EMA alpha 0.03), so slow posture drift never turns into a
phantom command.

**Orientation gate.** Forward motion (throttle > +200) requires the palm to
face the camera; reverse (throttle < -200) requires the back of the hand. The
palm/back decision projects the **palm normal** onto the camera axis: the 2D
cross product of the wrist->index-MCP and wrist->pinky-MCP vectors in planar
space, normalized by the squared palm scale and signed by handedness. Unlike a
plain index-vs-pinky x offset this does not depend on how the hand is rotated
in the image plane, so the gate keeps working with the fingers pointing
sideways or down. A 0.06 hysteresis band absorbs the zero crossing of an
edge-on hand. A violation produces an immediate STOP plus an on-screen hint.

**Sectors are display-only.** The eight codes `F`, `B`, `L`, `R`, `FL`, `FR`,
`BL`, `BR` are still computed — with 8 degrees of angular hysteresis so the
label does not flicker on boundaries — but they only drive the UI (HUD and
log labels). The transmitted command carries the analog channels.

The camera overlay draws the anchor, the dead-zone ring (enter radius), the
full-deflection ring, and the live displacement vector, all in the same
mirrored video-pixel space as the skeleton.

### Speed hand: relative pinch drag, and a value that outlives the hand

The speed hand acts like a draggable slider, not an absolute position control:

- thumb-index pinch **grabs** the slider (enter when pinch distance / palm
  scale <= 0.42, release when > 0.56 — separate enter/exit thresholds prevent
  grab/release flicker);
- while pinching, vertical motion changes the value **relative to the grab
  point**: one hand-span of travel = 500 speed units
  (`SPEED_DRAG_GAIN_PER_SPAN`), with a One-Euro-filtered pinch midpoint and a
  4-unit deadband; the value never teleports to the hand's absolute height;
- release (with at least two of the middle/ring/pinky fingers open) locks the
  value.

**The speed hand is optional once its value is set.** `SpeedSlider`
(`src/lib/speedControl.ts`) owns the value independently of whether the hand is
visible, so taking the hand out of frame holds the last value and the operator
keeps driving one-handed. An in-progress grab is released on the way out, so
the hand returning at a different height starts a fresh drag instead of
resuming against a stale grab point.

An **invalid pose holds the value too**, exactly like an absent hand. A
half-formed hand is strictly less informative than no hand at all, so it must
not be the more dangerous of the two — and without this, slowly lowering the
speed hand would pass through "invalid" and stutter the vehicle to a stop on
the way down.

**Dead-man consequence.** The control hand alone is now the dead-man: losing
it, or its quality dropping below 0.5, is what stops the vehicle. Requiring
both hands continuously is no longer part of the safety chain. The slider
starts at 0 after every role setup, so the vehicle cannot move until a speed
has been deliberately chosen.

### Watchdogs and failure handling

- No worker result for **350 ms**: forced STOP, "AI không phản hồi" banner.
- No fresh camera frame for 250 ms: roles reset, STOP.
- 5 consecutive detect errors: worker recycled GPU -> CPU (one attempt).
- Sustained slow GPU inference: worker rebuilds itself on CPU (one attempt).
- Control hand below quality 0.5: STOP, roles kept.
- Control hand re-acquiring after a rejected jump: STOP, "Đang bắt lại bàn tay"
  banner, roles kept.
- Control hand's track dropped: STOP; roles survive 800 ms for a re-bind, then
  reset.
- Speed hand absent, untrusted or in an invalid pose: **no stop** — the last
  speed limit is held and driving continues.
- Both hands absent for 800 ms: roles reset, STOP.

## Measured performance

The camera panel displays:

- `GPU worker` or `CPU worker`;
- `AI`: worker-side `detectForVideo()` duration;
- `tổng`: time from frame capture until the result reaches the UI;
- processed FPS in the top bar.

For the physical test, record at least 60 seconds with two hands visible and
report median, p95, and maximum total latency. A p95 above 100 ms should be
investigated before driving the vehicle on the floor.
