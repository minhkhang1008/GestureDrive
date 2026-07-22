# Hướng dẫn sử dụng GestureDrive

Tài liệu này là hợp đồng chung cho nhóm AI, nhóm app và nhóm phần cứng.

## 1. Chuẩn bị

- Chrome hoặc Edge trên máy tính.
- Node.js 20 trở lên.
- Hai ESP32 nguyên bản có Bluetooth Classic.
- ESP1 đã nạp sketch `esp sketch/send/send/send.ino`.
- ESP2 đã nạp sketch `esp sketch/receive/receive.ino`.
- Đã điền đúng MAC Wi-Fi STA của ESP2 vào `receiverMac` trên ESP1.
- Đã sửa chân motor trong sketch ESP2 theo mạch thật.

Ứng dụng không có chế độ giả lập. Khi chưa kết nối ESP1, camera vẫn có thể nhận
dạng để kiểm tra thuật toán nhưng giao diện luôn báo chưa có đường truyền thật.

## 2. Khởi động

```bash
npm install
npm run dev
```

1. Mở địa chỉ Vite bằng Chrome hoặc Edge.
2. Bật nguồn ESP2 trên xe.
3. Cắm ESP1 vào laptop bằng cáp USB dữ liệu.
4. Bấm **Kết nối ESP1**, chọn cổng CP210x hoặc CH340 tương ứng.
5. Quan sát trạng thái trên thanh trên:
   - **ESP-NOW**: đường chính đang hoạt động.
   - **Bluetooth**: ESP1 đã tự chuyển sang đường dự phòng.
   - **Mất ESP2**: USB tới ESP1 còn hoạt động nhưng chưa tới được xe.
6. Bấm **Bật camera** và cấp quyền camera.

## 3. Xác nhận vai trò hai tay

Đặt một tay ở nửa trái và một tay ở nửa phải của khung camera. Hai tay không bắt
buộc theo tay trái/tay phải sinh học.

1. Xòe tay muốn dùng để điều hướng.
2. Nắm tay muốn dùng để điều khiển tốc độ.
3. Giữ ổn định trong tám khung hình.
4. Khi thành công, app hiện nhãn **TAY ĐIỀU HƯỚNG**, **TAY TỐC ĐỘ**, tâm joystick
   và thanh tốc độ đúng bên.

Quy ước cố định trong bản này:

- Tay xòe lúc xác nhận = tay điều hướng.
- Tay nắm lúc xác nhận = tay tốc độ.

Muốn đổi vai trò, đưa cả hai tay ra khỏi camera ít nhất 0,8 giây. App dừng xe,
xóa hiệu chuẩn và chờ thao tác xòe - nắm mới.

## 4. Điều hướng

Tâm lòng bàn tay lúc xác nhận được lưu làm gốc joystick. Di chuyển tay quanh gốc
để chọn một trong chín vùng:

| Vị trí | Hướng |
| --- | --- |
| Tâm | Dừng |
| Trên | Đi thẳng |
| Trên trái | Chếch trái |
| Trên phải | Chếch phải |
| Trái | Quay tại chỗ sang trái |
| Phải | Quay tại chỗ sang phải |
| Dưới | Đi lùi |
| Dưới trái | Lùi chếch trái |
| Dưới phải | Lùi chếch phải |

Ba hướng trên chỉ hợp lệ khi lòng bàn tay hướng vào camera. Ba hướng dưới chỉ
hợp lệ khi mu bàn tay hướng vào camera. Nếu mặt tay chưa đúng, app hiển thị hướng
dẫn và phát trạng thái dừng.

Vùng dừng mặc định có bán kính `0.035` theo tọa độ chuẩn hóa camera. Bốn khung
hình liên tiếp phải cùng một hướng trước khi hướng đó có hiệu lực. Hai lớp này
loại rung tay nhưng vẫn giữ phản hồi nhanh.

## 5. Điều khiển tốc độ

Trên tay tốc độ:

1. Thu ngón giữa, áp út và út.
2. Duỗi ngón trỏ và ngón cái để mở khóa thanh kéo.
3. Đưa ngón trỏ lên để tăng PWM, đưa xuống để giảm PWM.
4. Thu ngón cái nhưng giữ ngón trỏ để khóa tốc độ hiện tại.

Thanh tốc độ dùng khoảng dọc từ 14% tới 86% chiều cao camera và ánh xạ thành
PWM 255 tới 0. Thay đổi nhỏ dưới 4 PWM bị bỏ qua để chống rung.

Khóa tốc độ chỉ ngăn cập nhật thanh kéo. Tay điều hướng vẫn tiếp tục điều khiển
xe bằng mức tốc độ đã giữ.

## 6. Chế độ AUTO và MANUAL

### AUTO

- Nhận lệnh từ hai tay.
- Thiếu một tay thì dừng sau 300 ms.
- Cả hai tay rời khung 0,8 giây thì xóa vai trò.
- App gửi heartbeat tới ESP1 mỗi 200 ms.

### MANUAL

Dùng để kiểm tra motor và căn vị trí xe. Bàn điều khiển có đủ 8 hướng, nút dừng
và thanh PWM 0-255.

- `W`: tiến.
- `S`: lùi.
- `A`: quay trái.
- `D`: quay phải.
- `Space`: dừng.

