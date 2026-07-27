# Kiến trúc GestureDrive

## Data path

```text
Laptop camera 1280x720 (requestVideoFrameCallback)
    |
    v
ImageBitmap downscale <=360 px -> MediaPipe Hand Landmarker worker
    |
    v
hand tracker (id ổn định, chặn nhảy, quality, vận tốc)
    |
    v
React control state -> GD2 ASCII + CRC, 20 Hz -> USB Web Serial
                                                    |
                                                    v
                                              ESP1 / SX1262
                                                    |
                            control 20 Hz | raw LoRa P2P | telemetry ~2 Hz
                                          v             ^
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

Telemetry đi ngược đường điều khiển: ESP2 phát reply 12 byte (~20.6 ms airtime)
ngay sau khi chấp nhận một control packet, lọt trong khe idle ~24 ms giữa hai
lần phát 20 Hz của ESP1, tối đa 2 Hz. ESP1 in dòng `TELEMETRY:` để frontend
hiển thị RSSI/SNR, packet loss, failsafe, battery, output motor và E-stop.

LoRaWAN, network server, ESP-NOW và Bluetooth Classic không nằm trong kiến trúc.

## Trách nhiệm từng tầng

### Browser

- Camera và MediaPipe chỉ chạy tại laptop; hình ảnh không gửi lên server.
- `detectForVideo()` chạy trong dedicated worker, GPU trước và CPU fallback;
  worker được recycle sang CPU sau 5 lỗi detect liên tiếp, và tự rebuild sang
  CPU khi GPU chậm bất thường kéo dài.
- Chỉ có một inference đang chạy; frame cũ không bị xếp hàng.
- Landmark thô đi qua tracker trước khi vào logic cử chỉ: id ổn định cho từng
  bàn tay, chặn cú nhảy vượt tốc độ khả thi, và điểm chất lượng 0..1 mà logic
  cử chỉ dùng để từ chối chạy xe trên một bàn tay chưa đáng tin.
- Điều khiển analog (anchor + One-Euro + dead zone hysteresis + expo), lòng/mu
  bàn tay và pinch-drag tốc độ nằm trong
  [`AI_GESTURE_PIPELINE.md`](AI_GESTURE_PIPELINE.md).
- Watchdog AI-result 350 ms độc lập capture loop: worker im lặng là STOP ngay.
- State điều khiển có đúng ba packet type: STOP, DRIVE, DIRECT_PWM.
- Serial TX theo kiểu latest-wins: một write in-flight, một slot pending thay
  thế được, write timeout 300 ms; cổng kẹt không bao giờ tích lũy hàng đợi
  command chuyển động cũ. Mỗi lần connect là một epoch riêng để cleanup không
  đụng kết nối mới.
- Heartbeat gửi latest command mỗi 50 ms bằng timer trong dedicated worker —
  timer main-thread bị browser throttle ~1 Hz khi tab ẩn, còn worker thì
  không; App vẫn gửi STOP ngay khi tab mất focus.
- Wake lock giữ màn hình sáng khi serial đang kết nối, tự xin lại khi tab hiện
  trở lại.
- Lifecycle, dead-man, Space và mode switch tạo STOP.
- E-stop được latch cục bộ để callback cũ không phát lại chuyển động; telemetry
  báo latch từ xe sẽ re-latch UI, và reset yêu cầu telemetry xác nhận khi
  telemetry còn tươi.

### ESP1

- Parser ký tự fixed-size, không dùng Arduino `String`.
- Dòng sai không thay latest valid command.
- Sequence host cũ/trùng bị loại; sau host timeout cho phép browser session mới
  bắt đầu lại sequence; 3 lần loại liên tiếp không có timeout xen giữa sẽ bỏ
  sequence lock (`HOST_ERROR:SEQUENCE_RESYNC`).
- Latest valid command được phát LoRa đúng 20 Hz theo lịch drift-free (cộng
  interval, không cộng từ "now"; catch-up clamp khi trễ hơn một chu kỳ).
- Host im 225 ms sẽ thay command bằng STOP.
- Radio transmit dùng interrupt, không chặn parser; TX watchdog 60 ms thu hồi
  radio khi mất TX-done; radio init lỗi được retry mỗi 2 s.
- Sau mỗi control TX, ESP1 mở cửa sổ receive trong khe idle để nhận telemetry
  reply của ESP2 và in dòng `TELEMETRY:` cho frontend.

### ESP2

- Chỉ nhận packet đúng 16 byte, magic/version/range/CRC và sequence mới.
- E-stop hợp lệ được ưu tiên ngay cả khi packet trùng; latch được giữ qua
  brownout/soft reset bằng RTC noinit RAM.
- DRIVE mới qua differential mixer. DIRECT_PWM bỏ qua mixer nhưng vẫn chịu
  speed limit, gain, min PWM, max PWM, ramp và watchdog.
- Ramp chạy trong miền command thuần; deadband, invert, gain, clamp MAX_PWM và
  breakaway-floor remap áp tại thời điểm ghi (ramp-then-calibrate).
- Đảo chiều ramp về 0 trước khi đổi direction pin.
- STOP và watchdog đặt PWM 0 ngay, short-brake khi `BRAKE_ON_STOP` bật. Mất
  radio 1 giây sẽ disable STANDBY (coast).
- Failsafe radio cũng bỏ sequence lock để ESP1 vừa reboot khôi phục link ngay.
- Phát telemetry 12 byte ngay sau khi chấp nhận control packet, tối đa 2 Hz.
- `startReceive`/`begin` lỗi được retry với backoff, escalate re-init sau 5 lần;
  `esp_task_wdt` 2 s reboot loop treo về trạng thái an toàn (motor disable).
- Boot luôn khởi tạo motor disable trước radio.

## Các tầng failsafe

| Tầng | Trigger | Hành động |
| --- | --- | --- |
| Browser | tay/camera/serial/lifecycle/dead-man | gửi STOP ngay nếu có thể |
| Browser | AI worker im lặng 350 ms | STOP + banner cảnh báo |
| Browser | tay điều hướng quality < 0.5, hoặc đang bắt lại | STOP, giữ vai trò |
| ESP2 | pin dưới ngưỡng critical 2 s liên tục | khóa motor tới khi tắt nguồn |
| ESP1 | không có GD2 hợp lệ trong 225 ms | phát STOP ở 20 Hz |
| ESP2 | không có packet mới hợp lệ trong 225 ms | PWM 0 (short-brake) |
| ESP2 | mất radio 1000 ms | hạ STANDBY, motor coast |
| ESP2 | loop treo quá 2 s (`esp_task_wdt`) | reboot, motor disable trước radio |

Các timeout là giới hạn logic, không thay thế đo quãng đường dừng thực tế.

## Extension points

`MotorController` nhận normalized targets và tách khỏi `MotorDriver`. Encoder/PID
có thể được thêm vào controller mà không đổi GD2 hoặc DrivePacket. Telemetry đã
chạy ~2 Hz trong khe TDMA sau mỗi control packet (xem
[`PROTOCOL.md`](PROTOCOL.md)); đây không phải ACK từng control packet.
