# GestureDrive

GestureDrive điều khiển micromouse 3 bánh bằng laptop và hai ESP32-S3. Hai bánh
sau có motor, bánh còn lại là caster. Nhận dạng tay chạy trên laptop; ESP2 mới
là nơi trộn differential drive, hiệu chỉnh motor, ramp và thực thi failsafe.

```text
Camera -> MediaPipe worker -> React -> USB Web Serial -> ESP1 -> SX1262
                                                     raw LoRa P2P
                                            SX1262 -> ESP2 -> driver -> 2 motor
```

Đây là **raw LoRa point-to-point**, không phải LoRaWAN. Hệ thống không dùng
ESP-NOW hay Bluetooth Classic. ESP32-S3 không hỗ trợ Bluetooth Classic.

## Trạng thái triển khai

Đã có trong source:

- Ba mode `AUTO`, `MANUAL`, `CALIBRATION`.
- MediaPipe Hand Landmarker chạy trong worker, GPU trước/CPU fallback (worker
  được recycle sang CPU sau 5 lỗi detect liên tiếp, và tự rebuild sang CPU khi
  GPU chậm bất thường kéo dài), warm-up inference, frame downscale còn tối đa
  360 px trước khi gửi, capture bằng `requestVideoFrameCallback` và không chặn
  React bằng `detectForVideo()`.
- **Bám định danh bàn tay qua frame** (`src/lib/handTracking.ts`): mỗi tay có
  id ổn định, ghép theo vị trí dự đoán thay vì nửa màn hình, nên vai trò vẫn
  dính vào đúng bàn tay khi hai tay đổi bên. Cú nhảy landmark vượt tốc độ khả
  thi (14 span/giây) bị chặn thay vì bám theo, và điểm chất lượng 0..1 phải đạt
  >= 0.5 trên **cả hai** tay thì xe mới chạy.
- **Bù trễ**: tâm lòng bàn tay được ngoại suy theo vận tốc của chính nó bằng độ
  trễ pipeline đo được, giới hạn cứng 45 ms và 0.15 span nên không thể tự sinh
  ra lệnh.
- Điều khiển cử chỉ **analog hoàn toàn**: độ dời lòng bàn tay so với anchor tự
  re-center, lọc One-Euro, chuẩn hóa theo palm span, dead zone tròn có
  hysteresis (vào 0.18 / ra 0.12 span), expo 0.3, full deflection ở 1.1 span.
  Lòng/mu bàn tay gate chiều tiến/lùi bằng **pháp tuyến lòng bàn tay** (bất
  biến với xoay trong mặt phẳng) kèm hysteresis; mã 8 hướng giờ chỉ để hiển
  thị.
- Tốc độ chỉnh bằng **pinch-drag tương đối**: chụm ngón cái-trỏ để "nắm"
  slider, kéo dọc để chỉnh (500 đơn vị mỗi hand-span), thả để khóa. Đặt xong
  có thể hạ tay tốc độ xuống — mức LIMIT được giữ và xe chạy bằng một tay điều
  hướng, nên **tay điều hướng là dead-man duy nhất**.
- **Telemetry ESP2 -> ESP1 -> web ~2 Hz** trong khe TDMA ngay sau mỗi control
  packet: RSSI/SNR, packet loss, failsafe, battery, output hai motor và trạng
  thái E-stop latch. UI hiển thị các giá trị này kèm cảnh báo khi telemetry cũ.
- `STOP`, `DRIVE`, `DIRECT_PWM`, E-stop latch và chuỗi reset rõ ràng; reset
  E-stop yêu cầu xe xác nhận qua telemetry khi telemetry còn tươi.
- Dead-man cho pointer và W/A/S/D; Space dừng, Escape E-stop; wake lock giữ
  màn hình sáng và heartbeat 20 Hz chạy bằng timer trong dedicated worker nên
  tab ẩn không bị browser throttle.
- Hai slider motor độc lập, tám nút thử motor và timed pulse 250-2000 ms.
- Web Serial GD2 có CRC-16/CCITT, latest-wins TX (một write in-flight, một
  slot pending thay thế được) với write timeout 300 ms và heartbeat 20 Hz.
- ESP1 parser fixed-buffer non-blocking, host watchdog 225 ms, lịch LoRa 20 Hz
  drift-free, TX watchdog 60 ms, retry radio init mỗi 2 s và `SEQUENCE_RESYNC`
  sau 3 lần sequence bị loại liên tiếp.
