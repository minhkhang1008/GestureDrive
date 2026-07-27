#include <unity.h>

#include <string.h>

#include "common/DriveProtocol.h"
#include "common/TelemetryProtocol.h"

using namespace gesturedrive;

namespace {

DrivePacket makeDrivePacket(int16_t channelA, int16_t channelB,
                            uint16_t speedLimit, uint8_t flags = FLAG_ENABLE) {
  DrivePacket packet;
  memset(&packet, 0, sizeof(packet));
  packet.magic = DRIVE_MAGIC;
  packet.version = DRIVE_VERSION;
  packet.type = COMMAND_DRIVE;
  packet.sequence = 42;
  packet.channelA = channelA;
  packet.channelB = channelB;
  packet.speedLimit = speedLimit;
  packet.flags = flags;
  finalizePacket(packet);
  return packet;
}

}  // namespace

// --- CRC ------------------------------------------------------------------

void test_crc_matches_ccitt_false_reference(void) {
  // "123456789" under CRC-16/CCITT-FALSE (init 0xFFFF, poly 0x1021) is the
  // standard check value. The browser reimplements this in serialProtocol.ts,
  // so the constant is what keeps the two sides byte-compatible.
  const uint8_t data[] = {'1', '2', '3', '4', '5', '6', '7', '8', '9'};
  TEST_ASSERT_EQUAL_HEX16(0x29B1, crc16Ccitt(data, sizeof(data)));
}

void test_crc_detects_a_single_flipped_bit(void) {
  uint8_t data[] = {0x01, 0x02, 0x03, 0x04};
  const uint16_t original = crc16Ccitt(data, sizeof(data));
  data[2] ^= 0x01;
  TEST_ASSERT_NOT_EQUAL(original, crc16Ccitt(data, sizeof(data)));
}

// --- Packet framing -------------------------------------------------------

void test_finalize_then_validate_round_trip(void) {
  const DrivePacket packet = makeDrivePacket(500, -250, 600);
  TEST_ASSERT_TRUE(hasValidPacketCrc(packet));
  TEST_ASSERT_TRUE(isPacketShapeValid(packet));
}

void test_corrupted_payload_fails_the_crc(void) {
  DrivePacket packet = makeDrivePacket(500, -250, 600);
  packet.channelA = 1000;
  TEST_ASSERT_FALSE(hasValidPacketCrc(packet));
}

void test_shape_rejects_out_of_range_channels(void) {
  DrivePacket packet = makeDrivePacket(0, 0, 600);
  packet.channelA = CONTROL_MAX + 1;
  TEST_ASSERT_FALSE(isPacketShapeValid(packet));
  packet.channelA = CONTROL_MIN - 1;
  TEST_ASSERT_FALSE(isPacketShapeValid(packet));
}

void test_shape_rejects_an_oversized_speed_limit(void) {
  DrivePacket packet = makeDrivePacket(0, 0, CONTROL_MAX + 1);
  TEST_ASSERT_FALSE(isPacketShapeValid(packet));
}

void test_shape_rejects_unknown_flags_and_versions(void) {
  DrivePacket packet = makeDrivePacket(0, 0, 600);
  packet.flags = FLAG_ENABLE | 0x80U;
  TEST_ASSERT_FALSE(isPacketShapeValid(packet));

  packet = makeDrivePacket(0, 0, 600);
  packet.version = DRIVE_VERSION + 1;
  TEST_ASSERT_FALSE(isPacketShapeValid(packet));

  packet = makeDrivePacket(0, 0, 600);
  packet.reserved = 1;
  TEST_ASSERT_FALSE(isPacketShapeValid(packet));
}

void test_drive_requires_enable_and_forbids_estop_bits(void) {
  TEST_ASSERT_FALSE(isPacketShapeValid(makeDrivePacket(100, 0, 600, 0)));
  TEST_ASSERT_FALSE(
      isPacketShapeValid(makeDrivePacket(100, 0, 600, FLAG_ENABLE | FLAG_ESTOP)));
  TEST_ASSERT_FALSE(isPacketShapeValid(
      makeDrivePacket(100, 0, 600, FLAG_ENABLE | FLAG_RESET_ESTOP)));
}

