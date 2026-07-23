# Safety test checklist

Không đặt bánh xuống sàn cho tới khi mục A-D đều đạt. Mỗi lỗi phải cắt nguồn motor,
sửa nguyên nhân và chạy lại từ đầu.

## A. Test không nối motor

- [ ] Gắn antenna cho cả hai SX1262 trước khi cấp nguồn.
- [ ] Compile đúng `esp1_transmitter` và `esp2_receiver`.
- [ ] ESP2 boot báo `FAILSAFE:1`.
- [ ] ESP1 boot báo `HOST_TIMEOUT:1` và `LINK:NONE`.
- [ ] App kết nối Web Serial, host timeout chuyển `CLEAR`.
- [ ] ESP1 báo `RADIO_TX` ở khoảng 20 Hz và `LINK:LORA`.
- [ ] Đóng app: ESP1 báo `HOST_TIMEOUT:1` trong tối đa 250 ms.
- [ ] Dòng GD2 sai prefix, thiếu field, ngoài range và sai CRC không thay latest
  valid command.

## B. Test driver, bánh kê khỏi mặt đất

- [ ] Boot/reset ESP2 không tạo xung quay motor.
- [ ] Safety limit CAL là 60% hoặc thấp hơn.
- [ ] Mỗi nút motor chỉ quay đúng một/hai motor theo nhãn.
- [ ] Pointerup dừng ngay.
- [ ] Pointercancel và kéo chuột ra khỏi nút dừng ngay.
- [ ] W/A/S/D chỉ chạy khi giữ; keyup dừng.
- [ ] Space dừng từ mọi mode.
- [ ] Timed pulse 250/500/1000/2000 ms tự STOP đúng thời gian.
- [ ] Slider trái/phải tạo DIRECT_PWM độc lập, không bị đổi thành direction code.
- [ ] Đổi dấu lớn từ tiến sang lùi ramp về 0 trước khi direction pin đổi.
- [ ] Không duty nào vượt `MAX_PWM` và packet speedLimit.

## C. Failsafe

Dùng logic analyzer/oscilloscope trên PWM nếu có. Mốc 250 ms tính từ packet radio
hợp lệ cuối cùng ở ESP2.

- [ ] Ẩn tab hoặc blur window khi đang chạy: app gửi STOP.
- [ ] Ngắt Web Serial/đóng app: ESP1 phát STOP sau host timeout 225 ms.
- [ ] Rút USB ESP1 nhưng giữ ESP1 có nguồn riêng: host timeout tạo STOP.
- [ ] Tắt nguồn ESP1: ESP2 đặt PWM 0 trong tối đa 225 ms từ packet cuối.
- [ ] Chặn/mất radio: kết quả giống tắt ESP1.
- [ ] Sau 1000 ms mất radio, STANDBY ở disable.
- [ ] Reset ESP2: motor luôn disable trước khi radio init.
- [ ] Packet sai magic/version/size/CRC/range bị bỏ qua.
- [ ] Packet duplicate/cũ không refresh watchdog.
- [ ] Sequence `65535 -> 0` vẫn được chấp nhận.

## D. E-stop

- [ ] Escape hoặc nút đỏ đặt PWM 0 ngay và disable driver.
- [ ] Movement packet sau E-stop không làm motor quay.
- [ ] Đổi mode, reconnect browser hoặc reset ESP1 không clear latch ESP2.
- [ ] RESET_ESTOP khi chưa có ba STOP disarmed không clear latch.
- [ ] Chuỗi app Arm / Reset clear latch nhưng output vẫn 0.
- [ ] Xe chỉ chạy lại sau một dead-man action mới.

## E. Test có tải, limit thấp

- [ ] Có khu vực trống, bánh xe nguyên vẹn và physical cut-off trong tầm tay.
- [ ] Thử tiến/lùi/pivot ở 10-20% trước.
- [ ] Đo dòng stall và nhiệt driver.
- [ ] Đo thời gian/quãng đường dừng cho STOP, mất host và mất radio.
- [ ] Ghi worst case theo speedLimit và điện áp pin.
- [ ] Chỉ tăng MAX_PWM sau khi tất cả bài test dưới mức cũ đạt.

## Biên bản tối thiểu

Ghi ngày, commit, board model, SX1262 carrier, antenna, driver, battery, pin map,
radio config, calibration constants, người thực hiện và kết quả từng checkbox.
