# GestureDrive

GestureDrive điều khiển micromouse 3 bánh bằng laptop và hai ESP32-S3. Hai bánh
sau có motor, bánh còn lại là caster. Nhận dạng tay chạy trên laptop; ESP2 mới
là nơi trộn differential drive, hiệu chỉnh motor, ramp và thực thi failsafe.

```text
Camera -> React + MediaPipe -> USB Web Serial -> ESP1 -> SX1262
                                                     raw LoRa P2P
                                            SX1262 -> ESP2 -> driver -> 2 motor
```

Đây là **raw LoRa point-to-point**, không phải LoRaWAN. Hệ thống không dùng
ESP-NOW hay Bluetooth Classic. ESP32-S3 không hỗ trợ Bluetooth Classic.

## Trạng thái triển khai

P0 đã có trong source:

- Ba mode `AUTO`, `MANUAL`, `CALIBRATION`.
- `STOP`, `DRIVE`, `DIRECT_PWM`, E-stop latch và chuỗi reset rõ ràng.
- Dead-man cho pointer và W/A/S/D; Space dừng, Escape E-stop.
- Hai slider motor độc lập, tám nút thử motor và timed pulse 250-2000 ms.
- Web Serial GD2 có CRC-16/CCITT, single writer và heartbeat 20 Hz.
- ESP1 parser fixed-buffer non-blocking, host watchdog 225 ms và LoRa 20 Hz.
- ESP2 CRC/sequence validation, mixer, gain, PWM minimum, ramp, radio watchdog
  225 ms và disable driver sau 1 giây.
- PlatformIO đã compile thành công cả hai environment cho ESP32-S3 generic.

Chưa thể coi là hoàn tất phần cứng cho tới khi nhóm xác nhận pin, loại oscillator
SX1262, wiring motor và chạy toàn bộ bài test trên bàn. Pin trong repo chỉ là ví
dụ compile được.

## Radio mặc định

| Tham số | Giá trị ban đầu |
| --- | ---: |
| Frequency | 920.5 MHz |
| Bandwidth | 250 kHz |
| Spreading factor | SF7 |
| Coding rate | 4/5 |
| Preamble | 8 symbols |
| LoRa PHY CRC | Bật |
| TX power | 5 dBm, mức thử bàn |
| Control rate | 20 Hz |

Các giá trị nằm tập trung tại
[`firmware/common/RadioConfig.h`](firmware/common/RadioConfig.h). Frequency và
công suất phát phải tuân thủ quy định tại nơi sử dụng. Không phát nếu chưa gắn
antenna phù hợp.

## Chạy frontend

Yêu cầu Node.js 20+ và Chrome hoặc Edge desktop.

```bash
npm install
npm run dev
```

Sau đó mở URL Vite, cắm ESP1 bằng cáp USB dữ liệu và bấm **Kết nối ESP1**.

Kiểm tra source:

```bash
npm test
npm run build
npm run lint
```

## Compile firmware

PlatformIO được pin tại `platformio.ini`:

- Platform `espressif32@6.13.0`.
- Board `esp32-s3-devkitc-1`.
- Arduino-ESP32 `2.0.17` do platform cung cấp.
- RadioLib `7.7.1`.

PlatformIO tự tải RadioLib. Nếu chỉ dùng Arduino IDE 2, cài `esp32 by Espressif
Systems` 2.0.17 trong Boards Manager và `RadioLib` 7.7.1 trong Library Manager.
Luồng PlatformIO vẫn là luồng build đã được kiểm chứng và nên được ưu tiên.
API và ví dụ interrupt chính thức nằm tại
[RadioLib documentation](https://jgromes.github.io/RadioLib/) và
[RadioLib SX126x examples](https://github.com/jgromes/RadioLib/tree/master/examples/SX126x).

```bash
pio run -e esp1_transmitter
pio run -e esp2_receiver
```

Nạp từng board, thay cổng serial bằng cổng thực tế:

```bash
pio run -e esp1_transmitter -t upload --upload-port /dev/cu.usbmodemXXXX
pio run -e esp2_receiver -t upload --upload-port /dev/cu.usbmodemYYYY
```

Nếu không cài PlatformIO toàn cục, có thể dùng:

```bash
uvx --with pip --from platformio platformio run
```

## Cấu hình bắt buộc trước khi cấp nguồn motor

1. Xác nhận bảy chân SX1262 của ESP1 trong
   [`firmware/transmitter/BoardPins.h`](firmware/transmitter/BoardPins.h).
2. Xác nhận chân SX1262, motor và STANDBY của ESP2 trong
   [`firmware/receiver/BoardPins.h`](firmware/receiver/BoardPins.h).
3. Xác nhận module dùng TCXO 1.6 V hay XTAL. Nếu dùng XTAL, đặt
   `TCXO_VOLTAGE = 0.0F`.
4. Xác nhận điện áp logic, nguồn motor riêng và mass chung.
5. Giữ bánh khỏi mặt đất trong lần thử đầu.

## Cấu trúc chính

```text
src/lib/                 Protocol và pure control functions
src/hooks/               Web Serial, heartbeat, MediaPipe
src/components/          Manual, calibration, E-stop, link status
firmware/common/         Packet, CRC, radio và timeout dùng chung
firmware/transmitter/    ESP1 USB-to-LoRa
firmware/receiver/       ESP2 LoRa-to-motor
docs/                    Protocol, wiring, calibration, safety tests
```

Hai sketch cũ trong `esp sketch/` là entrypoint tương thích Arduino IDE và include
source canonical bên dưới `firmware/`.

## Tài liệu chi tiết

- [Hướng dẫn vận hành](USAGE_GUIDE.md)
- [Kiến trúc](docs/ARCHITECTURE.md)
- [Protocol GD2 và packet 16 byte](docs/PROTOCOL.md)
- [Đấu nối phần cứng](docs/HARDWARE_WIRING.md)
- [Hiệu chỉnh motor](docs/CALIBRATION.md)
- [Bài test an toàn](docs/SAFETY_TESTS.md)

## P1 còn lại

- Continuous gesture dùng EMA, deadzone/hysteresis đầy đủ.
- Ghép role tay theo khoảng cách qua frame thay vì nửa màn hình.
- Telemetry hai chiều 1-2 Hz gồm RSSI/SNR, packet loss, output và battery.
- Đo packet loss end-to-end và biểu đồ thống kê dài hạn.

UI đã parse được dòng telemetry và export CSV, nhưng firmware chưa phát telemetry
để giữ đường điều khiển P0 đơn giản. `LINK:LORA` hiện xác nhận SX1262 hoàn tất
transmit, không phải ACK end-to-end từ ESP2.
