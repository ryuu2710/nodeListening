export function cleanDirtyGqlAsFreshJson(raw: string) {
    const start = raw.indexOf('{');
    if (start === -1) {
        throw new Error('Không tìm thấy ký tự "{" để bắt đầu JSON');
    }
    let braceCount = 0;
    let end = -1;
    for (let i = start; i < raw.length; i++) {
        if (raw[i] === '{') braceCount++;
        else if (raw[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
                end = i;
                break;
            }
        }
    }
    if (end === -1) {
        throw new Error('Không tìm thấy dấu "}" đóng khớp');
    }
    return raw.slice(start, end + 1);
}

export function cleanDirtyGqlAsArrayJson(raw: string): any[] {
  const results: any[] = [];
  let i = 0;

  while (i < raw.length) {
    // Tìm vị trí mở ngoặc đầu tiên tính từ vị trí i
    const start = raw.indexOf('{', i);
    if (start === -1) break; // Hết JSON rồi thì té

    let braceCount = 0;
    let end = -1;

    // Bắt đầu đếm cặp đóng mở ngoặc
    for (let j = start; j < raw.length; j++) {
      if (raw[j] === '{') braceCount++;
      else if (raw[j] === '}') {
        braceCount--;
        if (braceCount === 0) {
          end = j;
          break;
        }
      }
    }

    if (end !== -1) {
      const jsonStr = raw.slice(start, end + 1);
      try {
        // Parse luôn để kiểm tra tính hợp lệ
        results.push(JSON.parse(jsonStr));
      } catch (e) {
        // Nếu chunk bị lỗi (thường là do stream bị cắt ngang), bỏ qua
        console.warn('Phát hiện một chunk JSON lỗi, bỏ qua...');
      }
      i = end + 1; // Nhảy con trỏ tới sau dấu đóng ngoặc để tìm cục tiếp theo
    } else {
      // Nếu không tìm thấy dấu đóng ngoặc tương ứng, có thể data bị cụt
      break;
    }
  }

  return results;
}
