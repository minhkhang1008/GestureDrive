#include <unity.h>

#include <math.h>

#include "common/DriveMath.h"

using namespace gesturedrive::drive_math;

namespace {

constexpr float K_TURN = 0.7F;
constexpr int16_t MAX_PWM = 600;

MotorCalibration calibration(int16_t minimumForward = 0,
                             int16_t minimumReverse = 0, float gain = 1.0F,
                             bool inverted = false) {
  return MotorCalibration{inverted, gain,    minimumForward,
                          minimumReverse, MAX_PWM, 20.0F};
}

}  // namespace

// --- Differential mix -----------------------------------------------------

void test_pure_throttle_drives_both_wheels_equally(void) {
  const MotorPair pair = mixDifferentialDrive(1000.0F, 0.0F, K_TURN);
  TEST_ASSERT_FLOAT_WITHIN(0.01F, 1000.0F, pair.left);
  TEST_ASSERT_FLOAT_WITHIN(0.01F, 1000.0F, pair.right);
}

void test_pure_steering_pivots_in_place(void) {
  // Positive steering is a left turn: the left wheel reverses.
  const MotorPair pair = mixDifferentialDrive(0.0F, 1000.0F, K_TURN);
  TEST_ASSERT_TRUE(pair.left < 0.0F);
  TEST_ASSERT_TRUE(pair.right > 0.0F);
  TEST_ASSERT_FLOAT_WITHIN(0.01F, -pair.left, pair.right);
}

void test_saturated_mix_scales_the_pair_instead_of_clipping(void) {
  // Full forward plus full left would put the right wheel at 1700. Clipping it
  // to 1000 would silently cancel the turn, so the pair is scaled down and the
  // left/right ratio — the actual turn rate — is preserved.
  const MotorPair pair = mixDifferentialDrive(1000.0F, 1000.0F, K_TURN);
  TEST_ASSERT_FLOAT_WITHIN(0.5F, 1000.0F, pair.right);
  const float expectedRatio = (1000.0F - K_TURN * 1000.0F) /
                              (1000.0F + K_TURN * 1000.0F);
  TEST_ASSERT_FLOAT_WITHIN(0.001F, expectedRatio, pair.left / pair.right);
}

void test_mix_never_exceeds_the_normalized_range(void) {
  for (float throttle = -1000.0F; throttle <= 1000.0F; throttle += 125.0F) {
    for (float steering = -1000.0F; steering <= 1000.0F; steering += 125.0F) {
      const MotorPair pair = mixDifferentialDrive(throttle, steering, K_TURN);
      TEST_ASSERT_TRUE(fabsf(pair.left) <= 1000.5F);
      TEST_ASSERT_TRUE(fabsf(pair.right) <= 1000.5F);
    }
  }
}

void test_out_of_range_input_is_clamped_before_mixing(void) {
  const MotorPair pair = mixDifferentialDrive(5000.0F, 0.0F, K_TURN);
  TEST_ASSERT_FLOAT_WITHIN(0.01F, 1000.0F, pair.left);
  TEST_ASSERT_FLOAT_WITHIN(0.01F, 1000.0F, pair.right);
}

// --- Speed limit ----------------------------------------------------------

void test_speed_limit_scales_both_wheels(void) {
  const MotorPair pair =
      scaleToSpeedLimit(mixDifferentialDrive(1000.0F, 0.0F, K_TURN), 600.0F);
  TEST_ASSERT_FLOAT_WITHIN(0.01F, 600.0F, pair.left);
  TEST_ASSERT_FLOAT_WITHIN(0.01F, 600.0F, pair.right);
}

void test_zero_speed_limit_produces_no_motion(void) {
  const MotorPair pair =
      scaleToSpeedLimit(mixDifferentialDrive(1000.0F, 400.0F, K_TURN), 0.0F);
  TEST_ASSERT_FLOAT_WITHIN(0.001F, 0.0F, pair.left);
  TEST_ASSERT_FLOAT_WITHIN(0.001F, 0.0F, pair.right);
}

// --- Ramp -----------------------------------------------------------------

void test_ramp_up_is_rate_limited(void) {
  // 800 units/s for 100 ms is 80 units, not the whole 1000-unit step.
  const float next = rampToward(0.0F, 1000.0F, 0.1F, 800.0F, 3000.0F);
  TEST_ASSERT_FLOAT_WITHIN(0.01F, 80.0F, next);
}

void test_ramp_down_is_faster_than_ramp_up(void) {
  const float up = rampToward(0.0F, 1000.0F, 0.1F, 800.0F, 3000.0F);
  const float down = 1000.0F - rampToward(1000.0F, 0.0F, 0.1F, 800.0F, 3000.0F);
  TEST_ASSERT_TRUE(down > up);
}

