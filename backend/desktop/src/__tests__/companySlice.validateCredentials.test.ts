import { validateCredentials, CREDENTIALS_REJECTED_MESSAGE } from '../store/slices/companySlice';
import { getMhClient } from '../services/api/MhClient';

jest.mock('../services/api/MhClient', () => ({
  getMhClient: jest.fn(),
}));

const mockedGetMhClient = getMhClient as jest.Mock;
const validate = jest.fn();

async function run(args: { isProduction?: boolean }) {
  const thunk = validateCredentials({
    companyId: 'c1',
    credentials: { user: '06141404941342', password: 'secret' },
    ...args,
  });
  return thunk(jest.fn(), () => ({}), undefined);
}

describe('validateCredentials thunk', () => {
  beforeEach(() => {
    validate.mockReset();
    mockedGetMhClient.mockReset().mockReturnValue({ validateCredentials: validate });
  });

  it("validates against the company's own MH environment", async () => {
    validate.mockResolvedValue({ valid: true, statusCode: 200 });
    await run({ isProduction: true });
    expect(mockedGetMhClient).toHaveBeenLastCalledWith(true);
    await run({ isProduction: false });
    expect(mockedGetMhClient).toHaveBeenLastCalledWith(false);
    // Unspecified → the test environment explicitly, never "whatever client exists".
    await run({});
    expect(mockedGetMhClient).toHaveBeenLastCalledWith(false);
  });

  it('fulfils when Hacienda accepts the credentials', async () => {
    validate.mockResolvedValue({ valid: true, statusCode: 200 });
    const action = await run({ isProduction: false });
    expect(action.type).toBe('companies/validateCredentials/fulfilled');
    expect(action.payload).toEqual({ companyId: 'c1', isValid: true });
  });

  it.each([401, 400, 403, 200])('reports HTTP %s from MH as "rejected"', async (statusCode) => {
    validate.mockResolvedValue({ valid: false, statusCode });
    const action = await run({ isProduction: false });
    expect(action.type).toBe('companies/validateCredentials/rejected');
    expect(action.payload).toEqual({ kind: 'rejected', message: CREDENTIALS_REJECTED_MESSAGE });
  });

  it.each([0, 500, 503])('reports HTTP %s as "unreachable", not as bad credentials', async (statusCode) => {
    validate.mockResolvedValue({ valid: false, statusCode });
    const action = await run({ isProduction: false });
    expect(action.payload).toMatchObject({ kind: 'unreachable' });
    expect((action.payload as { message: string }).message).toMatch(/No se pudo contactar a Hacienda/);
  });

  it('treats a thrown client error as "unreachable"', async () => {
    validate.mockRejectedValue(new Error('network down'));
    const action = await run({ isProduction: false });
    expect(action.payload).toMatchObject({ kind: 'unreachable' });
  });
});
