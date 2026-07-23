# Kiến trúc GestureDrive

## Data path

```text
Laptop camera
    |
    v
MediaPipe Hand Landmarker
    |
    v
React control state -> GD2 ASCII + CRC, 20 Hz -> USB Web Serial
                                                    |
                                                    v
                                              ESP1 / SX1262
                                                    |
                                             raw LoRa P2P
                                                    |
                                                    v
                                              ESP2 / SX1262
                                                    |
                    packet validation -> mixer -> calibration -> ramp
                                                    |
                                                    v
                                    two-direction + PWM motor driver
                                                    |
                                                    v
                                      left motor + right motor + caster
```

LoRaWAN, network server, ESP-NOW và Bluetooth Classic không nằm trong kiến trúc.

## Trách nhiệm từng tầng

### Browser

- MediaPipe và camera chỉ chạy tại laptop.
- State điều khiển có đúng ba packet type: STOP, DRIVE, DIRECT_PWM.
- Một Web Serial writer duy nhất serialize command với sequence và CRC.
- Heartbeat gửi latest command mỗi 50 ms, độc lập render camera.
- Lifecycle, dead-man, Space và mode switch tạo STOP.
- E-stop được latch cục bộ để callback cũ không phát lại chuyển động.

### ESP1

- Parser ký tự fixed-size, không dùng Arduino `String`.
- Dòng sai không thay latest valid command.
- Sequence host cũ/trùng bị loại; sau host timeout cho phép browser session mới
  bắt đầu lại sequence.
- Latest valid command được phát LoRa đúng 20 Hz với radio sequence riêng.
- Host im 225 ms sẽ thay command bằng STOP.
- Radio transmit dùng interrupt, không chặn parser bằng một transmit blocking.

### ESP2

- Chỉ nhận packet đúng 16 byte, magic/version/range/CRC và sequence mới.
- E-stop hợp lệ được ưu tiên ngay cả khi packet trùng.
- DRIVE mới qua differential mixer. DIRECT_PWM bỏ qua mixer nhưng vẫn chịu
  speed limit, gain, min PWM, max PWM, ramp và watchdog.
- Đảo chiều ramp về 0 trước khi đổi direction pin.
- STOP và watchdog đặt PWM 0 ngay. Mất radio 1 giây sẽ disable STANDBY.
- Boot luôn khởi tạo motor disable trước radio.

## Ba tầng failsafe

| Tầng | Trigger | Hành động |
| --- | --- | --- |
| Browser | tay/camera/serial/lifecycle/dead-man | gửi STOP ngay nếu có thể |
| ESP1 | không có GD2 hợp lệ trong 225 ms | phát STOP ở 20 Hz |
| ESP2 | không có packet mới hợp lệ trong 225 ms | PWM 0; disable sau 1000 ms |

Các timeout là giới hạn logic, không thay thế đo quãng đường dừng thực tế.

## Extension points

`MotorController` nhận normalized targets và tách khỏi `MotorDriver`. Encoder/PID
có thể được thêm vào controller mà không đổi GD2 hoặc DrivePacket. Telemetry P1
có thể chạy 1-2 Hz theo khe thời gian riêng; không ACK từng control packet.
