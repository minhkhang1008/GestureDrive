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

// Khi phanh về 0: true = short-brake TB6612 (IN1=IN2=HIGH, duty max — duty max
// cũng làm board kiểu L298N phanh thay vì thả trôi); false = coast (LOW/LOW,
// duty 0). Coast luôn được dùng khi driver bị disable.
constexpr bool BRAKE_ON_STOP = true;

// 225 ms = 4-5 missed 50 ms host heartbeats, matches the RADIO_TIMEOUT_MS
// margin so both watchdog stages trip on the same timescale (docs/spec value).
constexpr uint32_t HOST_TIMEOUT_MS = 225;
constexpr uint32_t RADIO_TIMEOUT_MS = 225;
constexpr uint32_t MOTOR_DISABLE_TIMEOUT_MS = 1000;
constexpr uint32_t CONTROL_INTERVAL_MS = 50;
constexpr uint32_t TELEMETRY_INTERVAL_MS = 500;

constexpr uint8_t ESTOP_DISARMED_PACKETS_REQUIRED = 3;

// --- Battery protection ---------------------------------------------------
// Inactive unless receiver_pins::BATTERY_ADC_PIN is wired and set. Defaults
// suit a 2S li-ion pack (8.4 V full, 6.0 V empty); change them for a different
// chemistry or cell count before enabling the divider.
//
// IMPORTANT: pack voltage sags under motor load, so both thresholds must sit
// below the loaded voltage of a healthy pack, not its resting voltage.
// BATTERY_CRITICAL_SAMPLES consecutive readings are required so a single
// stall-current transient cannot latch the stop.
constexpr uint16_t BATTERY_WARN_MV = 6800;
constexpr uint16_t BATTERY_CRITICAL_MV = 6200;
constexpr uint32_t BATTERY_SAMPLE_INTERVAL_MS = 250;
constexpr uint8_t BATTERY_CRITICAL_SAMPLES = 8;  // 2 s below critical

}  // namespace config
}  // namespace gesturedrive
