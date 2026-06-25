import * as fs from 'fs';
import { isNewerVersion, notifyUpdate } from '../src/utils/updateNotifier';

jest.mock('fs');

const mockedReadFile = fs.readFileSync as jest.Mock;
const mockedWriteFile = fs.writeFileSync as jest.Mock;
const PKG = { name: 'gqlprune', version: '2.6.0' };

describe('isNewerVersion', () => {
  it('detects a newer patch, minor or major', () => {
    expect(isNewerVersion('2.6.1', '2.6.0')).toBe(true);
    expect(isNewerVersion('2.7.0', '2.6.9')).toBe(true);
    expect(isNewerVersion('3.0.0', '2.9.9')).toBe(true);
  });

  it('is false for equal or older versions', () => {
    expect(isNewerVersion('2.6.0', '2.6.0')).toBe(false);
    expect(isNewerVersion('2.5.9', '2.6.0')).toBe(false);
  });

  it('is false for unparseable versions', () => {
    expect(isNewerVersion('nope', '2.6.0')).toBe(false);
    expect(isNewerVersion('2.6.0', '')).toBe(false);
  });
});

describe('notifyUpdate', () => {
  const realEnv = process.env;
  const realIsTTY = process.stdout.isTTY;
  const fetchMock = jest.fn();
  let errorSpy: jest.SpyInstance;

  const setTTY = (value: boolean | undefined) =>
    Object.defineProperty(process.stdout, 'isTTY', {
      value,
      configurable: true,
    });

  const okResponse = (version: string) => ({
    ok: true,
    json: () => Promise.resolve({ version }),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...realEnv };
    delete process.env.CI;
    delete process.env.NO_UPDATE_NOTIFIER;
    setTTY(true);
    global.fetch = fetchMock as unknown as typeof fetch;
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedReadFile.mockImplementation(() => {
      throw new Error('no cache');
    });
  });

  afterEach(() => errorSpy.mockRestore());

  afterAll(() => {
    process.env = realEnv;
    setTTY(realIsTTY);
  });

  it('prints a notice and caches when a newer version exists', async () => {
    fetchMock.mockResolvedValue(okResponse('9.9.9'));

    await notifyUpdate(PKG);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.npmjs.org/gqlprune/latest',
      expect.any(Object),
    );
    const out = errorSpy.mock.calls.flat().join('\n');
    expect(out).toContain('9.9.9');
    expect(out).toContain('2.6.0');
    expect(mockedWriteFile).toHaveBeenCalled();
  });

  it('says nothing when already up to date', async () => {
    fetchMock.mockResolvedValue(okResponse('2.6.0'));
    await notifyUpdate(PKG);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('says nothing when the registry returns an error status', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
    await notifyUpdate(PKG);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });

  it('uses a fresh cache without hitting the network', async () => {
    mockedReadFile.mockReturnValue(
      JSON.stringify({ lastCheck: Date.now(), latest: '9.9.9' }),
    );
    await notifyUpdate(PKG);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('9.9.9');
  });

  it('stays silent (and never throws) on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(notifyUpdate(PKG)).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each<[string, () => Promise<void>]>([
    ['--json', () => notifyUpdate(PKG, { json: true })],
    [
      'CI',
      () => {
        process.env.CI = 'true';
        return notifyUpdate(PKG);
      },
    ],
    [
      'NO_UPDATE_NOTIFIER',
      () => {
        process.env.NO_UPDATE_NOTIFIER = '1';
        return notifyUpdate(PKG);
      },
    ],
    [
      'non-TTY',
      () => {
        setTTY(undefined);
        return notifyUpdate(PKG);
      },
    ],
  ])('skips the check when %s', async (_label, run) => {
    await run();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
