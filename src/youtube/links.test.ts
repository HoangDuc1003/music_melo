import { describe, expect, it } from 'vitest';
import { parseYouTubeLink } from './links';

describe('parseYouTubeLink', () => {
  it('nhận các dạng link YouTube / YouTube Music', () => {
    expect(parseYouTubeLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVMdQw4w9WgXcQ')).toEqual({
      videoId: 'dQw4w9WgXcQ',
      playlistId: 'RDAMVMdQw4w9WgXcQ'
    });
    expect(parseYouTubeLink('https://youtu.be/dQw4w9WgXcQ?si=abc')).toEqual({ videoId: 'dQw4w9WgXcQ', playlistId: undefined });
    expect(parseYouTubeLink('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.videoId).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeLink(' https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG ')?.playlistId).toBe(
      'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'
    );
    expect(parseYouTubeLink('https://music.youtube.com/browse/VLPLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG')?.playlistId).toBe(
      'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'
    );
    expect(parseYouTubeLink('PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG')?.playlistId).toBe('PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
  });

  it('từ chối link lạ hoặc id sai định dạng', () => {
    expect(parseYouTubeLink('Lạc trôi')).toBeUndefined();
    expect(parseYouTubeLink('https://evil.com/watch?v=dQw4w9WgXcQ')).toBeUndefined();
    expect(parseYouTubeLink('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ')).toBeUndefined();
    expect(parseYouTubeLink('javascript:alert(1)//youtube.com')).toBeUndefined();
    expect(parseYouTubeLink('https://www.youtube.com/watch?v=../../etc')).toBeUndefined();
    expect(parseYouTubeLink('https://www.youtube.com/watch?v=<script>')).toBeUndefined();
    expect(parseYouTubeLink('https://www.youtube.com/')).toBeUndefined();
    expect(parseYouTubeLink('x'.repeat(5000))).toBeUndefined();
  });
});
