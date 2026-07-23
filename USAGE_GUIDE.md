# Hướng dẫn sử dụng GestureDrive

## 1. Chuẩn bị an toàn

- Laptop có Chrome hoặc Edge desktop và Node.js 20+.
- Hai ESP32-S3, hai SX1262 và antenna đúng dải tần.
- Driver hai motor loại hai direction + một PWM mỗi motor, ví dụ TB6612FNG hoặc
  L298N được đấu theo bảng trong `docs/HARDWARE_WIRING.md`.
- Nguồn motor riêng đúng điện áp, mass nguồn motor và ESP2 nối chung.
- Một công tắc ngắt nguồn motor vật lý trong tầm tay.

Không phát radio khi chưa gắn antenna. Không đặt xe xuống sàn trong lần test đầu.
Pin trong source là ví dụ và phải được xác nhận theo board thật.

## 2. Xác nhận config

Kiểm tra trước khi compile:

- ESP1: `firmware/transmitter/BoardPins.h`.
- ESP2: `firmware/receiver/BoardPins.h`.
- Radio: `firmware/common/RadioConfig.h`.
- Motor, mixer, ramp và timeout: `firmware/common/ConfigDefaults.h`.

Hai radio phải có cùng frequency, bandwidth, SF, coding rate, sync word và
preamble. `TCXO_VOLTAGE` phải đúng loại module.

## 3. Tìm cổng serial

- macOS: `ls /dev/cu.*`
- Linux: `ls /dev/ttyUSB* /dev/ttyACM*`
- Windows: mở Device Manager, mục Ports (COM & LPT).

Rút rồi cắm lại board để xác định cổng vừa xuất hiện. Dùng cáp USB có dữ liệu,
không dùng cáp chỉ sạc.

### Cài RadioLib

`pio run` sẽ tự tải đúng RadioLib 7.7.1 từ `platformio.ini`. Với Arduino IDE 2,
mở Library Manager, tìm **RadioLib by Jan Gromes** và cài 7.7.1; trong Boards
Manager cài **esp32 by Espressif Systems** 2.0.17. Firmware trong repo được
compile xác nhận bằng PlatformIO, vì vậy đây là workflow khuyến nghị.

## 4. Compile và nạp ESP2 trước

Để nguồn motor đang tắt và bánh được kê khỏi mặt bàn:

```bash
pio run -e esp2_receiver
pio run -e esp2_receiver -t upload --upload-port <ESP2_PORT>
pio device monitor --port <ESP2_PORT> --baud 115200
```

Sau boot phải thấy `FAILSAFE:1`. Motor phải không quay và STANDBY phải ở mức
disable. Nếu radio không khởi tạo, monitor báo `RADIO_ERROR:<code>`; không tiếp
tục thử motor cho đến khi sửa wiring/config.

## 5. Compile và nạp ESP1

Gắn antenna cho cả hai radio:

```bash
pio run -e esp1_transmitter
pio run -e esp1_transmitter -t upload --upload-port <ESP1_PORT>
pio device monitor --port <ESP1_PORT> --baud 115200
```

ESP1 boot ở `HOST_TIMEOUT:1` và `LINK:NONE`. Khi nhận GD2 hợp lệ từ app, host
timeout về 0. Sau khi SX1262 hoàn tất transmit, trạng thái chuyển `LINK:LORA`.

## 6. Chạy frontend

```bash
npm install
npm run dev
```

1. Mở URL Vite bằng Chrome hoặc Edge.
2. Bấm **Kết nối ESP1** và chọn đúng cổng.
3. Kiểm tra `Serial = CONNECTED`, `LoRa = LORA`, `Host timeout = CLEAR`.
4. Chuyển sang `CAL` cho buổi hiệu chỉnh đầu tiên.

## 7. CALIBRATION

- Safety limit mặc định 60%, tương ứng packet tối đa `600`.
- Hai slider đặt giá trị yêu cầu từ -100% đến +100%; giá trị packet bị giới hạn
  theo safety limit.