- ESP2 CRC/sequence validation, mixer, gain, PWM minimum, ramp, brake-on-stop
  (short-brake TB6612 khi lệnh về 0), `esp_task_wdt` reboot về trạng thái an
  toàn, E-stop latch giữ qua reset bằng RTC RAM, radio watchdog 225 ms và
  disable driver sau 1 giây.
- **Bảo vệ pin (tùy chọn)**: khi đã đấu divider vào `BATTERY_ADC_PIN`, ESP2
  cảnh báo dưới `BATTERY_WARN_MV` và khóa motor sau 2 giây liên tục dưới
  `BATTERY_CRITICAL_MV`. Khóa này giữ tới khi tắt nguồn.
- **Chất lượng liên kết hai chiều**: ESP2 báo RSSI/SNR chiều trạm → xe, ESP1 tự
  đo RSSI/SNR trên gói telemetry cho chiều xe → trạm. UI tính biên dự trữ theo
  chiều yếu hơn.
- Unit test firmware chạy trên máy dev (`pio test -e native`): CRC, khung
  packet, số học sequence và toàn bộ drive math quyết định dòng vào motor.
- Vendor MediaPipe offline bằng `npm run vendor:mediapipe` (tự chạy trước
  `dev` và `build`); worker ưu tiên asset local trong `public/mediapipe/`,
  fallback CDN khi thiếu.
- CI GitHub Actions (`.github/workflows/ci.yml`): lint, typecheck, test, build
  web và compile cả hai firmware environment bằng PlatformIO.

### Các tầng watchdog

| Tầng | Timeout | Hành động |
| --- | ---: | --- |
| AI-result (browser) | 350 ms | AI worker im lặng -> STOP + banner cảnh báo |
| Chất lượng bám tay | tức thì | tay điều hướng quality < 0.5 hoặc đang bắt lại -> STOP |
| Host (ESP1) | 225 ms | không có dòng GD2 hợp lệ -> phát STOP qua LoRa |
| Radio (ESP2) | 225 ms | không có packet mới hợp lệ -> PWM 0 (short-brake) |
| Motor disable (ESP2) | 1 s | mất radio kéo dài -> hạ STANDBY, motor coast |

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
| Control airtime | 16 byte ≈ 25.7 ms |
| Telemetry airtime | 12 byte ≈ 20.6 ms, reply ~2 Hz trong khe idle ~24 ms |

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

`npm run dev` và `npm run build` tự chạy `npm run vendor:mediapipe` trước, để
copy WASM từ `node_modules` và tải model `hand_landmarker.task` (~7.5 MB) vào
`public/mediapipe/`. Script này bỏ qua êm khi offline; worker sẽ fallback CDN,
vì vậy nên chạy nó một lần khi còn mạng trước buổi vận hành offline.

Kiểm tra source:

```bash
npm test
npm run typecheck
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

Unit test chạy ngay trên máy dev, không cần board — bao phủ CRC, khung packet,
số học sequence và drive math (mixer, ramp, hiệu chỉnh bánh):

```bash
pio test -e native
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
test/                    Unit test host-side cho firmware (pio test -e native)
docs/                    Protocol, wiring, calibration, safety tests
```

Hai sketch cũ trong `esp sketch/` là entrypoint tương thích Arduino IDE và include
source canonical bên dưới `firmware/`.

## Tài liệu chi tiết

- [Hướng dẫn vận hành](USAGE_GUIDE.md)
- [Kiến trúc](docs/ARCHITECTURE.md)
- [AI gesture pipeline và lựa chọn model](docs/AI_GESTURE_PIPELINE.md)
- [Protocol GD2 và packet 16 byte](docs/PROTOCOL.md)
- [Đấu nối phần cứng](docs/HARDWARE_WIRING.md)
- [Hiệu chỉnh motor](docs/CALIBRATION.md)
- [Bài test an toàn](docs/SAFETY_TESTS.md)

## P1 còn lại

- Biểu đồ thống kê dài hạn cho packet loss và latency.

`LINK:LORA` xác nhận SX1262 của ESP1 hoàn tất transmit. Xác nhận end-to-end đến
từ dòng `TELEMETRY:` mà ESP1 in ra sau khi nhận reply ~2 Hz của ESP2, kèm packet
loss ESP2 tự đo giữa hai lần telemetry.
