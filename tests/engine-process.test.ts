import { describe, expect, it } from 'vitest';
import { runProcess } from '../runtime/engines/process.js';

async function failingProcess(diagnostic: string, dependency: string) {
  return runProcess(process.execPath, ['-e', 'process.stderr.write(process.argv[1]); process.exitCode = 1;', diagnostic], { dependency });
}

describe('media engine transport failures', () => {
  it('exposes a terminal yt-dlp handshake timeout to the bounded network retry policy', async () => {
    await expect(failingProcess('ERROR: Unable to download JSON metadata: <urlopen error _ssl.c:1028: The handshake operation timed out> https://example.com/private?token=secret\n', 'yt-dlp'))
      .rejects.toMatchObject({ code: 'NETWORK_TIMEOUT', retryable: true, message: expect.not.stringContaining('secret') });
  });

  it('does not turn previous warnings, certificate failures, or unrelated tools into network timeouts', async () => {
    for (const [dependency, message] of [
      ['yt-dlp', 'WARNING: The handshake operation timed out\nERROR: HTTP Error 403: Forbidden\n'],
      ['yt-dlp', 'ERROR: SSL: CERTIFICATE_VERIFY_FAILED certificate verify failed\n'],
      ['ffmpeg', 'ERROR: The handshake operation timed out\n'],
    ]) {
      await expect(failingProcess(message!, dependency!)).rejects.toMatchObject({ code: 'ENGINE_FAILED' });
    }
  });
});
