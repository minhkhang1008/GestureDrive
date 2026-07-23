#pragma once

#include <Arduino.h>
#include <stdint.h>
#include <stdlib.h>

#include "BoardPins.h"

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
    if (!enabled) writeRaw(0, 0);
  }

  void write(int16_t left, int16_t right) {
    if (!enabled_) {
      writeRaw(0, 0);
      return;
    }
    writeRaw(left, right);
  }

  void disable() {
    writeRaw(0, 0);
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

  static void writeOne(int16_t command, int in1, int in2, uint8_t channel) {
    if (command > 0) {
      digitalWrite(in1, HIGH);
      digitalWrite(in2, LOW);
    } else if (command < 0) {
      digitalWrite(in1, LOW);
      digitalWrite(in2, HIGH);
    } else {
      digitalWrite(in1, LOW);
      digitalWrite(in2, LOW);
    }
    ledcWrite(channel, toDuty(command));
  }

  static void writeRaw(int16_t left, int16_t right) {
    writeOne(left, receiver_pins::LEFT_IN1, receiver_pins::LEFT_IN2,
             receiver_pins::LEFT_PWM_CHANNEL);
    writeOne(right, receiver_pins::RIGHT_IN1, receiver_pins::RIGHT_IN2,
             receiver_pins::RIGHT_PWM_CHANNEL);
  }

  bool enabled_ = false;
};

}  // namespace gesturedrive