void test_ramp_reaches_the_target_without_overshoot(void) {
  float current = 0.0F;
  for (int step = 0; step < 200; ++step) {
    current = rampToward(current, 500.0F, 0.02F, 800.0F, 3000.0F);
    TEST_ASSERT_TRUE(current <= 500.0F + 0.001F);
  }
  TEST_ASSERT_FLOAT_WITHIN(0.01F, 500.0F, current);
}

void test_reversal_passes_through_zero_first(void) {
  // The direction pins must not flip while the wheel is still driving: a
  // reversal always ramps down to zero before the new sign appears.
  float current = 600.0F;
  bool sawZero = false;
  for (int step = 0; step < 200; ++step) {
    const float next = rampToward(current, -600.0F, 0.02F, 800.0F, 3000.0F);
    TEST_ASSERT_TRUE(next * current >= -0.001F);
    if (fabsf(next) < 0.001F) sawZero = true;
    current = next;
    if (sawZero && current < -100.0F) break;
  }
  TEST_ASSERT_TRUE(sawZero);
  TEST_ASSERT_TRUE(current < 0.0F);
}

// --- Write-time calibration ----------------------------------------------

void test_engage_deadband_swallows_command_noise(void) {
  TEST_ASSERT_EQUAL_INT16(0, calibrateOutput(19.0F, calibration()));
  TEST_ASSERT_EQUAL_INT16(0, calibrateOutput(-19.0F, calibration()));
  TEST_ASSERT_NOT_EQUAL(0, calibrateOutput(21.0F, calibration()));
}

void test_output_is_capped_at_max_pwm(void) {
  TEST_ASSERT_EQUAL_INT16(MAX_PWM, calibrateOutput(1000.0F, calibration()));
  TEST_ASSERT_EQUAL_INT16(-MAX_PWM, calibrateOutput(-1000.0F, calibration()));
}

void test_gain_cannot_push_a_wheel_past_max_pwm(void) {
  // Per-wheel trim above 1.0 is legitimate; exceeding the bench ceiling is not.
  const MotorCalibration trimmed = calibration(0, 0, 1.4F);
  TEST_ASSERT_EQUAL_INT16(MAX_PWM, calibrateOutput(1000.0F, trimmed));
}

void test_inversion_flips_the_sign_only(void) {
  const MotorCalibration inverted = calibration(0, 0, 1.0F, true);
  TEST_ASSERT_EQUAL_INT16(-calibrateOutput(300.0F, calibration()),
                          calibrateOutput(300.0F, inverted));
}

void test_breakaway_floor_remaps_the_bottom_of_the_range(void) {
  // With a 120-unit breakaway floor, the smallest engaged command must already
  // be at the floor (the wheel would otherwise buzz without turning) and full
  // command must still reach MAX_PWM.
  const MotorCalibration floored = calibration(120, 150);
  const int16_t smallest = calibrateOutput(20.5F, floored);
  TEST_ASSERT_TRUE(smallest >= 120);
  TEST_ASSERT_EQUAL_INT16(MAX_PWM, calibrateOutput(1000.0F, floored));
  // Reverse uses its own floor.
  TEST_ASSERT_TRUE(calibrateOutput(-20.5F, floored) <= -150);
}

void test_calibration_is_monotonic_in_the_command(void) {
  const MotorCalibration floored = calibration(120, 120);
  int16_t previous = 0;
  for (float command = 20.5F; command <= 1000.0F; command += 5.0F) {
    const int16_t output = calibrateOutput(command, floored);
    TEST_ASSERT_TRUE(output >= previous);
    previous = output;
  }
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_pure_throttle_drives_both_wheels_equally);
  RUN_TEST(test_pure_steering_pivots_in_place);
  RUN_TEST(test_saturated_mix_scales_the_pair_instead_of_clipping);
  RUN_TEST(test_mix_never_exceeds_the_normalized_range);
  RUN_TEST(test_out_of_range_input_is_clamped_before_mixing);
  RUN_TEST(test_speed_limit_scales_both_wheels);
  RUN_TEST(test_zero_speed_limit_produces_no_motion);
  RUN_TEST(test_ramp_up_is_rate_limited);
  RUN_TEST(test_ramp_down_is_faster_than_ramp_up);
  RUN_TEST(test_ramp_reaches_the_target_without_overshoot);
  RUN_TEST(test_reversal_passes_through_zero_first);
  RUN_TEST(test_engage_deadband_swallows_command_noise);
  RUN_TEST(test_output_is_capped_at_max_pwm);
  RUN_TEST(test_gain_cannot_push_a_wheel_past_max_pwm);
  RUN_TEST(test_inversion_flips_the_sign_only);
  RUN_TEST(test_breakaway_floor_remaps_the_bottom_of_the_range);
  RUN_TEST(test_calibration_is_monotonic_in_the_command);
  return UNITY_END();
}

void setUp(void) {}
void tearDown(void) {}
