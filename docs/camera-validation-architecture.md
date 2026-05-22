# Camera Validation Architecture

> **Status: deferred — architecture only.**
> The `Validator` seam exists in `src/granbridge/vision/validator.py`.
> No CV code is implemented. This document records why, what the full system
> would look like, and how it would integrate with the event bus.

---

## 1. Why Deferred

GRANBRIDGE is a portable Windows darts companion app. The board's BLE protocol
already reports every dart hit — segment, ring, multiplier, and score — with
millisecond timestamps. That is the primary and authoritative scoring path.

Camera-based validation would add independent corroboration, but it carries
significant cost that does not yet justify itself:

- **Hardware rig.** Accurate dart-tip localisation requires 2–3 physically
  calibrated cameras mounted above the board at fixed, non-trivial angles. The
  user's choice to use cameras as streaming *player-cams* (showing the thrower)
  is explicitly in conflict with the camera positions needed for CV autoscoring:
  player-cams face the player, not the board face.
- **Calibration complexity.** Each camera must be intrinsically calibrated
  (lens distortion coefficients, focal length, principal point) and
  extrinsically registered to a shared board coordinate frame. Calibration must
  be re-run whenever a camera shifts.
- **Dependency weight.** OpenCV and NumPy would be added as hard runtime
  dependencies, significantly increasing install size and complicating the
  portable-Windows packaging target.
- **Sensor redundancy.** Because the BLE board already has high-accuracy
  scoring, camera validation would be a *cross-check* for anti-cheat or
  disputed throws rather than a primary input. The benefit is real but not
  urgent for the current single-player and casual-multiplayer scope.

The decision was therefore to introduce a **seam** (`Validator`) now, so the
rest of the engine is already written against the interface, and defer the CV
implementation until the hardware rig, calibration tooling, and dependency
story are properly addressed.

---

## 2. Rig and Calibration Overview

When camera validation is eventually implemented, the recommended rig is:

- **Camera count:** 2 cameras minimum (triangulation requires at least 2 views),
  3 cameras recommended for robustness against occlusion by the dart flights or
  shaft.
- **Mounting:** Cameras mount above and to the side of the board, pointed at
  the board face at known angles. Rigid, vibration-free mounts are essential —
  any shift invalidates the extrinsic calibration.
- **Intrinsic calibration:** Each camera is calibrated offline with a
  checkerboard pattern (e.g., using `cv2.calibrateCamera`). Coefficients are
  stored in a per-camera config file and loaded at startup.
- **Extrinsic calibration:** A shared world frame is defined with the board
  centre as origin. Each camera's rotation and translation relative to that
  frame is determined by detecting known board landmarks (bull, wire corners of
  the doubles ring) in all cameras simultaneously and running a multi-view PnP
  solve. The resulting camera matrices allow projecting 3-D board points into
  each camera's image plane.
- **Re-calibration trigger:** A calibration check should run at startup by
  detecting the board landmarks and comparing their reprojection error against
  a threshold. If the error exceeds the threshold the session starts in
  "unvalidated" mode and the user is prompted to recalibrate.

---

## 3. Detection Pipeline

Once the rig is calibrated, each dart throw follows this pipeline:

1. **Frame capture.** All cameras record at a sufficient frame rate (≥60 fps)
   to catch the dart at rest before it may be pulled. Frames are timestamped
   synchronously using a shared trigger or PTP.

2. **Background subtraction.** A per-camera background model (e.g., MOG2) is
   maintained for the static board face. After each throw, the foreground mask
   isolates the dart shaft and flights.

3. **Dart-tip localisation.** Within the foreground region, the dart tip is
   located in 2-D image coordinates. The shaft line can be fitted (Hough
   transform or RANSAC line fit on the foreground skeleton) and extrapolated to
   the board face to find the tip pixel.

4. **Multi-view triangulation.** With tip pixel coordinates from at least 2
   cameras and the known camera projection matrices, the 3-D position of the
   dart tip is triangulated (e.g., `cv2.triangulatePoints` or a DLT linear
   solve). This yields a 3-D point in the board coordinate frame.

5. **Board-segment mapping.** The 3-D tip position is projected onto the board
   face plane (Z ≈ 0 in the board frame). The 2-D polar coordinates (radius
   from bull centre, angle) are mapped to the standard dartboard segment layout
   (20 segments × 4 rings + bull/double-bull). The result is a `detected_bed`
   string (e.g. `"T20"`, `"D16"`, `"BULL"`).

6. **Confidence scoring.** Reprojection error across all cameras and the
   quality of the tip localisation are combined into a `confidence` float in
   `[0, 1]`. Low-confidence detections (e.g., dart obscured by flight shadow)
   are returned with `confidence < 0.5` so the caller can decide whether to
   trust the result.

---

## 4. Integration via the Validator Seam

The abstract base class `Validator` (in `granbridge.vision.validator`) defines
a single method:

```python
def validate(self, dart_hit: DartHit) -> ValidationResult:
    ...
```

`ValidationResult` carries three fields:

| field | type | meaning |
|---|---|---|
| `agreed` | `bool` | Camera detection agrees with BLE-reported bed |
| `detected_bed` | `Optional[str]` | Bed string the camera detected (or `None` if undetectable) |
| `confidence` | `float` | Detection confidence in `[0, 1]` |

When a CV implementation is ready it will subclass `Validator`, implement
`validate`, and be injected wherever the engine currently receives
`NoOpValidator`. No other engine code needs to change.

**Proposed `validation` event.** When the validator disagrees
(`agreed=False`) or returns low confidence, the engine should emit a new
`validation` event onto the event bus so that plugins (e.g., a referee UI,
an anti-cheat logger) can react. A sketch of the event model:

```python
class ValidationEvent(BaseEvent):
    type: Literal["validation"] = "validation"
    dart_hit_bed: str          # what the BLE board reported
    detected_bed: Optional[str]
    agreed: bool
    confidence: float
```

This event type is **not yet registered** in `schema_export.py` or
`registry.py` — Task D (integration wiring) would add it at the same time
as wiring the concrete `Validator` implementation into the engine's
`dart_hit` handling path.

---

## 5. The `NoOpValidator` — Current Seam

`NoOpValidator` is the current production implementation. It always returns:

```python
ValidationResult(agreed=True, detected_bed=dart_hit.bed, confidence=1.0)
```

In other words, it unconditionally trusts the BLE board — which is correct
behaviour for a board that is the sole authoritative sensor. It produces no
side-effects, imports no CV libraries, and adds zero latency.

Any future CV `Validator` replaces `NoOpValidator` at construction time via
dependency injection; the engine code path does not change.
