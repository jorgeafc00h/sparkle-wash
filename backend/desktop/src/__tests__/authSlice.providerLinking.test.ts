import authReducer, { googleSignIn } from '../store/slices/authSlice';

describe('authSlice provider linking', () => {
  it('stores requiresLinking state without authenticating the Google account', () => {
    const state = authReducer(undefined, googleSignIn.fulfilled({
      authenticated: false,
      requiresLinking: true,
      providerLinking: {
        required: true,
        provider: 'google',
        email: 'google@example.com',
        message: 'Vincula Google desde una cuenta existente.',
      },
    }, 'request-id'));

    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.providerLinking?.provider).toBe('google');
    expect(state.providerLinking?.message).toBe('Vincula Google desde una cuenta existente.');
    expect(state.providerLinking?.message.toLowerCase()).not.toContain(['join', 'company'].join(' '));
  });
});