- Slider không tự chạy motor. Giữ **Giữ để áp dụng hai slider** mới gửi
  `DIRECT_PWM`; thả, pointer cancel hoặc rời nút sẽ STOP.
- Tám nút thử nhanh cũng chỉ chạy khi giữ.
- Timed pulse chạy hai giá trị slider trong 250, 500, 1000 hoặc 2000 ms rồi
  tự STOP.
- W/S chạy hai bánh tiến/lùi; A/D pivot trái/phải. Keyup luôn STOP.

Space luôn STOP. Escape luôn gửi E-stop, bất kể mode.

## 8. MANUAL

MANUAL gửi `DRIVE`, vì vậy ESP2 thực hiện mixer:

```text
leftRaw  = throttle - K_TURN * steering
rightRaw = throttle + K_TURN * steering
```

Nút hướng và W/A/S/D là dead-man. Nhấn giữ mới chạy; nhả sẽ STOP. Slider chung
chỉ thay `speedLimit`.

## 9. AUTO

1. Bật camera.
2. Xòe tay điều hướng và nắm tay tốc độ ở hai bên camera.
3. Giữ tám frame để xác nhận role.
4. Tay tốc độ dùng ngón trỏ + ngón cái để chỉnh và thu ngón cái để khóa limit.
5. Thiếu tay điều hướng hoặc thiếu đủ hai tay sẽ STOP.

AUTO hiện giữ sector 8 hướng để tương thích UI. Continuous gesture và role
matching qua vị trí frame trước là P1, chưa dùng cho buổi calibration P0.

## 10. E-stop và reset

E-stop được latch ở browser và ESP2. Không đổi mode hoặc khôi phục serial nào tự
clear được nó.

1. Nhấn Escape hoặc nút đỏ E-STOP.
2. Xử lý nguyên nhân, kê bánh và bảo đảm khu vực an toàn.
3. Kết nối lại ESP1 nếu cần.
4. Bấm **Arm / Reset**.
5. App gửi ít nhất ba STOP disarmed, sau đó giữ packet reset nhiều chu kỳ radio.
6. ESP2 chỉ clear latch khi đã thấy đúng trình tự; output vẫn bằng 0 sau reset.
7. Phải thực hiện một dead-man action mới để xe chạy lại.

## 11. Tự dừng theo lifecycle

App cố gửi STOP khi window blur, tab ẩn, pagehide, đổi mode hoặc mất serial. ESP1
tự chuyển latest command thành STOP nếu không có dòng host hợp lệ trong 225 ms.
ESP2 đưa PWM về 0 nếu không có packet radio mới hợp lệ trong 225 ms và hạ
STANDBY sau 1000 ms.

Xem bài test bắt buộc tại `docs/SAFETY_TESTS.md` trước khi đặt bánh xuống sàn.

## 12. Xử lý sự cố

| Hiện tượng | Kiểm tra |
| --- | --- |
| Không có Web Serial | Dùng Chrome/Edge desktop và HTTPS hoặc localhost |
| Không thấy ESP1 | Cáp dữ liệu, driver USB, đúng cổng, đóng Serial Monitor |
| `HOST_ERROR:CRC` | App và ESP1 không cùng protocol GD2 hoặc line bị hỏng |
| `HOST_ERROR:SEQUENCE` | Dòng cũ/trùng; chờ host timeout hoặc reset ESP1 |
| `RADIO_ERROR` khi begin | NSS/DIO1/RESET/BUSY/SPI, TCXO và nguồn 3.3 V |
| ESP1 `LINK:LORA`, xe không chạy | ESP2, config radio hai phía, antenna và wiring motor |
| Xe chạy ngược | Sửa `LEFT_INVERTED`/`RIGHT_INVERTED`, không đổi dây khi có nguồn |
| Driver không thức | Kiểm tra STANDBY hoặc đặt `HAS_STANDBY=false` nếu không có pin này |
| Motor rung nhưng không quay | Đo PWM minimum theo `docs/CALIBRATION.md` |
