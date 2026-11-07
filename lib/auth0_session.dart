import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import 'auth0_config.dart';

/// Desktop Auth0 login (Authorization Code + PKCE via localhost redirect).
class Auth0Session {
  static const _tokenPref = 'auth0_access_token';
  static const _emailPref = 'auth0_email';

  String? accessToken;
  String? email;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    accessToken = prefs.getString(_tokenPref);
    email = prefs.getString(_emailPref);
  }

  Future<void> _persist() async {
    final prefs = await SharedPreferences.getInstance();
    if (accessToken == null || accessToken!.isEmpty) {
      await prefs.remove(_tokenPref);
      await prefs.remove(_emailPref);
    } else {
      await prefs.setString(_tokenPref, accessToken!);
      if (email != null) await prefs.setString(_emailPref, email!);
    }
  }

  Future<void> signOut() async {
    accessToken = null;
    email = null;
    await _persist();
  }

  bool get isSignedIn => (accessToken ?? '').isNotEmpty;

  Future<void> signIn() async {
    if (!Auth0Config.configured) {
      throw Exception('Auth0 is not configured');
    }
    final verifier = _randomUrlSafe(64);
    final challenge = base64UrlEncode(sha256.convert(utf8.encode(verifier)).bytes).replaceAll('=', '');
    final state = _randomUrlSafe(24);

    final authUri = Uri.https(Auth0Config.domain, '/authorize', {
      'response_type': 'code',
      'client_id': Auth0Config.clientId,
      'redirect_uri': Auth0Config.redirectUri,
      'scope': 'openid profile email offline_access',
      'audience': Auth0Config.audience,
      'state': state,
      'code_challenge': challenge,
      'code_challenge_method': 'S256',
    });

    final redirect = Uri.parse(Auth0Config.redirectUri);
    final server = await HttpServer.bind(redirect.host, redirect.port);
    try {
      if (!await launchUrl(authUri, mode: LaunchMode.externalApplication)) {
        throw Exception('Could not open the browser for Sign in');
      }
      final request = await server.first.timeout(const Duration(minutes: 3));
      final params = request.uri.queryParameters;
      request.response
        ..statusCode = 200
        ..headers.contentType = ContentType.html
        ..write('<html><body><h2>Signed in. You can close this window.</h2></body></html>');
      await request.response.close();

      if (params['error'] != null) {
        throw Exception(params['error_description'] ?? params['error']);
      }
      if (params['state'] != state) {
        throw Exception('Sign-in state mismatch');
      }
      final code = params['code'];
      if (code == null || code.isEmpty) {
        throw Exception('No authorization code returned');
      }

      final tokenRes = await http.post(
        Uri.https(Auth0Config.domain, '/oauth/token'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'grant_type': 'authorization_code',
          'client_id': Auth0Config.clientId,
          'code_verifier': verifier,
          'code': code,
          'redirect_uri': Auth0Config.redirectUri,
        }),
      );
      if (tokenRes.statusCode < 200 || tokenRes.statusCode >= 300) {
        throw Exception('Token exchange failed (${tokenRes.statusCode})');
      }
      final body = jsonDecode(tokenRes.body) as Map<String, dynamic>;
      final token = (body['access_token'] as String?)?.trim() ?? '';
      if (token.isEmpty) throw Exception('No access token');
      accessToken = token;
      email = await _fetchEmail(token);
      await _persist();
    } finally {
      await server.close(force: true);
    }
  }

  Future<String?> _fetchEmail(String token) async {
    try {
      final res = await http.get(
        Uri.https(Auth0Config.domain, '/userinfo'),
        headers: {'Authorization': 'Bearer $token'},
      );
      if (res.statusCode >= 200 && res.statusCode < 300) {
        final body = jsonDecode(res.body) as Map<String, dynamic>;
        return (body['email'] as String?) ?? (body['name'] as String?);
      }
    } catch (_) {}
    return null;
  }

  static String _randomUrlSafe(int length) {
    final rng = Random.secure();
    final bytes = List<int>.generate(length, (_) => rng.nextInt(256));
    return base64UrlEncode(bytes).replaceAll('=', '');
  }
}
