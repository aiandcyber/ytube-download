import 'dart:io';

import 'package:flutter/material.dart';

import 'downloader.dart';
import 'entitlement.dart';
import 'ffmpeg.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const YtubeApp());
}

class YtubeApp extends StatelessWidget {
  const YtubeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'YouTube Download',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFE53935)),
        useMaterial3: true,
      ),
      home: const DownloadPage(),
    );
  }
}

class DownloadPage extends StatefulWidget {
  const DownloadPage({super.key});

  @override
  State<DownloadPage> createState() => _DownloadPageState();
}

class _DownloadPageState extends State<DownloadPage> {
  final _url = TextEditingController();
  final _key = TextEditingController();
  final _dl = YtDownloader();
  final _entitlement = Entitlement();
  bool _audio = false;
  String _quality = '720';
  String _title = '';
  String _sizeHint = 'Paste a YouTube URL, then choose quality to see expected file size.';
  String _error = '';
  String _ok = '';
  String _lastFile = '';
  bool _busy = false;
  double _progress = 0;
  double _ffmpegProgress = 0;
  String _ffmpegError = '';
  List<String> get _qualityIds =>
      _audio ? YtDownloader.audioQualities : YtDownloader.videoQualities;

  @override
  void initState() {
    super.initState();
    Ffmpeg.status.addListener(_onFfmpeg);
    _setupFfmpeg();
    _loadEntitlement();
  }

  Future<void> _loadEntitlement() async {
    final key = await _entitlement.deviceKey();
    if (!mounted) return;
    setState(() {
      if (key != null && key.isNotEmpty) _key.text = key;
    });
  }

  void _onFfmpeg() {
    if (mounted) setState(() {});
  }

  Future<void> _setupFfmpeg() async {
    try {
      await Ffmpeg.ensure(onProgress: (p) {
        if (mounted) setState(() => _ffmpegProgress = p);
      });
    } catch (e) {
      if (mounted) {
        setState(() => _ffmpegError = e.toString().replaceFirst('Exception: ', ''));
      }
    }
  }

  @override
  void dispose() {
    Ffmpeg.status.removeListener(_onFfmpeg);
    _url.dispose();
    _key.dispose();
    _dl.close();
    super.dispose();
  }

  String _qualityLabel(String id) {
    if (_audio) return '$id kbps';
    if (id == 'best') return 'Best available';
    return '${id}p';
  }

  Future<void> _probe() async {
    final url = _url.text.trim();
    if (url.isEmpty || !RegExp(r'youtube\.com|youtu\.be|youtube-nocookie\.com', caseSensitive: false).hasMatch(url)) {
      setState(() {
        _title = '';
        _sizeHint = 'Paste a YouTube URL, then choose quality to see expected file size.';
      });
      return;
    }
    setState(() {
      _error = '';
      _sizeHint = 'Checking expected file size…';
    });
    try {
      final probe = await _dl.probe(url, audio: _audio);
      final match = probe.qualities.where((q) => q.id == _quality).toList();
      String hint = 'Expected file size: unknown until download.';
      if (match.isNotEmpty && match.first.bytes != null) {
        hint = 'Expected file size: ${_fmt(match.first.bytes!)}';
      }
      if (!mounted) return;
      setState(() {
        _title = probe.title;
        _sizeHint = hint;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _title = '';
        _sizeHint = 'Expected file size is unavailable until YouTube allows this video.';
        _error = 'YouTube is blocking this video, or the link is invalid.';
      });
    }
  }

