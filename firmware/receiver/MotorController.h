#pragma once

#include <Arduino.h>
#include <math.h>
#include <stdint.h>

#include "BoardPins.h"
#include "MotorDriver.h"
#include "../common/ConfigDefaults.h"
#include "../common/DriveProtocol.h"

namespace gesturedrive {

class MotorController {
 public:
  void begin() {
    driver_.begin();
    targetLeft_ = 0.0F;
    targetRight_ = 0.0F;
    currentLeft_ = 0.0F;
    currentRight_ = 0.0F;
    lastUpdateMicros_ = micros();
  }

  void applyCommand(const DrivePacket& packet) {
    if (packet.type == COMMAND_STOP ||
        (packet.flags & FLAG_ENABLE) == 0U) {
      setStop();
      return;
    }

    float left = 0.0F;
    float right = 0.0F;
    if (packet.type == COMMAND_DRIVE) {
      left = static_cast<float>(packet.channelA) -
             config::K_TURN * static_cast<float>(packet.channelB);
      right = static_cast<float>(packet.channelA) +
              config::K_TURN * static_cast<float>(packet.channelB);
      const float peak = maxFloat(1000.0F, maxFloat(fabsf(left), fabsf(right)));
      left = left * 1000.0F / peak;
      right = right * 1000.0F / peak;
      const float speedScale = static_cast<float>(packet.speedLimit) / 1000.0F;
      left *= speedScale;
      right *= speedScale;
    } else {
      const float limit = static_cast<float>(packet.speedLimit);
      left = clampFloat(static_cast<float>(packet.channelA), -limit, limit);
      right = clampFloat(static_cast<float>(packet.channelB), -limit, limit);
    }

    targetLeft_ = calibrate(left, receiver_pins::LEFT_INVERTED,
                            config::LEFT_GAIN, config::PWM_MIN_LEFT_FWD,
                            config::PWM_MIN_LEFT_REV);
    targetRight_ = calibrate(right, receiver_pins::RIGHT_INVERTED,
                             config::RIGHT_GAIN, config::PWM_MIN_RIGHT_FWD,
                             config::PWM_MIN_RIGHT_REV);
    if ((targetLeft_ != 0.0F || targetRight_ != 0.0F) &&
        !driver_.isEnabled()) {
      driver_.setEnabled(true);
    }
  }

  void setStop() {
    targetLeft_ = 0.0F;
    targetRight_ = 0.0F;
    currentLeft_ = 0.0F;
    currentRight_ = 0.0F;
    // Explicit STOP and watchdog STOP bypass the motion ramp. Ramping remains
    // active for ordinary speed changes and safe direction reversals.
    driver_.write(0, 0);
  }

  void emergencyStop() {
    targetLeft_ = 0.0F;
    targetRight_ = 0.0F;
    currentLeft_ = 0.0F;
    currentRight_ = 0.0F;
    driver_.disable();
  }

  void disable() {
    targetLeft_ = 0.0F;
    targetRight_ = 0.0F;
    currentLeft_ = 0.0F;
    currentRight_ = 0.0F;
    driver_.disable();
  }

  void update() {
    const uint32_t nowMicros = micros();
    float deltaSeconds = static_cast<float>(nowMicros - lastUpdateMicros_) /
                         1000000.0F;
    lastUpdateMicros_ = nowMicros;
    if (deltaSeconds <= 0.0F) return;
    if (deltaSeconds > 0.05F) deltaSeconds = 0.05F;

    currentLeft_ = rampOne(currentLeft_, targetLeft_, deltaSeconds);
    currentRight_ = rampOne(currentRight_, targetRight_, deltaSeconds);
    driver_.write(static_cast<int16_t>(lroundf(currentLeft_)),
                  static_cast<int16_t>(lroundf(currentRight_)));
  }

  int16_t leftOutput() const {
    return static_cast<int16_t>(lroundf(currentLeft_));
  }

  int16_t rightOutput() const {
    return static_cast<int16_t>(lroundf(currentRight_));
  }

 private:
  static float clampFloat(float value, float minimum, float maximum) {
    return value < minimum ? minimum : (value > maximum ? maximum : value);
  }

  static float maxFloat(float left, float right) {
    return left > right ? left : right;
  }

  static float calibrate(float command, bool inverted, float gain,
                         int16_t minimumForward, int16_t minimumReverse) {
    if (inverted) command = -command;
    command *= gain;
    command = clampFloat(command, -static_cast<float>(config::MAX_PWM),
                         static_cast<float>(config::MAX_PWM));
    if (fabsf(command) < 0.5F) return 0.0F;

    const bool forward = command > 0.0F;
    const float minimum = static_cast<float>(
        forward ? minimumForward : minimumReverse);
    const float magnitude = fabsf(command);
    const float calibrated = minimum +
        (magnitude / static_cast<float>(config::MAX_PWM)) *
            (static_cast<float>(config::MAX_PWM) - minimum);
    return forward ? calibrated : -calibrated;
  }

  static float rampOne(float current, float requestedTarget,
                       float deltaSeconds) {
    // A reversal first ramps to zero. The direction pins only switch after the
    // current command has crossed zero.
    float effectiveTarget = requestedTarget;
    if (current * requestedTarget < 0.0F) effectiveTarget = 0.0F;

    const float difference = effectiveTarget - current;
    if (fabsf(difference) < 0.5F) return effectiveTarget;
    const bool increasingMagnitude =
        fabsf(effectiveTarget) > fabsf(current);
    const float rate = increasingMagnitude ? config::RAMP_UP_PER_SECOND
                                           : config::RAMP_DOWN_PER_SECOND;
    const float maximumStep = rate * deltaSeconds;
    if (fabsf(difference) <= maximumStep) return effectiveTarget;
    return current + (difference > 0.0F ? maximumStep : -maximumStep);
  }

  MotorDriver driver_;
  float targetLeft_ = 0.0F;
  float targetRight_ = 0.0F;
  float currentLeft_ = 0.0F;
  float currentRight_ = 0.0F;
  uint32_t lastUpdateMicros_ = 0;
};

}  // namespace gesturedrive
