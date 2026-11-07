/// Auth0 Native/desktop (PKCE). Same tenant/audience as Tools.
/// Override with --dart-define=AUTH0_DOMAIN=... etc.
class Auth0Config {
  static const domain = String.fromEnvironment(
    'AUTH0_DOMAIN',
    defaultValue: 'dev-tvq4tbikhbet8orb.us.auth0.com',
  );
  static const clientId = String.fromEnvironment(
    'AUTH0_CLIENT_ID',
    defaultValue: 'YX6isR6f4VdTViqA7tcVxlKUeWyk4ITY',
  );
  static const audience = String.fromEnvironment(
    'AUTH0_AUDIENCE',
    defaultValue: 'https://api.ai-forall.org',
  );
  static const redirectUri = String.fromEnvironment(
    'AUTH0_REDIRECT_URI',
    defaultValue: 'http://127.0.0.1:54821/callback',
  );

  static bool get configured => domain.isNotEmpty && clientId.isNotEmpty && audience.isNotEmpty;
}
