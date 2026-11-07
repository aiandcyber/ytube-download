import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:youtube_explode_dart/youtube_explode_dart.dart';

import 'ffmpeg.dart';

class ProbeResult {
  ProbeResult({
    required this.videoId,
    required this.title,
    required this.duration,
    required this.qualities,
  });

  final VideoId videoId;
  final String title;
  final Duration? duration;
  final List<QualityOption> qualities;
}

class QualityOption {
  QualityOption({
    required this.id,
    required this.label,
    this.bytes,
  });

  final String id;
  final String label;
  final int? bytes;
}

class DownloadResult {
  DownloadResult(this.path, this.message);
  final String path;
  final String message;
}

class YtDownloader {
  YtDownloader();

  final YoutubeExplode _yt = YoutubeExplode();

  static const videoQualities = ['360', '480', '720', '1080', 'best'];
  static const audioQualities = ['64', '128', '192', '320'];

  Future<ProbeResult> probe(String url, {required bool audio}) async {
    final video = await _yt.videos.get(url);
    final manifest = await _yt.videos.streams.getManifest(video.id);
    final duration = video.duration;
    final qualities = <QualityOption>[];
    if (audio) {
      for (final id in audioQualities) {
        final kbps = int.parse(id);
        final bytes = duration == null ? null : (duration.inSeconds * kbps * 1000 / 8).round();
        qualities.add(QualityOption(id: id, label: '$id kbps', bytes: bytes));
      }
    } else {
      for (final id in videoQualities) {
        final stream = _pickVideo(manifest, id);
        qualities.add(QualityOption(
          id: id,
          label: id == 'best' ? 'Best available' : '${id}p',
          bytes: stream?.size.totalBytes,
        ));
      }
    }
    return ProbeResult(
      videoId: video.id,
      title: video.title,
      duration: duration,
      qualities: qualities,
    );
  }

  Future<DownloadResult> download({
    required String url,
    required bool audio,
    required String quality,
    required void Function(double progress) onProgress,
  }) async {
    final video = await _yt.videos.get(url);
    final manifest = await _yt.videos.streams.getManifest(video.id);
    final dir = await _outputDir();
    final base = _safeName(video.title);
    if (audio) {
      return _downloadAudio(manifest, dir, base, quality, onProgress);
    }
    return _downloadVideo(manifest, dir, base, quality, onProgress);
  }

  Future<DownloadResult> _downloadVideo(
    StreamManifest manifest,
    Directory dir,
    String base,
    String quality,
    void Function(double progress) onProgress,
  ) async {
    final muxed = _pickMuxed(manifest, quality);
    if (muxed != null) {
      final dest = File(p.join(dir.path, '$base.mp4'));
      await _saveStream(muxed, dest, onProgress);
      return DownloadResult(dest.path, 'Downloaded YouTube video');
    }
    final video = _pickVideoOnly(manifest, quality);
    final audio = manifest.audioOnly.withHighestBitrate();
    if (video == null) {
      throw Exception('No video stream for that quality.');
    }
    final tmpV = File(p.join(dir.path, '$base.video.${video.container.name}'));
    final tmpA = File(p.join(dir.path, '$base.audio.${audio.container.name}'));
    final dest = File(p.join(dir.path, '$base.mp4'));
    await _saveStream(video, tmpV, (p0) => onProgress(p0 * 0.6));
    await _saveStream(audio, tmpA, (p0) => onProgress(0.6 + p0 * 0.3));
    await Ffmpeg.run([
      '-y',
      '-i',
      tmpV.path,
      '-i',
      tmpA.path,
      '-c',
      'copy',
      dest.path,
    ]);
    await tmpV.delete().catchError((_) => tmpV);
    await tmpA.delete().catchError((_) => tmpA);
    if (!dest.existsSync()) {
      throw Exception('Could not merge video and audio.');
    }
    onProgress(1);
    return DownloadResult(dest.path, 'Downloaded YouTube video');
  }

  Future<DownloadResult> _downloadAudio(
    StreamManifest manifest,
    Directory dir,
    String base,
    String quality,
    void Function(double progress) onProgress,
  ) async {
    final audio = manifest.audioOnly.withHighestBitrate();
    final raw = File(p.join(dir.path, '$base.audio.${audio.container.name}'));
    await _saveStream(audio, raw, (p0) => onProgress(p0 * 0.85));
    final dest = File(p.join(dir.path, '$base.mp3'));
    final kbps = audioQualities.contains(quality) ? quality : '192';
    await Ffmpeg.run([
      '-y',
      '-i',
      raw.path,
      '-vn',
      '-acodec',
      'libmp3lame',
      '-b:a',
      '${kbps}k',
      dest.path,
    ]);
    await raw.delete().catchError((_) => raw);
    if (!dest.existsSync()) {
      throw Exception('Could not create MP3.');
    }
    onProgress(1);
    return DownloadResult(dest.path, 'Downloaded YouTube audio');
  }

  VideoStreamInfo? _pickVideo(StreamManifest manifest, String quality) {
    return _pickMuxed(manifest, quality) ?? _pickVideoOnly(manifest, quality);
  }

  MuxedStreamInfo? _pickMuxed(StreamManifest manifest, String quality) {
    final list = manifest.muxed.toList();
    if (list.isEmpty) return null;
    if (quality == 'best') {
      list.sort((a, b) => b.videoResolution.height.compareTo(a.videoResolution.height));
      return list.first;
    }
    final maxH = int.tryParse(quality) ?? 720;
    final under = list.where((s) => s.videoResolution.height <= maxH).toList();
    if (under.isEmpty) {
      list.sort((a, b) => a.videoResolution.height.compareTo(b.videoResolution.height));
      return list.first;
    }
    under.sort((a, b) => b.videoResolution.height.compareTo(a.videoResolution.height));
    return under.first;
  }

  VideoOnlyStreamInfo? _pickVideoOnly(StreamManifest manifest, String quality) {
    final list = manifest.videoOnly.toList();
    if (list.isEmpty) return null;
    if (quality == 'best') {
      list.sort((a, b) => b.videoResolution.height.compareTo(a.videoResolution.height));
      return list.first;
    }
    final maxH = int.tryParse(quality) ?? 720;
    final under = list.where((s) => s.videoResolution.height <= maxH).toList();
    if (under.isEmpty) return null;
    under.sort((a, b) => b.videoResolution.height.compareTo(a.videoResolution.height));
    return under.first;
  }

  Future<void> _saveStream(
    StreamInfo info,
    File dest,
    void Function(double progress) onProgress,
  ) async {
    final total = info.size.totalBytes;
    var received = 0;
    final sink = dest.openWrite();
    try {
      await for (final chunk in _yt.videos.streams.get(info)) {
        sink.add(chunk);
        received += chunk.length;
        if (total > 0) onProgress((received / total).clamp(0, 1));
      }
    } finally {
      await sink.close();
    }
  }

  Future<Directory> _outputDir() async {
    Directory? dir = await getDownloadsDirectory();
    dir ??= await getApplicationDocumentsDirectory();
    if (!dir.existsSync()) dir.createSync(recursive: true);
    return dir;
  }

  String _safeName(String title) {
    final cleaned = title.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_').trim();
    if (cleaned.isEmpty) return 'youtube';
    return cleaned.length > 80 ? cleaned.substring(0, 80) : cleaned;
  }

  void close() => _yt.close();
}
