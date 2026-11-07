import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Free/Premium for desktop YouTube via Tools `/api/control/authorize` (`youtube_download`).
/// First download is free (anon device id). Later downloads require Auth0 access token.
class Entitlement {
  Entitlement({String? apiBase})
      : apiBase = (apiBase ??
                const String.fromEnvironment(
                  'API_BASE',
                  defaultValue: 'https://api.tools.ai-forall.org',
                ))
            .replaceAll(RegExp(r'/$'), '');

  final String apiBase;
  static const _deviceIdPref = 'youtube_device_id';
  static const _localFreeUsed = 'youtube_local_free_used';

  Future<String> deviceId() async {
    final prefs = await SharedPreferences.getInstance();
    var id = prefs.getString(_deviceIdPref);
    if (id == null || id.isEmpty) {
      id = 'dev_${DateTime.now().microsecondsSinceEpoch}_${Platform.localHostname.hashCode.toRadixString(16)}';
      await prefs.setString(_deviceIdPref, id);
    }
    return id;
  }

  Future<bool> localFreeUsed() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_localFreeUsed) ?? false;
  }

  Future<void> markLocalFreeUsed() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_localFreeUsed, true);
  }

  /// Returns null if allowed; otherwise an error message for the UI.
  Future<String?> assertMayDownload({String? accessToken}) async {
    final token = (accessToken ?? '').trim();
    final id = await deviceId();
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'X-Device-Id': id,
      if (token.isNotEmpty) 'Authorization': 'Bearer $token',
    };
    try {
      final uri = Uri.parse('$apiBase/api/control/authorize');
      final res = await http
          .post(
            uri,
            headers: headers,
            body: jsonEncode({'tool_id': 'youtube_download', 'action': 'run', 'commit': true}),
          )
          .timeout(const Duration(seconds: 12));
      if (res.statusCode >= 200 && res.statusCode < 300) {
        await markLocalFreeUsed();
        return null;
      }
      try {
        final body = jsonDecode(res.body);
        final detail = body is Map ? body['detail'] : null;
        if (detail is Map && detail['reason'] != null) {
          final reason = '${detail['reason']}';
          if (reason == 'upgrade_required' || reason == 'credits_exhausted') {
            return 'Further downloads need Premium (or credits). Sign in with Auth0.';
          }
          return 'Download blocked: $reason';
        }
        if (detail is String) return detail;
      } catch (_) {}
      if (res.statusCode == 401 || res.statusCode == 402 || res.statusCode == 403) {
        return 'Free first download used. Sign in with the same Auth0 account as Tools.';
      }
      return 'Download blocked (${res.statusCode}). Sign in and try again.';
    } catch (_) {
      if (!await localFreeUsed()) {
        await markLocalFreeUsed();
        return null;
      }
      return 'Cannot reach Tools API. Sign in when online, then try again.';
    }
  }
}
