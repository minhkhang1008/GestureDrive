#pragma once

#include <math.h>
#include <stdint.h>

// Pure drive math shared by the receiver firmware and the host unit tests.
// Deliberately free of Arduino, RadioLib and board headers so it can be
// compiled and exercised on the development machine: this is the code path
// that decides how much current reaches the motors, so it is the code path
// that most deserves tests.

namespace gesturedrive {
namespace drive_math {

struct MotorPair {
  float left;
  float right;
};

inline float clampFloat(float value, float minimum, float maximum) {
  return value < minimum ? minimum : (value > maximum ? maximum : value);
}

/**
 * Differential mix. Throttle and steering both arrive in -1000..1000; the
 * result is renormalized so a saturated wheel scales the pair down instead of
 * clipping it, which would otherwise turn a hard forward-left command into a
 * straight-ahead one.
 */
inline MotorPair mixDifferentialDrive(float throttle, float steering,
                                      float turnGain) {
  const float boundedThrottle = clampFloat(throttle, -1000.0F, 1000.0F);
  const float boundedSteering = clampFloat(steering, -1000.0F, 1000.0F);
  float left = boundedThrottle - turnGain * boundedSteering;
  float right = boundedThrottle + turnGain * boundedSteering;
  float peak = fabsf(left) > fabsf(right) ? fabsf(left) : fabsf(right);
  if (peak < 1000.0F) peak = 1000.0F;
  return MotorPair{left * 1000.0F / peak, right * 1000.0F / peak};
}

/** Scales a mixed pair by the operator's speed limit (0..1000). */
inline MotorPair scaleToSpeedLimit(MotorPair pair, float speedLimit) {
  const float scale = clampFloat(speedLimit, 0.0F, 1000.0F) / 1000.0F;
  return MotorPair{pair.left * scale, pair.right * scale};
}

/**
 * One ramp step toward the target. A reversal ramps to zero first, so the
 * direction pins only ever switch with the command already at zero.
 */
inline float rampToward(float current, float requestedTarget,
                        float deltaSeconds, float upPerSecond,
                        float downPerSecond) {
  float effectiveTarget = requestedTarget;
  if (current * requestedTarget < 0.0F) effectiveTarget = 0.0F;

  const float difference = effectiveTarget - current;
  if (fabsf(difference) < 0.5F) return effectiveTarget;
  const bool increasingMagnitude = fabsf(effectiveTarget) > fabsf(current);
  const float rate = increasingMagnitude ? upPerSecond : downPerSecond;
  const float maximumStep = rate * deltaSeconds;
  if (fabsf(difference) <= maximumStep) return effectiveTarget;
  return current + (difference > 0.0F ? maximumStep : -maximumStep);
}

struct MotorCalibration {
  bool inverted;
  float gain;
  int16_t minimumForward;  // breakaway floor, normalized 0..1000
  int16_t minimumReverse;
  int16_t maxPwm;
  float engageDeadband;
};

/**
 * Write-time calibration: engage deadband, inversion, per-wheel gain, the
 * MAX_PWM ceiling and the breakaway-floor remap, applied to the already-ramped
 * command so per-wheel trim never distorts the motion ramp.
 */
inline int16_t calibrateOutput(float command, const MotorCalibration& config) {
  // Command noise near zero must not chatter across the breakaway floor: the
  // remap below jumps from 0 straight to the floor value.
  if (fabsf(command) < config.engageDeadband) return 0;

  if (config.inverted) command = -command;
  command *= config.gain;
  const float ceiling = static_cast<float>(config.maxPwm);
  command = clampFloat(command, -ceiling, ceiling);
  if (fabsf(command) < 0.5F) return 0;

  const bool forward = command > 0.0F;
  const float minimum = static_cast<float>(forward ? config.minimumForward
                                                   : config.minimumReverse);
  const float magnitude = fabsf(command);
  const float calibrated =
      minimum + (magnitude / ceiling) * (ceiling - minimum);
  return static_cast<int16_t>(lroundf(forward ? calibrated : -calibrated));
}

}  // namespace drive_math
}  // namespace gesturedrive
