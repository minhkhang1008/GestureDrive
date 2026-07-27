# Safety test checklist

Không đặt bánh xuống sàn cho tới khi mục A-D đều đạt. Mỗi lỗi phải cắt nguồn motor,
sửa nguyên nhân và chạy lại từ đầu.

## A. Test không nối motor

- [ ] Gắn antenna cho cả hai SX1262 trước khi cấp nguồn.
- [ ] Compile đúng `esp1_transmitter` và `esp2_receiver`.
- [ ] ESP2 boot báo `FAILSAFE:1`.
- [ ] ESP1 boot báo `HOST_TIMEOUT:1` và `LINK:NONE`.
- [ ] App kết nối Web Serial, host timeout chuyển `CLEAR`.
- [ ] ESP1 báo `RADIO_TX` (log 2 Hz dù radio phát 20 Hz) và `LINK:LORA`.
- [ ] Khi cả hai board có nguồn, ESP1 in dòng `TELEMETRY:` ~2 Hz và panel
  telemetry của app hiển thị RSSI/SNR, packet loss, output và E-stop.
- [ ] Tắt nguồn ESP2 nhưng giữ ESP1: app đánh dấu telemetry là **cũ** (stale)
  sau vài giây, không tiếp tục trình bày số liệu cuối như thể còn sống.
- [ ] Đóng app: ESP1 báo `HOST_TIMEOUT:1` trong tối đa 250 ms.
- [ ] Reload tab browser khi đang kết nối (không chờ host timeout): ESP1 báo
  `HOST_ERROR:SEQUENCE` tối đa hai lần rồi `HOST_ERROR:SEQUENCE_RESYNC`, sau
  đó chấp nhận sequence mới và link phục hồi.
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
- [ ] Brake-on-stop: STOP khi bánh đang quay tạo short-brake (bánh dừng gắt,
  khó xoay bằng tay ngay sau STOP), không thả trôi. Sau 1 s mất radio hoặc khi
  driver disable, bánh chuyển sang coast (xoay tay nhẹ).

## C. Failsafe

Dùng logic analyzer/oscilloscope trên PWM nếu có. Mốc 250 ms tính từ packet radio
hợp lệ cuối cùng ở ESP2.

- [ ] Ẩn tab hoặc blur window khi đang chạy: app gửi STOP.
- [ ] Che camera (hoặc rút camera) khi đang chạy AUTO: banner "AI không phản
  hồi" xuất hiện và xe STOP trong tối đa ~0.5 s (watchdog AI-result 350 ms).
- [ ] Ngắt Web Serial/đóng app: ESP1 phát STOP sau host timeout 225 ms.
- [ ] Cho người thứ hai đưa tay vào khung hình phía sau người lái khi đang
  chạy: vai trò không nhảy sang tay lạ, và nếu tracker phải bắt lại tay thì
  banner "Đang bắt lại bàn tay" xuất hiện kèm STOP.
- [ ] Đưa nhanh tay điều hướng ra khỏi khung rồi vào lại: xe STOP khi mất tay,
  vai trò tự gắn lại trong 800 ms mà không phải làm lại xòe/nắm.
- [ ] Hai tay đổi bên (tay trái sang nửa phải và ngược lại) khi đang chạy: vai
  trò đi theo đúng bàn tay, không đảo điều hướng/tốc độ.
- [ ] Che một phần **tay điều hướng** để chỉ số `bám tay` tụt dưới 50%: xe STOP
  ngay và chỉ chạy lại khi chỉ số hồi phục.
- [ ] Đặt LIMIT rồi hạ hẳn tay tốc độ khỏi khung hình: xe **vẫn chạy** đúng
  mức LIMIT đã đặt, chip hiển thị "Giữ mức (không thấy tay)". Xác nhận đây là
  hành vi mong muốn cho khu vực test trước khi chạy có tải.
- [ ] Trong lúc chỉ còn tay điều hướng, rút nốt tay đó: xe STOP trong ~0.2 s.
- [ ] Hạ tay tốc độ thật chậm để nó đi qua tư thế "sai cử chỉ": xe không được
  giật/dừng giữa chừng, mức LIMIT giữ nguyên suốt quá trình.
- [ ] Đưa tay tốc độ trở lại ở độ cao khác hẳn rồi chụm: LIMIT không nhảy vọt,
  lần kéo mới tính từ điểm chụm mới.
