#pragma once

#include <Arduino.h>
#include <stdint.h>
#include <stdlib.h>

#include "BoardPins.h"
#include "../common/ConfigDefaults.h"

namespace gesturedrive {

class MotorDriver {
 public:
  void begin() {
    if (receiver_pins::HAS_STANDBY) {
      pinMode(receiver_pins::STANDBY, OUTPUT);
      digitalWrite(receiver_pins::STANDBY, LOW);
    }

    pinMode(receiver_pins::LEFT_IN1, OUTPUT);
    pinMode(receiver_pins::LEFT_IN2, OUTPUT);
    pinMode(receiver_pins::RIGHT_IN1, OUTPUT);
    pinMode(receiver_pins::RIGHT_IN2, OUTPUT);
    digitalWrite(receiver_pins::LEFT_IN1, LOW);
    digitalWrite(receiver_pins::LEFT_IN2, LOW);
    digitalWrite(receiver_pins::RIGHT_IN1, LOW);
    digitalWrite(receiver_pins::RIGHT_IN2, LOW);

    ledcSetup(receiver_pins::LEFT_PWM_CHANNEL,
              receiver_pins::PWM_FREQUENCY_HZ,
              receiver_pins::PWM_RESOLUTION_BITS);
    ledcSetup(receiver_pins::RIGHT_PWM_CHANNEL,
              receiver_pins::PWM_FREQUENCY_HZ,
              receiver_pins::PWM_RESOLUTION_BITS);
    ledcAttachPin(receiver_pins::LEFT_PWM,
                  receiver_pins::LEFT_PWM_CHANNEL);
    ledcAttachPin(receiver_pins::RIGHT_PWM,
                  receiver_pins::RIGHT_PWM_CHANNEL);
    ledcWrite(receiver_pins::LEFT_PWM_CHANNEL, 0);
    ledcWrite(receiver_pins::RIGHT_PWM_CHANNEL, 0);
    enabled_ = false;
  }

  void setEnabled(bool enabled) {
    enabled_ = enabled;
    if (receiver_pins::HAS_STANDBY) {
      digitalWrite(receiver_pins::STANDBY, enabled ? HIGH : LOW);
    }
    // A disabled driver always coasts; short-brake needs STANDBY high.
    if (!enabled) writeRaw(0, 0, false);
  }

  void write(int16_t left, int16_t right) {
    if (!enabled_) {
      writeRaw(0, 0, false);
      return;
    }
    writeRaw(left, right, config::BRAKE_ON_STOP);
  }

  void disable() {
    writeRaw(0, 0, false);
    setEnabled(false);
  }

  bool isEnabled() const { return enabled_; }

 private:
  static constexpr uint16_t PWM_DUTY_MAX =
      (1U << receiver_pins::PWM_RESOLUTION_BITS) - 1U;

  static uint16_t toDuty(int16_t normalized) {
    const uint32_t magnitude = static_cast<uint32_t>(abs(normalized));
    return static_cast<uint16_t>((magnitude * PWM_DUTY_MAX) / 1000U);
  }

  static void writeOne(int16_t command, int in1, int in2, uint8_t channel,
                       bool brakeOnZero) {
    if (command > 0) {
      digitalWrite(in1, HIGH);
      digitalWrite(in2, LOW);
    } else if (command < 0) {
      digitalWrite(in1, LOW);
      digitalWrite(in2, HIGH);
    } else if (brakeOnZero) {
      // TB6612 short-brake: IN1=IN2=HIGH. Duty=max also makes L298N-style
      // boards (EN driven by PWM) brake instead of coasting.
      digitalWrite(in1, HIGH);
      digitalWrite(in2, HIGH);
      ledcWrite(channel, PWM_DUTY_MAX);
      return;
    } else {
      digitalWrite(in1, LOW);
      digitalWrite(in2, LOW);
    }
    ledcWrite(channel, toDuty(command));
  }

  static void writeRaw(int16_t left, int16_t right, bool brakeOnZero) {
    writeOne(left, receiver_pins::LEFT_IN1, receiver_pins::LEFT_IN2,
             receiver_pins::LEFT_PWM_CHANNEL, brakeOnZero);
    writeOne(right, receiver_pins::RIGHT_IN1, receiver_pins::RIGHT_IN2,
             receiver_pins::RIGHT_PWM_CHANNEL, brakeOnZero);
  }

  bool enabled_ = false;
};

}  // namespace gesturedrive