Mỗi lần chuyển AUTO/MANUAL, app gửi dừng trước để lệnh từ chế độ cũ không tiếp
tục chạy.

## 7. Luồng ESP-NOW và Bluetooth dự phòng

Laptop luôn nói chuyện với ESP1 qua USB Serial. Bluetooth không thay thế cáp
laptop - ESP1, mà là đường dự phòng ESP1 - ESP2.

ESP1 gửi gói điều khiển mỗi 100 ms:

1. Mặc định gửi qua ESP-NOW Long Range.
2. Sau ba callback gửi thất bại, nếu Bluetooth đã kết nối thì chuyển sang SPP.
3. Khi đang dùng Bluetooth, ESP1 vẫn thử ESP-NOW mỗi giây.
4. Sau ba lần ESP-NOW thành công liên tiếp, ESP1 tự quay lại đường chính.
5. ESP1 in trạng thái `LINK:*` qua USB để app cập nhật giao diện.

Cả hai ESP phải dùng `ESPNOW_CHANNEL = 6`. Nếu đổi kênh, sửa cùng giá trị trong
cả hai sketch.

## 8. Giao thức giữa ba nhóm

### App tới ESP1

```text
GD,sequence,leftMotor,rightMotor,speed,direction,flags\n
```

| Trường | Miền giá trị | Ý nghĩa |
| --- | --- | --- |
| `sequence` | 0-65535 | Số thứ tự gói USB |
| `leftMotor` | -255 đến 255 | Dấu là chiều quay, trị tuyệt đối là PWM |
| `rightMotor` | -255 đến 255 | Dấu là chiều quay, trị tuyệt đối là PWM |
| `speed` | 0-255 | Mức thanh tốc độ |
| `direction` | 0-8 | Dừng, 8 hướng theo bảng dưới |
| `flags` | bit field | Bit 0 bằng 1 khi tốc độ đã khóa |

| Mã hướng | Giá trị |
| --- | ---: |
| Dừng | 0 |
| Tiến | 1 |
| Lùi | 2 |
| Trái | 3 |
| Phải | 4 |
| Chếch trái | 5 |
| Chếch phải | 6 |
| Lùi chếch trái | 7 |
| Lùi chếch phải | 8 |

### ESP1 tới ESP2

`DrivePacket` dài 13 byte, có cùng trường motor, tốc độ, hướng và cờ. Gói thêm
magic `0x4744`, version và checksum XOR. ESP-NOW và Bluetooth dùng đúng cùng một
cấu trúc để tránh hai nhánh firmware xử lý khác nhau.

## 9. Ba lớp dừng an toàn

| Lớp | Timeout | Tác dụng |
| --- | ---: | --- |
| App | 300 ms | Dừng khi không còn đủ hai tay |
| ESP1 | 600 ms | Dừng khi tab bị treo, mất USB hoặc mất heartbeat |
| ESP2 | 700 ms | Dừng khi mất cả ESP-NOW và Bluetooth |

Không tăng timeout nếu chưa kiểm tra quãng đường xe tiếp tục trôi ở tốc độ tối
đa.

## 10. Xử lý sự cố

| Hiện tượng | Kiểm tra |
| --- | --- |
| Không có nút chọn cổng | Dùng Chrome/Edge desktop, không dùng Safari/Firefox |
| Không thấy ESP1 | Đổi cáp USB dữ liệu, cài driver CP210x/CH340 |
| App báo mất ESP2 | Kiểm tra nguồn ESP2, MAC trong ESP1, kênh 6 và LR trên cả hai |
| ESP-NOW luôn lỗi | Đảm bảo MAC lấy từ `WiFi.macAddress()` của ESP2, không dùng MAC Bluetooth |
| Bluetooth không kết nối | Cả hai board phải là ESP32 nguyên bản, tên ESP2 phải là `GestureDrive-ESP2` |
| Nhận sai vai trò | Đưa cả hai tay ra 0,8 giây, vào lại hai nửa màn hình và giữ xòe - nắm |
| Không nhận hướng lùi | Quay mu bàn tay về camera trước khi kéo xuống |
| Tốc độ không đổi | Chỉ duỗi ngón trỏ + cái, thu ba ngón còn lại |
| Xe chạy ngược | Đổi dây motor hoặc đổi cặp `IN1/IN2` của bánh đó trong sketch |
| Hai bánh lệch tốc độ | Hiệu chỉnh riêng PWM motor hoặc thay `TURN_RATIO` sau khi đo thực tế |

## 11. Checklist trước khi chạy xe

- [ ] Kê bánh xe khỏi mặt đất trong lần thử firmware đầu tiên.
- [ ] Nút dừng MANUAL đưa cả hai PWM về 0.
- [ ] Rút USB hoặc đóng tab làm xe dừng trong khoảng một giây.
- [ ] Tắt ESP1 làm ESP2 tự dừng.
- [ ] Đúng MAC Wi-Fi STA và đúng kênh 6.
- [ ] UI hiển thị ESP-NOW khi đường chính tốt.
- [ ] Tắt hoặc che sóng ESP-NOW để kiểm tra trạng thái Bluetooth dự phòng.
- [ ] Thử đủ 8 hướng ở PWM thấp trước khi tăng tốc.
- [ ] Kiểm tra ánh sáng và nền camera tại nơi thuyết trình.