- [ ] Xoay tay điều hướng 90 độ (ngón chỉ ngang) rồi thử tiến/lùi: gate lòng/mu
  bàn tay vẫn đúng chiều, không đảo.
- [ ] Rút USB ESP1 nhưng giữ ESP1 có nguồn riêng: host timeout tạo STOP.
- [ ] Tắt nguồn ESP1: ESP2 đặt PWM 0 trong tối đa 225 ms từ packet cuối.
- [ ] Chặn/mất radio: kết quả giống tắt ESP1.
- [ ] Sau 1000 ms mất radio, STANDBY ở disable.
- [ ] Reset ESP2: motor luôn disable trước khi radio init.
- [ ] Task watchdog ESP2: nếu ép loop treo (firmware test chèn vòng lặp vô hạn),
  `esp_task_wdt` reboot board trong ~2 s và boot lại ở trạng thái an toàn
  (motor disable, `FAILSAFE:1`) thay vì giữ PWM cuối mãi mãi.
- [ ] Packet sai magic/version/size/CRC/range bị bỏ qua.
- [ ] Packet duplicate/cũ không refresh watchdog.
- [ ] Sequence `65535 -> 0` vẫn được chấp nhận.
- [ ] Sau failsafe radio, ESP2 bỏ sequence lock: reboot ESP1 (radio sequence
  bắt đầu lại gần 0) và link phục hồi trong một cửa sổ watchdog, không phải
  chờ ~27 phút wrap.

## D. E-stop

- [ ] Escape hoặc nút đỏ đặt PWM 0 ngay và disable driver.
- [ ] Movement packet sau E-stop không làm motor quay.
- [ ] Đổi mode, reconnect browser hoặc reset ESP1 không clear latch ESP2.
- [ ] RESET_ESTOP khi chưa có ba STOP disarmed không clear latch.
- [ ] Chuỗi app Arm / Reset clear latch nhưng output vẫn 0.
- [ ] Khi telemetry đang chảy, Arm / Reset chỉ hoàn tất sau khi telemetry báo
  `estop = 0` từ xe; nếu xe vẫn latch (ví dụ chặn radio giữa chuỗi reset), app
  hủy reset, giữ E-STOP và hiển thị cảnh báo.
- [ ] Telemetry báo `estop = 1` trong khi UI tưởng đã clear: app tự re-latch
  E-stop phía browser.
- [ ] Brownout/soft reset ESP2 khi đang latch: latch vẫn còn sau reboot (RTC
  RAM); chỉ power-on thật mới xóa.
- [ ] Xe chỉ chạy lại sau một dead-man action mới.

## E. Test có tải, limit thấp

- [ ] Có khu vực trống, bánh xe nguyên vẹn và physical cut-off trong tầm tay.
- [ ] Thử tiến/lùi/pivot ở 10-20% trước.
- [ ] Đo dòng stall và nhiệt driver.
- [ ] Đo thời gian/quãng đường dừng cho STOP, mất host và mất radio.
- [ ] Ghi worst case theo speedLimit và điện áp pin.
- [ ] Chỉ tăng MAX_PWM sau khi tất cả bài test dưới mức cũ đạt.

## F. Bảo vệ pin (chỉ khi đã đấu divider)

- [ ] Đo điện áp pack **có tải** ở speedLimit cao nhất dự định dùng, xác nhận
  `BATTERY_WARN_MV` và `BATTERY_CRITICAL_MV` đều nằm dưới giá trị đó.
- [ ] Đối chiếu `batteryMv` trên UI với đồng hồ đo: sai số phải nhỏ hơn 0.1 V,
  nếu không thì `BATTERY_DIVIDER_RATIO` sai.
- [ ] Hạ tạm `BATTERY_WARN_MV` lên trên điện áp hiện tại: UI hiện cảnh báo vàng
  và xe vẫn chạy được.
- [ ] Hạ tạm `BATTERY_CRITICAL_MV` lên trên điện áp hiện tại: sau ~2 giây xe
  khóa motor, banner "PIN CẠN" xuất hiện, và lệnh chuyển động không làm motor
  quay nữa.
- [ ] Khóa critical không tự gỡ khi bỏ tải; chỉ power-cycle ESP2 mới gỡ.
- [ ] Trả hai ngưỡng về giá trị thật trước khi chạy thật.

## Biên bản tối thiểu

Ghi ngày, commit, board model, SX1262 carrier, antenna, driver, battery, pin map,
radio config, calibration constants, người thực hiện và kết quả từng checkbox.
