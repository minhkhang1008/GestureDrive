#pragma once

#include <Arduino.h>
#include <math.h>
#include <stdint.h>

#include "BoardPins.h"
#include "MotorDriver.h"
#include "../common/ConfigDefaults.h"
#include "../common/DriveMath.h"
#include "../common/DriveProtocol.h"

namespace gesturedrive {

// Command noise near zero must not chatter across the breakaway floor.
constexpr float ENGAGE_DEADBAND = 20.0F;

class MotorController {
 public:
  void begin() {
    driver_.begin();
    targetLeft_ = 0.0F;
    targetRight_ = 0.0F;
    currentLeft_ = 0.0F;
    currentRight_ = 0.0F;
    lastLeftOutput_ = 0;
    lastRightOutput_ = 0;
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
      const drive_math::MotorPair mixed = drive_math::scaleToSpeedLimit(
          drive_math::mixDifferentialDrive(static_cast<float>(packet.channelA),
                                           static_cast<float>(packet.channelB),
                                           config::K_TURN),
          static_cast<float>(packet.speedLimit));
      left = mixed.left;
      right = mixed.right;
    } else {
      const float limit = static_cast<float>(packet.speedLimit);
      left = clampFloat(static_cast<float>(packet.channelA), -limit, limit);
      right = clampFloat(static_cast<float>(packet.channelB), -limit, limit);
    }

    // Ramp-then-calibrate: targets/currents stay in the plain mixed and
    // speed-scaled command domain (-1000..1000). Invert, gain, MAX_PWM clamp
    // and the breakaway-floor remap are applied at write time in update(), so
    // the motion ramp is not distorted by per-wheel calibration.
    targetLeft_ = clampFloat(left, -1000.0F, 1000.0F);
    targetRight_ = clampFloat(right, -1000.0F, 1000.0F);
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
    // active for ordinary speed changes and safe direction reversals. The
    // driver applies short-brake here when BRAKE_ON_STOP is enabled.
    driver_.write(0, 0);
    lastLeftOutput_ = 0;
    lastRightOutput_ = 0;
  }

  void emergencyStop() {
    targetLeft_ = 0.0F;
    targetRight_ = 0.0F;
    currentLeft_ = 0.0F;
    currentRight_ = 0.0F;
    // The driver stays ENABLED on purpose: pulling STANDBY low puts TB6612
    // outputs in Hi-Z (freewheel), so the short-brake would not actually hold
    // the robot. disable() still cuts STANDBY after MOTOR_DISABLE_TIMEOUT_MS.
    driver_.write(0, 0);
    lastLeftOutput_ = 0;
    lastRightOutput_ = 0;
  }

  void disable() {
    targetLeft_ = 0.0F;
    targetRight_ = 0.0F;
    currentLeft_ = 0.0F;
    currentRight_ = 0.0F;
    driver_.disable();
    lastLeftOutput_ = 0;
    lastRightOutput_ = 0;
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
    lastLeftOutput_ = toOutput(currentLeft_, receiver_pins::LEFT_INVERTED,
                               config::LEFT_GAIN, config::PWM_MIN_LEFT_FWD,
                               config::PWM_MIN_LEFT_REV);
    lastRightOutput_ = toOutput(currentRight_, receiver_pins::RIGHT_INVERTED,
                                config::RIGHT_GAIN, config::PWM_MIN_RIGHT_FWD,
                                config::PWM_MIN_RIGHT_REV);
    driver_.write(lastLeftOutput_, lastRightOutput_);
  }

  // Actual driver outputs after calibration, for telemetry.
  int16_t leftOutput() const { return lastLeftOutput_; }

  int16_t rightOutput() const { return lastRightOutput_; }

  bool isDriverEnabled() const { return driver_.isEnabled(); }

 private:
  static float clampFloat(float value, float minimum, float maximum) {
    return drive_math::clampFloat(value, minimum, maximum);
  }

  // Write-time calibration: engage deadband, invert, gain, MAX_PWM clamp and
  // breakaway-floor remap. Runs on the ramped command, not on the target.
  static int16_t toOutput(float command, bool inverted, float gain,
                          int16_t minimumForward, int16_t minimumReverse) {
    const drive_math::MotorCalibration calibration{
        inverted,   gain,           minimumForward,
        minimumReverse, config::MAX_PWM, ENGAGE_DEADBAND};
    return drive_math::calibrateOutput(command, calibration);
  }

  static float rampOne(float current, float requestedTarget,
                       float deltaSeconds) {
    return drive_math::rampToward(current, requestedTarget, deltaSeconds,
                                  config::RAMP_UP_PER_SECOND,
                                  config::RAMP_DOWN_PER_SECOND);
  }

  MotorDriver driver_;
  float targetLeft_ = 0.0F;
  float targetRight_ = 0.0F;
  float currentLeft_ = 0.0F;
  float currentRight_ = 0.0F;
  int16_t lastLeftOutput_ = 0;
  int16_t lastRightOutput_ = 0;
  uint32_t lastUpdateMicros_ = 0;
};

}  // namespace gesturedrive
