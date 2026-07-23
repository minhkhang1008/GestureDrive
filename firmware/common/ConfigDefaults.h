#pragma once

#include <stdint.h>

namespace gesturedrive {
namespace config {

// Safe starting placeholders. Measure and update these on the real chassis.
constexpr float K_TURN = 0.70F;
constexpr float LEFT_GAIN = 1.00F;
constexpr float RIGHT_GAIN = 1.00F;

// Normalized 0..1000 domain. Zero is deliberately safe until measured.
constexpr int16_t PWM_MIN_LEFT_FWD = 0;   // TODO: measure breakaway threshold.
constexpr int16_t PWM_MIN_RIGHT_FWD = 0;  // TODO: measure breakaway threshold.
constexpr int16_t PWM_MIN_LEFT_REV = 0;   // TODO: measure breakaway threshold.
constexpr int16_t PWM_MIN_RIGHT_REV = 0;  // TODO: measure breakaway threshold.
constexpr int16_t MAX_PWM = 600;          // 60% bench-test ceiling.

// Normalized command units per second. TODO: tune with the wheels lifted first.
constexpr float RAMP_UP_PER_SECOND = 800.0F;
constexpr float RAMP_DOWN_PER_SECOND = 3000.0F;

constexpr uint32_t HOST_TIMEOUT_MS = 225;
constexpr uint32_t RADIO_TIMEOUT_MS = 225;
constexpr uint32_t MOTOR_DISABLE_TIMEOUT_MS = 1000;
constexpr uint32_t CONTROL_INTERVAL_MS = 50;
constexpr uint32_t TELEMETRY_INTERVAL_MS = 500;

constexpr uint8_t ESTOP_DISARMED_PACKETS_REQUIRED = 3;

}  // namespace config
}  // namespace gesturedrive
