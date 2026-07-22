# GestureDrive

Hệ thống nhận dạng hai tay để điều khiển micromouse hai động cơ. Laptop chạy
MediaPipe và tính trực tiếp tốc độ hai bánh, ESP1 làm cầu nối, ESP2 đặt trên xe
điều khiển driver động cơ.

```text
Camera -> React + MediaPipe -> USB Serial -> ESP1
                                      ESP-NOW Long Range (ưu tiên)
                                      Bluetooth Classic (dự phòng)
                                                -> ESP2 -> 2 motor
```

`WIFI_PROTOCOL_LR` là chế độ Long Range của Wi-Fi/ESP-NOW, không phải module
LoRa của Semtech. Cả ESP1 và ESP2 phải dùng cùng kênh Wi-Fi và cùng bật LR.

## Phần cứng yêu cầu

- Hai board **ESP32 nguyên bản** có Bluetooth Classic SPP.
- Driver hai motor như L298N hoặc TB6612.
- Hai bánh sau có motor, bánh còn lại tự do.
- Cáp USB dữ liệu nối laptop với ESP1.

Bluetooth Classic không có trên ESP32-S2, C3 hoặc S3. Sketch chủ động báo lỗi
khi biên dịch nếu chọn một trong các chip này.

## Chạy ứng dụng

```bash
npm install
npm run dev
```

Mở địa chỉ Vite bằng Chrome hoặc Edge desktop vì ứng dụng dùng Web Serial. Dự
án không còn demo mode: lệnh chỉ được đánh dấu có kết nối khi cổng ESP1 thật đã
mở.

## Quy ước hai tay

1. Đưa hai tay vào hai nửa trái và phải của camera.
2. Xòe một tay và nắm tay còn lại, giữ ổn định để xác nhận:
   - Tay xòe trở thành **tay điều hướng**.
   - Tay nắm trở thành **tay tốc độ**.
3. Vị trí tay điều hướng lúc xác nhận là tâm joystick. Di chuyển khỏi tâm để
   chọn 8 hướng. Vùng tròn nhỏ quanh tâm là vùng dừng chống rung.
4. Với ba hướng phía trên, hướng lòng bàn tay vào camera. Với ba hướng phía
   dưới, hướng mu bàn tay vào camera. Quay trái/phải chấp nhận cả hai mặt.
5. Tay tốc độ chỉ duỗi ngón trỏ và ngón cái, ba ngón còn lại thu vào. Di chuyển
   ngón trỏ theo thanh dọc để đặt PWM 0-255. Thu ngón cái, giữ ngón trỏ để khóa
   tốc độ hiện tại.
6. Muốn đổi vai trò, đưa cả hai tay ra khỏi camera ít nhất 0,8 giây rồi thực hiện
   lại thao tác xòe - nắm.

Nếu thiếu một trong hai tay, app phát lệnh dừng sau 300 ms. Nếu mất app, ESP1 tự
dừng sau 600 ms. Nếu mất cả hai đường truyền, ESP2 tự dừng sau 700 ms.

## Hướng và tốc độ motor

| Hướng | Motor trái | Motor phải |
| --- | ---: | ---: |
| Dừng | 0 | 0 |
| Đi thẳng | `+speed` | `+speed` |
| Đi lùi | `-speed` | `-speed` |
| Quay trái | `-speed` | `+speed` |
| Quay phải | `+speed` | `-speed` |
| Chếch trái | `+0.45 × speed` | `+speed` |
| Chếch phải | `+speed` | `+0.45 × speed` |
| Lùi chếch trái | `-0.45 × speed` | `-speed` |
| Lùi chếch phải | `-speed` | `-0.45 × speed` |

Tỉ lệ bánh chậm nằm trong `TURN_RATIO` của `src/lib/commands.ts`.

## Nạp firmware

1. Nạp [`esp sketch/receive/receive.ino`](esp%20sketch/receive/receive.ino) cho
   ESP2.
2. Mở Serial Monitor 115200 và chép dòng `Wi-Fi STA MAC for ESP1 receiverMac`.
3. Dán sáu byte MAC vào `receiverMac` trong
   [`esp sketch/send/send/send.ino`](esp%20sketch/send/send/send.ino).
4. Kiểm tra `LEFT_IN1`, `LEFT_IN2`, `RIGHT_IN1`, `RIGHT_IN2` và `STANDBY_PIN`
   trong sketch ESP2 theo mạch thực tế.
5. Nạp sketch ESP1, cắm ESP1 vào laptop, bật nguồn ESP2.
6. Trong app bấm **Kết nối ESP1** và chọn đúng cổng CP210x/CH340.

ESP1 luôn thử ESP-NOW trước. Sau ba lần gửi thất bại, nó dùng kết nối Bluetooth
SPP tới thiết bị tên `GestureDrive-ESP2`. Trong lúc dùng Bluetooth, ESP1 vẫn dò
ESP-NOW định kỳ và tự quay lại đường chính sau ba lần gửi thành công.

## Giao thức dữ liệu

App gửi một dòng ASCII tới ESP1 mỗi 200 ms:

```text
GD,sequence,leftMotor,rightMotor,speed,direction,flags\n
```

- `leftMotor`, `rightMotor`: số có dấu từ -255 đến 255.
- `speed`: 0-255.
- `direction`: 0 dừng, 1 tiến, 2 lùi, 3 trái, 4 phải, 5 FL, 6 FR, 7 BL, 8 BR.
- `flags bit 0`: tốc độ đang khóa.

ESP1 đóng dữ liệu thành `DrivePacket` 13 byte có magic, version và checksum, sau
đó gửi cùng cấu trúc qua ESP-NOW hoặc Bluetooth. ESP1 báo trạng thái về app bằng
`LINK:ESPNOW`, `LINK:BLUETOOTH` hoặc `LINK:NONE`.

## Vị trí mã nguồn chính

- `src/lib/gestureRecognition.ts`: trạng thái ngón, hiệu chuẩn, 8 hướng, mặt
  lòng/mu bàn tay và thanh tốc độ.
- `src/hooks/useHandTracking.ts`: camera, theo dõi hai tay, chống rung và reset
  vai trò.
- `src/lib/commands.ts`: ánh xạ hướng sang PWM hai motor và giao thức USB.
- `src/hooks/useSerialConnection.ts`: Web Serial hai chiều và trạng thái đường
  truyền.
- `esp sketch/send/send/send.ino`: firmware ESP1.
- `esp sketch/receive/receive.ino`: firmware ESP2 và ba lớp dừng an toàn.

## Kiểm tra ứng dụng

```bash
npm run build
npm run lint
```

Xem hướng dẫn vận hành và xử lý lỗi chi tiết trong
[`USAGE_GUIDE.md`](USAGE_GUIDE.md).