void test_stop_packet_must_be_neutral(void) {
  DrivePacket packet = makeStopPacket(7);
  TEST_ASSERT_TRUE(isPacketShapeValid(packet));
  TEST_ASSERT_TRUE(hasValidPacketCrc(packet));

  // A STOP carrying movement is malformed, not a slow stop.
  packet.channelA = 100;
  TEST_ASSERT_FALSE(isPacketShapeValid(packet));

  packet = makeStopPacket(7);
  packet.flags = FLAG_ENABLE;
  TEST_ASSERT_FALSE(isPacketShapeValid(packet));
}

void test_estop_and_reset_estop_are_mutually_exclusive(void) {
  TEST_ASSERT_TRUE(isPacketShapeValid(makeStopPacket(1, FLAG_ESTOP)));
  TEST_ASSERT_TRUE(isPacketShapeValid(makeStopPacket(1, FLAG_RESET_ESTOP)));
  // Accepting both would let a stray reset bit weaken an emergency stop.
  TEST_ASSERT_FALSE(
      isPacketShapeValid(makeStopPacket(1, FLAG_ESTOP | FLAG_RESET_ESTOP)));
}

// --- Sequence arithmetic --------------------------------------------------

void test_sequence_newer_handles_wraparound(void) {
  TEST_ASSERT_TRUE(isSequenceNewer(1, 0));
  TEST_ASSERT_FALSE(isSequenceNewer(0, 0));
  TEST_ASSERT_FALSE(isSequenceNewer(0, 1));
  // 0 immediately after 65535 is the next packet, not a 65535-packet replay.
  TEST_ASSERT_TRUE(isSequenceNewer(0, 65535));
  TEST_ASSERT_TRUE(isSequenceNewer(5, 65530));
  TEST_ASSERT_FALSE(isSequenceNewer(65530, 5));
}

void test_sequence_newer_splits_the_range_in_half(void) {
  // Exactly half the space away is treated as old: a replayed packet cannot
  // masquerade as a fresh one by jumping the counter.
  TEST_ASSERT_FALSE(isSequenceNewer(0x8000, 0));
  TEST_ASSERT_TRUE(isSequenceNewer(0x7FFF, 0));
}

// --- Telemetry ------------------------------------------------------------

void test_telemetry_round_trip(void) {
  TelemetryPacket packet;
  memset(&packet, 0, sizeof(packet));
  packet.magic = TELEMETRY_MAGIC;
  packet.versionAndFlags = makeTelemetryVersionAndFlags(
      TELEMETRY_FLAG_FAILSAFE | TELEMETRY_FLAG_BATTERY_VALID);
  packet.sequence = 9;
  packet.rssiDbm = -97;
  packet.snrDbX4 = 30;
  packet.lossPercent = 12;
  packet.battery50mV = 160;
  packet.leftPermilleDiv10 = 40;
  packet.rightPermilleDiv10 = -40;
  finalizeTelemetryPacket(packet);

  TEST_ASSERT_TRUE(hasValidTelemetryCrc(packet));
  TEST_ASSERT_TRUE(isTelemetryShapeValid(packet));
  TEST_ASSERT_EQUAL_UINT8(TELEMETRY_VERSION, telemetryVersion(packet));
  TEST_ASSERT_EQUAL_UINT8(
      TELEMETRY_FLAG_FAILSAFE | TELEMETRY_FLAG_BATTERY_VALID,
      telemetryFlags(packet));
  // 160 * 50 mV = 8.00 V, the nominal 2S pack voltage.
  TEST_ASSERT_EQUAL_UINT32(8000U,
                           static_cast<uint32_t>(packet.battery50mV) * 50U);
}

