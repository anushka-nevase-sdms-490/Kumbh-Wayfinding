import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const SetuStaffApp());
}

const Color ink = Color(0xFF1A2421);
const Color river = Color(0xFF1F6F6A);
const Color saffron = Color(0xFFC45C26);
const Color mist = Color(0xFFF3EDE3);

class SetuStaffApp extends StatelessWidget {
  const SetuStaffApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Setu Staff',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: river),
        scaffoldBackgroundColor: mist,
      ),
      home: const StaffHome(),
    );
  }
}

class PendingNode {
  final String code;
  final String name;
  final double lat;
  final double lon;
  final String nodeType;
  final String icon;

  PendingNode({
    required this.code,
    required this.name,
    required this.lat,
    required this.lon,
    required this.nodeType,
    required this.icon,
  });

  Map<String, dynamic> toJson() => {
        'code': code,
        'name': name,
        'lat': lat,
        'lon': lon,
        'node_type': nodeType,
        'icon': icon,
      };

  factory PendingNode.fromJson(Map<String, dynamic> j) => PendingNode(
        code: j['code'] as String,
        name: j['name'] as String,
        lat: (j['lat'] as num).toDouble(),
        lon: (j['lon'] as num).toDouble(),
        nodeType: j['node_type'] as String? ?? 'junction',
        icon: j['icon'] as String? ?? 'junction',
      );
}

class StaffHome extends StatefulWidget {
  const StaffHome({super.key});

  @override
  State<StaffHome> createState() => _StaffHomeState();
}

class _StaffHomeState extends State<StaffHome> {
  final _nameCtrl = TextEditingController();
  final _apiCtrl = TextEditingController(text: 'http://10.0.2.2:8000');
  String _type = 'junction';
  String? _lastCode;
  double? _lat;
  double? _lon;
  int _samples = 0;
  bool _surveying = false;
  String _status = 'Ready to survey';
  List<PendingNode> _queue = [];

  static const _types = {
    'junction': 'Junction',
    'ghat': 'Ghat',
    'medical': 'Medical',
    'toilet': 'Toilet',
    'parking': 'Parking',
    'lost_found': 'Lost & Found',
    'transport': 'Transport',
    'help': 'Help desk',
  };

  @override
  void initState() {
    super.initState();
    _loadQueue();
  }

  Future<void> _loadQueue() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('setu_staff_queue');
    if (raw == null) return;
    final list = (jsonDecode(raw) as List)
        .map((e) => PendingNode.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
    setState(() => _queue = list);
  }

