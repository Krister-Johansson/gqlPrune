import updateNotifier from 'simple-update-notifier';
import { notifyUpdate } from '../src/utils/updateNotifier';

jest.mock('simple-update-notifier', () => ({
  __esModule: true,
  default: jest.fn(() => Promise.resolve()),
}));

const mockedNotifier = updateNotifier as jest.Mock;
const PKG = { name: 'gqlprune', version: '2.6.0' };

describe('notifyUpdate', () => {
  const realEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...realEnv };
    delete process.env.CI;
    delete process.env.NO_UPDATE_NOTIFIER;
  });

  afterAll(() => {
    process.env = realEnv;
  });

  it('checks for updates when interactive and not opted out', async () => {
    await notifyUpdate(PKG);
    expect(mockedNotifier).toHaveBeenCalledWith({ pkg: PKG });
  });

  it('skips in --json mode (keeps machine output clean)', async () => {
    await notifyUpdate(PKG, { json: true });
    expect(mockedNotifier).not.toHaveBeenCalled();
  });

  it('skips in CI', async () => {
    process.env.CI = 'true';
    await notifyUpdate(PKG);
    expect(mockedNotifier).not.toHaveBeenCalled();
  });

  it('skips when NO_UPDATE_NOTIFIER is set', async () => {
    process.env.NO_UPDATE_NOTIFIER = '1';
    await notifyUpdate(PKG);
    expect(mockedNotifier).not.toHaveBeenCalled();
  });
});