void test_telemetry_version_and_flags_share_one_byte(void) {
  // v2 packs the version into the top two bits so six flags fit alongside it,
  // keeping the packet at 12 bytes and its airtime inside ESP1's idle gap.
  const uint8_t allFlags = TELEMETRY_FLAG_FAILSAFE | TELEMETRY_FLAG_ESTOP_LATCHED |
                           TELEMETRY_FLAG_MOTORS_DISABLED |
                           TELEMETRY_FLAG_BATTERY_VALID |
                           TELEMETRY_FLAG_BATTERY_LOW |
                           TELEMETRY_FLAG_BATTERY_CRITICAL;
  TEST_ASSERT_EQUAL_UINT8(TELEMETRY_FLAG_MASK, allFlags);

  TelemetryPacket packet;
  memset(&packet, 0, sizeof(packet));
  packet.magic = TELEMETRY_MAGIC;
  packet.versionAndFlags = makeTelemetryVersionAndFlags(allFlags);
  finalizeTelemetryPacket(packet);

  TEST_ASSERT_TRUE(isTelemetryShapeValid(packet));
  TEST_ASSERT_EQUAL_UINT8(TELEMETRY_VERSION, telemetryVersion(packet));
  TEST_ASSERT_EQUAL_UINT8(allFlags, telemetryFlags(packet));
}

void test_telemetry_rejects_a_stale_firmware_version(void) {
  // A vehicle still running v1 must not be parsed as v2: the flag bits moved.
  TelemetryPacket packet;
  memset(&packet, 0, sizeof(packet));
  packet.magic = TELEMETRY_MAGIC;
  packet.versionAndFlags = static_cast<uint8_t>(1U << 4);  // v1 layout
  finalizeTelemetryPacket(packet);
  TEST_ASSERT_FALSE(isTelemetryShapeValid(packet));
}

void test_telemetry_rejects_impossible_loss(void) {
  TelemetryPacket packet;
  memset(&packet, 0, sizeof(packet));
  packet.magic = TELEMETRY_MAGIC;
  packet.versionAndFlags = makeTelemetryVersionAndFlags(0);
  packet.lossPercent = 101;
  finalizeTelemetryPacket(packet);
  TEST_ASSERT_FALSE(isTelemetryShapeValid(packet));
}

void test_telemetry_rejects_a_control_packet(void) {
  // Both packet types share one raw LoRa channel, so the magic has to keep
  // them apart even when the length happens to be plausible.
  TelemetryPacket packet;
  memset(&packet, 0, sizeof(packet));
  packet.magic = DRIVE_MAGIC;
  packet.versionAndFlags = makeTelemetryVersionAndFlags(0);
  finalizeTelemetryPacket(packet);
  TEST_ASSERT_FALSE(isTelemetryShapeValid(packet));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_crc_matches_ccitt_false_reference);
  RUN_TEST(test_crc_detects_a_single_flipped_bit);
  RUN_TEST(test_finalize_then_validate_round_trip);
  RUN_TEST(test_corrupted_payload_fails_the_crc);
  RUN_TEST(test_shape_rejects_out_of_range_channels);
  RUN_TEST(test_shape_rejects_an_oversized_speed_limit);
  RUN_TEST(test_shape_rejects_unknown_flags_and_versions);
  RUN_TEST(test_drive_requires_enable_and_forbids_estop_bits);
  RUN_TEST(test_stop_packet_must_be_neutral);
  RUN_TEST(test_estop_and_reset_estop_are_mutually_exclusive);
  RUN_TEST(test_sequence_newer_handles_wraparound);
  RUN_TEST(test_sequence_newer_splits_the_range_in_half);
  RUN_TEST(test_telemetry_round_trip);
  RUN_TEST(test_telemetry_version_and_flags_share_one_byte);
  RUN_TEST(test_telemetry_rejects_a_stale_firmware_version);
  RUN_TEST(test_telemetry_rejects_impossible_loss);
  RUN_TEST(test_telemetry_rejects_a_control_packet);
  return UNITY_END();
}

void setUp(void) {}
void tearDown(void) {}