  Future<void> _saveQueue() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      'setu_staff_queue',
      jsonEncode(_queue.map((e) => e.toJson()).toList()),
    );
  }

  Future<void> _surveyGps() async {
    setState(() {
      _surveying = true;
      _status = 'Averaging GPS (rejecting outliers)…';
      _samples = 0;
    });

    final enabled = await Geolocator.isLocationServiceEnabled();
    if (!enabled) {
      setState(() {
        _surveying = false;
        _status = 'Enable location services';
      });
      return;
    }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
    }
    if (perm == LocationPermission.denied ||
        perm == LocationPermission.deniedForever) {
      setState(() {
        _surveying = false;
        _status = 'Location permission denied';
      });
      return;
    }

    final samples = <Position>[];
    final end = DateTime.now().add(const Duration(seconds: 25));
    while (DateTime.now().isBefore(end) && samples.length < 40) {
      try {
        final p = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.best,
          ),
        );
        samples.add(p);
        setState(() => _samples = samples.length);
      } catch (_) {
        break;
      }
      await Future<void>.delayed(const Duration(milliseconds: 500));
    }

    if (samples.length < 3) {
      setState(() {
        _surveying = false;
        _status = 'Not enough GPS samples (${samples.length})';
      });
      return;
    }

    // Outlier rejection: drop samples farther than 1.5× median residual.
    final medLat = _median(samples.map((s) => s.latitude).toList());
    final medLon = _median(samples.map((s) => s.longitude).toList());
    final residuals = samples
        .map(
          (s) => Geolocator.distanceBetween(
            medLat,
            medLon,
            s.latitude,
            s.longitude,
          ),
        )
        .toList();
    final medRes = _median(residuals);
    final kept = <Position>[];
    for (var i = 0; i < samples.length; i++) {
      if (residuals[i] <= medRes * 1.5 + 2.0) kept.add(samples[i]);
    }
    final use = kept.isEmpty ? samples : kept;
    final lat = use.map((s) => s.latitude).reduce((a, b) => a + b) / use.length;
    final lon = use.map((s) => s.longitude).reduce((a, b) => a + b) / use.length;

    setState(() {
      _lat = lat;
      _lon = lon;
      _surveying = false;
      _status =
          'Surveyed ±~${medRes.toStringAsFixed(1)} m from ${use.length} fixes';
    });
  }

  double _median(List<double> xs) {
    final s = [...xs]..sort();
    final m = s.length ~/ 2;
    return s.length.isOdd ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  Future<void> _saveBoard() async {
    if (_lat == null || _lon == null || _nameCtrl.text.trim().isEmpty) {
      setState(() => _status = 'Survey GPS and enter a name first');
      return;
    }
    final code =
        'SETU-${DateTime.now().millisecondsSinceEpoch.toRadixString(36).toUpperCase().substring(2, 7)}';
    final node = PendingNode(
      code: code,
      name: _nameCtrl.text.trim(),
      lat: _lat!,
      lon: _lon!,
      nodeType: _type,
      icon: _type,
    );
    setState(() {
      _queue = [..._queue, node];
      _lastCode = code;
      _status = 'Queued $code (offline OK)';
    });
    await _saveQueue();
  }

  Future<void> _sync() async {
    if (_queue.isEmpty) {
      setState(() => _status = 'Queue empty');
      return;
    }
    final base = _apiCtrl.text.trim().replaceAll(RegExp(r'/$'), '');
    final body = {
      'client_batch_id': const Uuid().v4(),
      'nodes': _queue.map((e) => e.toJson()).toList(),
      'edges': <Map<String, dynamic>>[],
    };
    try {
      final res = await http
          .post(
            Uri.parse('$base/api/sync'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 8));
      if (res.statusCode >= 200 && res.statusCode < 300) {
        setState(() {
          _queue = [];
          _status = 'Synced OK';
        });
        await _saveQueue();
        // Rebuild pack on server
        await http.post(Uri.parse('$base/api/pack/build'));
      } else {
        setState(() => _status = 'Sync failed: ${res.statusCode}');
      }
    } catch (e) {
      setState(() => _status = 'Offline — kept in queue ($e)');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Setu Staff'),
        backgroundColor: Colors.transparent,
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          TextField(
            controller: _apiCtrl,
            decoration: const InputDecoration(
              labelText: 'API base URL',
              border: OutlineInputBorder(),
              helperText: 'Emulator: http://10.0.2.2:8000 · Phone: http://<PC-IP>:8000',
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _nameCtrl,
            decoration: const InputDecoration(
              labelText: 'Place name',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _type,
            items: _types.entries
                .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
                .toList(),
            onChanged: (v) => setState(() => _type = v ?? 'junction'),
            decoration: const InputDecoration(
              labelText: 'Type',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _surveying ? null : _surveyGps,
            icon: const Icon(Icons.gps_fixed),
            label: Text(_surveying ? 'Surveying… ($_samples)' : 'Survey GPS (25s)'),
            style: FilledButton.styleFrom(
              backgroundColor: river,
              minimumSize: const Size.fromHeight(52),
            ),
          ),
          if (_lat != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                '${_lat!.toStringAsFixed(6)}, ${_lon!.toStringAsFixed(6)}',
                style: const TextStyle(fontFamily: 'monospace'),
              ),
            ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _saveBoard,
            icon: const Icon(Icons.qr_code_2),
            label: const Text('Generate & queue QR'),
            style: FilledButton.styleFrom(
              backgroundColor: saffron,
              minimumSize: const Size.fromHeight(52),
            ),
          ),
          if (_lastCode != null) ...[
            const SizedBox(height: 20),
            Center(
              child: QrImageView(
                data: _lastCode!,
                size: 200,
                backgroundColor: Colors.white,
              ),
            ),
            const SizedBox(height: 8),
            Center(
              child: Text(
                _lastCode!,
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 18,
                  letterSpacing: 1,
                ),
              ),
            ),
          ],
          const SizedBox(height: 20),
          Text('Offline queue: ${_queue.length}', style: const TextStyle(color: ink)),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _sync,
            icon: const Icon(Icons.cloud_upload_outlined),
            label: const Text('Sync when online'),
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          ),
          const SizedBox(height: 12),
          Text(_status, style: TextStyle(color: ink.withValues(alpha: 0.65))),
        ],
      ),
    );
  }
}
