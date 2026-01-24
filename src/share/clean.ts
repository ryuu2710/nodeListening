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
