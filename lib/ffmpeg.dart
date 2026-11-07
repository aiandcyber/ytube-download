import 'dart:io';

import 'package:archive/archive.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Windows: download pinned ffmpeg.exe, ffplay.exe, ffprobe.exe on first launch.
/// Android: ffmpeg encode/mux is inside the APK. ffplay is a desktop SDL player
/// and is not in the Android FFmpegKit AAR; playback uses the system player.
class Ffmpeg {
  Ffmpeg._();

  static const _channel = MethodChannel('org.aiforall.ytube_download/ffmpeg');

  /// Gyan essentials 9.0.2 zip. SHA-256 from gyan.dev packages listing.
  static const windowsZipUrl =
      'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip';
  static const windowsZipSha256 =
      '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba';

  static final ValueNotifier<FfmpegStatus> status = ValueNotifier(FfmpegStatus.unknown);

  static Future<void> ensure({void Function(double progress)? onProgress}) async {
    if (Platform.isAndroid) {
      status.value = FfmpegStatus.ready;
      return;
    }
    if (Platform.isWindows) {
      await _ensureWindows(onProgress: onProgress);
      return;
    }
    status.value = FfmpegStatus.ready;
  }

  static Future<void> run(List<String> args) async {
    if (Platform.isAndroid) {
      final code = await _channel.invokeMethod<int>('run', {'args': args});
      if (code != 0) {
        throw Exception('ffmpeg failed (code $code).');
      }
      return;
    }
    if (Platform.isWindows) {
      final exe = await _windowsBin('ffmpeg.exe');
      if (!exe.existsSync()) {
        throw Exception('ffmpeg is not installed yet.');
      }
      final r = await Process.run(exe.path, args);
      if (r.exitCode != 0) {
        final err = (r.stderr.toString().trim().isEmpty) ? r.stdout.toString() : r.stderr.toString();
        throw Exception(err.isEmpty ? 'ffmpeg failed.' : err);
      }
      return;
    }
    final r = await Process.run('ffmpeg', args);
    if (r.exitCode != 0) {
      throw Exception('ffmpeg failed.');
    }
  }

  static const _windowsBins = ['ffmpeg.exe', 'ffplay.exe', 'ffprobe.exe'];

  static Future<File> _windowsBin(String name) async {
    final dir = await getApplicationSupportDirectory();
    return File(p.join(dir.path, 'ffmpeg', name));
  }

  static Future<void> play(String filePath) async {
    if (Platform.isWindows) {
      final play = await _windowsBin('ffplay.exe');
      if (!play.existsSync()) {
        throw Exception('ffplay is not installed yet.');
      }
      await Process.start(
        play.path,
        ['-autoexit', filePath],
        mode: ProcessStartMode.detached,
      );
      return;
    }
    if (Platform.isAndroid) {
      await _channel.invokeMethod<void>('play', {'path': filePath});
      return;
    }
    await Process.start('ffplay', ['-autoexit', filePath], mode: ProcessStartMode.detached);
  }

  static Future<void> _ensureWindows({void Function(double progress)? onProgress}) async {
    final bins = <String, File>{};
    for (final name in _windowsBins) {
      bins[name] = await _windowsBin(name);
    }
    if (bins.values.every((f) => f.existsSync())) {
      status.value = FfmpegStatus.ready;
      return;
    }
    status.value = FfmpegStatus.downloading;
    onProgress?.call(0);
    final dir = Directory(p.dirname(bins['ffmpeg.exe']!.path));
    dir.createSync(recursive: true);
    final zipFile = File(p.join(dir.path, 'ffmpeg-essentials.zip'));
    try {
      await _download(windowsZipUrl, zipFile, onProgress);
      final zipBytes = zipFile.readAsBytesSync();
      if (sha256.convert(zipBytes).toString() != windowsZipSha256) {
        throw Exception('ffmpeg download was corrupted (hash mismatch).');
      }
      final archive = ZipDecoder().decodeBytes(zipBytes);
      ArchiveFile? license;
      final found = <String, ArchiveFile>{};
      for (final f in archive) {
        if (!f.isFile) continue;
        final name = f.name.replaceAll('\\', '/');
        final lower = name.toLowerCase();
        for (final bin in _windowsBins) {
          if (lower.endsWith('/bin/$bin') || lower.endsWith('/$bin')) {
            found[bin] = f;
          }
        }
        if (lower.endsWith('/license') || lower.endsWith('copying.gpl') || lower.endsWith('copying.txt')) {
          license ??= f;
        }
      }
      for (final bin in _windowsBins) {
        final file = found[bin];
        if (file == null) {
          throw Exception('$bin was not in the download.');
        }
        bins[bin]!.writeAsBytesSync(file.content as List<int>, flush: true);
      }
      if (license != null) {
        File(p.join(dir.path, 'LICENSE')).writeAsBytesSync(license.content as List<int>);
      }
      File(p.join(dir.path, 'SOURCE.txt')).writeAsStringSync(
        'FFmpeg 9.0.2 essentials (GPLv3): ffmpeg, ffplay, ffprobe\n$windowsZipUrl\n',
      );
      status.value = FfmpegStatus.ready;
    } catch (e) {
      status.value = FfmpegStatus.failed;
      rethrow;
    } finally {
      if (zipFile.existsSync()) {
        zipFile.deleteSync();
      }
    }
  }

  static Future<void> _download(
    String url,
    File dest,
    void Function(double progress)? onProgress,
  ) async {
    final client = HttpClient();
    try {
      final req = await client.getUrl(Uri.parse(url));
      final res = await req.close();
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw Exception('Could not download ffmpeg (${res.statusCode}).');
      }
      final total = res.contentLength;
      var got = 0;
      final sink = dest.openWrite();
      await for (final chunk in res) {
        sink.add(chunk);
        got += chunk.length;
        if (total > 0) onProgress?.call((got / total).clamp(0, 1));
      }
      await sink.close();
    } finally {
      client.close();
    }
  }
}

enum FfmpegStatus { unknown, downloading, ready, failed }
