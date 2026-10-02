/**
 * Mở hộp chọn file của hệ thống. Phải gọi ngay trong lúc người dùng bấm (Safari chỉ mở hộp chọn khi đang chạm),
 * nên ô chọn file được tạo và bấm luôn, không chờ gì trước đó. Huỷ thì trả về mảng rỗng (trình duyệt có sự kiện "cancel").
 */
export function pickFiles(options: { accept: string; multiple?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = options.accept;
    input.multiple = Boolean(options.multiple);
    input.hidden = true;
    const finish = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish([...(input.files ?? [])]), { once: true });
    input.addEventListener('cancel', () => finish([]), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}