  Future<void> _run() async {
    if (Platform.isWindows && Ffmpeg.status.value != FfmpegStatus.ready) return;
    final url = _url.text.trim();
    if (url.isEmpty) return;
    setState(() {
      _busy = true;
      _error = '';
      _ok = '';
      _lastFile = '';
      _progress = 0;
    });
    try {
      final typedKey = _key.text.trim();
      if (typedKey.isNotEmpty) await _entitlement.saveDeviceKey(typedKey);
      final blocked = await _entitlement.assertMayDownload();
      if (blocked != null) {
        if (!mounted) return;
        setState(() => _error = blocked);
        return;
      }
      final result = await _dl.download(
        url: url,
        audio: _audio,
        quality: _quality,
        onProgress: (p) {
          if (mounted) setState(() => _progress = p);
        },
      );
      if (!mounted) return;
      setState(() {
        _ok = '${result.message}\n${result.path}';
        _lastFile = result.path;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _play() async {
    if (_lastFile.isEmpty) return;
    try {
      await Ffmpeg.play(_lastFile);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    }
  }

  String _fmt(int bytes) {
    if (bytes >= 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    if (bytes >= 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '$bytes B';
  }

  @override
  Widget build(BuildContext context) {
    final ffmpegBusy = Platform.isWindows && Ffmpeg.status.value != FfmpegStatus.ready;
    return Scaffold(
      appBar: AppBar(title: const Text('YouTube Download')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: false, label: Text('YouTube to MP4')),
              ButtonSegment(value: true, label: Text('YouTube to MP3')),
            ],
            selected: {_audio},
            onSelectionChanged: (s) {
              setState(() {
                _audio = s.first;
                _quality = _audio ? '192' : '720';
                _ok = '';
                _lastFile = '';
                _error = '';
              });
              _probe();
            },
          ),
          const SizedBox(height: 20),
          Text(_audio ? 'Download audio only from a YouTube video as MP3.' : 'Download a YouTube video as MP4.'),
          const SizedBox(height: 8),
          Text(
            'Windows / Mac desktop only. First download is free; later downloads need a Profile activation key (or Tools login). Login at start is optional.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          const SizedBox(height: 12),
          TextField(
            controller: _key,
            decoration: const InputDecoration(
              labelText: 'Activation key (optional at start)',
              hintText: 'From Tools Profile → Desktop YouTube activation key',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _url,
            decoration: const InputDecoration(
              labelText: 'YouTube URL',
              hintText: 'https://www.youtube.com/watch?v=…',
              border: OutlineInputBorder(),
            ),
            onChanged: (_) {
              _ok = '';
              _lastFile = '';
              _error = '';
              Future.delayed(const Duration(milliseconds: 500), _probe);
            },
          ),
          if (_title.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_title)),
          const SizedBox(height: 16),
          InputDecorator(
            decoration: const InputDecoration(labelText: 'Quality', border: OutlineInputBorder()),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                isExpanded: true,
                value: _qualityIds.contains(_quality) ? _quality : _qualityIds.first,
                items: _qualityIds
                    .map((id) => DropdownMenuItem(value: id, child: Text(_qualityLabel(id))))
                    .toList(),
                onChanged: (v) {
                  if (v == null) return;
                  setState(() => _quality = v);
                  _probe();
                },
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(_sizeHint, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 20),
          if (Platform.isWindows && Ffmpeg.status.value == FfmpegStatus.downloading) ...[
            const Text('Downloading ffmpeg, ffplay and ffprobe (required, about 110 MB). Once only.'),
            const SizedBox(height: 8),
            LinearProgressIndicator(value: _ffmpegProgress > 0 ? _ffmpegProgress : null),
            const SizedBox(height: 16),
          ],
          if (_ffmpegError.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(_ffmpegError, style: const TextStyle(color: Color(0xFFB91C1C))),
            ),
          FilledButton(
            onPressed: (_busy || ffmpegBusy) ? null : _run,
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFE53935)),
            child: Text(_busy ? 'Working…' : 'Run'),
          ),
          if (_busy) Padding(
            padding: const EdgeInsets.only(top: 12),
            child: LinearProgressIndicator(value: _progress > 0 ? _progress : null),
          ),
          if (_error.isNotEmpty) Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(_error, style: const TextStyle(color: Color(0xFFB91C1C))),
          ),
          if (_ok.isNotEmpty) Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(_ok, style: const TextStyle(color: Color(0xFF047857))),
          ),
          if (_lastFile.isNotEmpty && !_busy)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: OutlinedButton(
                onPressed: _play,
                child: const Text('Play'),
              ),
            ),
        ],
      ),
    );
  }
}
