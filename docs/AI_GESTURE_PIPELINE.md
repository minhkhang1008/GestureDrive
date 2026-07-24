# AI gesture pipeline

## Model decision

GestureDrive uses the MediaPipe **Hand Landmarker full float16 task model**.
The model returns handedness plus 21 normalized 3D landmarks for each of at
most two hands.

This model is a better fit than a general image classifier because the
controls are partly discrete and partly continuous:

- open/fist selects the control and speed roles;
- the control-hand displacement selects one of eight directions;
- palm/back orientation validates forward and reverse movement;
- thumb-index pinch grabs a continuous vertical speed slider.

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
1280x720 camera
      |
      | latest frame only (ImageBitmap, transferable)
      v
Hand Landmarker worker ---- GPU first, CPU fallback
      |
      | 2 x 21 landmarks + handedness
      v
deterministic gesture logic
      |
      v
STOP / DRIVE command state
```

Only one inference may be in flight. Frames arriving while the worker is busy
are not queued. The next fresh camera frame is captured after the result. This
keeps the result close to real time instead of processing an increasingly old
backlog.

The camera request remains 1280x720 with an ideal 30 FPS and an allowed maximum
of 60 FPS. MediaPipe performs its own model preprocessing. No lower-resolution
fallback is used.

## Control contract

### Role setup

1. Place one hand on each half of the mirrored preview.
2. Open the intended control hand.
3. Make a fist with the intended speed hand.
4. Hold for six valid inference results.

Removing both hands for 800 ms clears the roles so they can be swapped.

### Direction hand

The palm center at setup is the joystick origin. Moving outside the radial
dead zone selects one of eight sectors:

`F`, `B`, `L`, `R`, `FL`, `FR`, `BL`, `BR`.

Forward sectors require the palm to face the camera. Reverse sectors require
the back of the hand to face the camera. Returning to the center or violating
the orientation rule produces an immediate STOP. Movement transitions require
two matching inference results to suppress one-frame jitter.

### Speed hand

The speed hand uses an OK-style thumb-index pinch:

- pinch: grab and adjust the vertical slider;
- move upward: increase the limit;
- move downward: decrease the limit;
- release while keeping at least two supporting fingers open: lock the value;
- invalid speed pose for two inference results: STOP.

Pinch distance is normalized by palm size and uses separate enter/exit
thresholds. This makes the gesture scale-independent and prevents rapid
grab/release flicker near the threshold.

## Measured performance

The camera panel displays:

- `GPU worker` or `CPU worker`;
- `AI`: worker-side `detectForVideo()` duration;
- `tổng`: time from frame capture until the result reaches the UI;
- processed FPS in the top bar.

For the physical test, record at least 60 seconds with two hands visible and
report median, p95, and maximum total latency. A p95 above 100 ms should be
investigated before driving the vehicle on the floor.
