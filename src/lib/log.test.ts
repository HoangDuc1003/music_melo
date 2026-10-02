import { describe, expect, it } from 'vitest';
import { getLogs, log, logsAsText, redact } from './log';

describe('redact', () => {
  it('ẩn link googlevideo, token, IP', () => {
    const url = 'https://rr3---sn-8pxuuxa-nboe7.googlevideo.com/videoplayback?expire=1&ip=113.161.1.2&sig=AOq0QJ8w&n=abc';
    expect(redact(`tải lỗi ${url} 403`)).toBe('tải lỗi https://…googlevideo.com/[link đã ẩn] 403');
    expect(redact('Authorization: Bearer ya29.a0AfB_byC-xyz')).toBe('Authorization: Bearer ***');
    expect(redact('POST /token?code=4/0AY0e&client_secret=GOCSPX-abc')).toBe('POST /token?code=***&client_secret=***');
    expect(redact('{"access_token":"ya29.x","refresh_token":"1//0g","expires_in":3599}')).toBe(
      '{"access_token":"***","refresh_token":"***","expires_in":3599}'
    );
    expect(redact('client 192.168.1.20 / 2001:ee0:4f4c:8a10::1')).toContain('x.x.x.x');
    expect(redact('Lạc trôi via VISIONOS in 812ms')).toBe('Lạc trôi via VISIONOS in 812ms');
  });

  it('ẩn mã đăng nhập Spotify (PKCE) và token đã lưu', () => {
    expect(redact('com.melo.music://spotify/callback?code=AQB1x&state=Zz9')).toBe('com.melo.music://spotify/callback?code=***&state=***');
    expect(redact('grant_type=authorization_code&code_verifier=abc123&client_id=0123')).toBe(
      'grant_type=authorization_code&code_verifier=***&client_id=0123'
    );
    expect(redact('{"accessToken":"BQD","refreshToken":"AQC","clientId":"0123"}')).toBe('{"accessToken":"***","refreshToken":"***","clientId":"0123"}');
  });

  it('nhật ký luôn đã được làm sạch', () => {
    log.error('download', new Error('HTTP 403 https://r1.googlevideo.com/videoplayback?ip=1.2.3.4'));
    const last = getLogs().at(-1)!;
    expect(last.message).not.toContain('1.2.3.4');
    expect(logsAsText()).not.toContain('ip=1.2.3.4');
  });
});
