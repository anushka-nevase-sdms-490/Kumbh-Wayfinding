import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:sensors_plus/sensors_plus.dart';

/// Live snapshot of the pedestrian dead-reckoning engine.
class PdrState {
  /// Estimated heading in degrees clockwise from magnetic/true north [0, 360).
  /// Primary source: gyroscope integration. Magnetometer only lightly corrects.
  final double headingDeg;

  final double lat;
  final double lon;
  final int stepCount;
  final double strideM;
  final double gyroRateZ; // rad/s — raw yaw rate for debug UI
  final double magFieldUt; // µT magnitude
  final bool magDisturbed;
  final bool sensorsLive;
  final String sourceNote;

  const PdrState({
    required this.headingDeg,
    required this.lat,
    required this.lon,
    required this.stepCount,
    required this.strideM,
    required this.gyroRateZ,
    required this.magFieldUt,
    required this.magDisturbed,
    required this.sensorsLive,
    required this.sourceNote,
  });

  PdrState copyWith({
    double? headingDeg,
    double? lat,
    double? lon,
    int? stepCount,
    double? strideM,
    double? gyroRateZ,
    double? magFieldUt,
    bool? magDisturbed,
    bool? sensorsLive,
    String? sourceNote,
  }) {
    return PdrState(
      headingDeg: headingDeg ?? this.headingDeg,
      lat: lat ?? this.lat,
      lon: lon ?? this.lon,
      stepCount: stepCount ?? this.stepCount,
      strideM: strideM ?? this.strideM,
      gyroRateZ: gyroRateZ ?? this.gyroRateZ,
      magFieldUt: magFieldUt ?? this.magFieldUt,
      magDisturbed: magDisturbed ?? this.magDisturbed,
      sensorsLive: sensorsLive ?? this.sensorsLive,
      sourceNote: sourceNote ?? this.sourceNote,
    );
  }
}

/// Gyroscope-first pedestrian dead reckoning.
///
/// Design (matches Setu project note):
/// - Heading = gyro integration (primary)
/// - Magnetometer = light complementary correction ONLY when field ≈ Earth (~25–65 µT)
/// - Accelerometer = step detection
/// - QR scan = hard reset of lat/lon (and optional heading seed)
class PdrEngine {
  PdrEngine({
    this.gyroWeight = 0.98,
    this.magWeight = 0.02,
    this.earthFieldMinUt = 25,
    this.earthFieldMaxUt = 65,
    this.stepThreshold = 11.5,
    this.minStepIntervalMs = 280,
    this.baseStrideM = 0.72,
  });

  /// Complementary filter: heading = gyroWeight * gyro + magWeight * mag
  final double gyroWeight;
  final double magWeight;
  final double earthFieldMinUt;
  final double earthFieldMaxUt;
  final double stepThreshold;
  final int minStepIntervalMs;
  final double baseStrideM;

  final _controller = StreamController<PdrState>.broadcast();
  Stream<PdrState> get stream => _controller.stream;
  PdrState get state => _state;

  PdrState _state = const PdrState(
    headingDeg: 0,
    lat: 0,
    lon: 0,
    stepCount: 0,
    strideM: 0.72,
    gyroRateZ: 0,
    magFieldUt: 0,
    magDisturbed: false,
    sensorsLive: false,
    sourceNote: 'waiting for sensors',
  );

  StreamSubscription<GyroscopeEvent>? _gyroSub;
  StreamSubscription<AccelerometerEvent>? _accelSub;
  StreamSubscription<MagnetometerEvent>? _magSub;

  DateTime? _lastGyroAt;
  DateTime? _lastStepAt;
  double _prevAccelMag = 0;
  bool _armed = true; // peak detector: wait for drop below threshold
  bool _running = false;

  /// Anchor position from a QR scan — wipes accumulated drift.
  void resetToAnchor({
    required double lat,
    required double lon,
    double? headingDeg,
  }) {
    _state = _state.copyWith(
      lat: lat,
      lon: lon,
      headingDeg: headingDeg ?? _state.headingDeg,
      sourceNote: 'QR anchor reset',
    );
    _emit();
  }

  Future<void> start() async {
    if (_running) return;
    _running = true;

    // Prefer gyroscope — this is the core of Setu.
    try {
      _gyroSub = gyroscopeEventStream(
        samplingPeriod: SensorInterval.gameInterval,
      ).listen(_onGyro, onError: (e) {
        _state = _state.copyWith(sourceNote: 'gyro error: $e');
        _emit();
      });
      _state = _state.copyWith(
        sensorsLive: true,
        sourceNote: 'gyroscope live',
      );
      _emit();
    } catch (e) {
      _state = _state.copyWith(
        sensorsLive: false,
        sourceNote: 'gyroscope unavailable: $e',
      );
      _emit();
    }

    try {
      _accelSub = accelerometerEventStream(
        samplingPeriod: SensorInterval.uiInterval,
      ).listen(_onAccel);
    } catch (_) {/* optional */}

    try {
      _magSub = magnetometerEventStream(
        samplingPeriod: SensorInterval.normalInterval,
      ).listen(_onMag);
    } catch (_) {/* optional */}
  }

  Future<void> stop() async {
    _running = false;
    await _gyroSub?.cancel();
    await _accelSub?.cancel();
    await _magSub?.cancel();
    _gyroSub = null;
    _accelSub = null;
    _magSub = null;
  }

  void dispose() {
    stop();
    _controller.close();
  }

  /// Manual step (for emulator / web demo when accel is weak).
  void injectStep({double? strideM}) {
    _advanceByStep(strideM ?? _state.strideM);
  }

  /// Rotate heading manually (demo / calibration).
  void injectYawDeg(double deltaDeg) {
    final h = (_state.headingDeg + deltaDeg + 360) % 360;
    _state = _state.copyWith(headingDeg: h, sourceNote: 'manual yaw');
    _emit();
  }

  void _onGyro(GyroscopeEvent e) {
    final now = DateTime.now();
    final last = _lastGyroAt;
    _lastGyroAt = now;

    // Phone held screen-up: yaw ≈ rotation around Z (radians/sec).
    // When held upright in hand, Z still carries most heading change for walking turns.
    final yawRate = e.z; // rad/s
    if (last == null) {
      _state = _state.copyWith(
        gyroRateZ: yawRate,
        sensorsLive: true,
        sourceNote: 'gyroscope live',
      );
      _emit();
      return;
    }

    final dt = now.difference(last).inMicroseconds / 1e6;
    if (dt <= 0 || dt > 0.5) {
      _state = _state.copyWith(gyroRateZ: yawRate);
      _emit();
      return;
    }

    // Integrate angular velocity → heading (degrees).
    // Negate so turning right increases heading (clockwise from north).
    final deltaDeg = -yawRate * dt * 180 / math.pi;
    var heading = (_state.headingDeg + deltaDeg + 360) % 360;

    _state = _state.copyWith(
      headingDeg: heading,
      gyroRateZ: yawRate,
      sensorsLive: true,
      sourceNote: _state.magDisturbed
          ? 'gyro only (mag disturbed)'
          : 'gyro + light mag',
    );
    _emit();
  }

  void _onAccel(AccelerometerEvent e) {
    final mag = math.sqrt(e.x * e.x + e.y * e.y + e.z * e.z);
    final now = DateTime.now();

    // Simple peak detector for steps.
    if (_armed && mag > stepThreshold && mag > _prevAccelMag) {
      // rising — wait for peak
    } else if (_armed && mag > stepThreshold && mag < _prevAccelMag) {
      // peak just passed
      final okInterval = _lastStepAt == null ||
          now.difference(_lastStepAt!).inMilliseconds >= minStepIntervalMs;
      if (okInterval) {
        _lastStepAt = now;
        // Adaptive stride from peak intensity (proxy for pace).
        final intensity = (mag - 9.8).clamp(0.5, 8.0);
        final stride = baseStrideM * (0.85 + 0.05 * intensity);
        _advanceByStep(stride);
      }
      _armed = false;
    } else if (!_armed && mag < stepThreshold * 0.85) {
      _armed = true;
    }
    _prevAccelMag = mag;
  }

  void _onMag(MagnetometerEvent e) {
    final field = math.sqrt(e.x * e.x + e.y * e.y + e.z * e.z);
    final disturbed = field < earthFieldMinUt || field > earthFieldMaxUt;

    _state = _state.copyWith(
      magFieldUt: field,
      magDisturbed: disturbed,
    );

    if (disturbed) {
      _emit();
      return;
    }

    // Light complementary correction toward magnetometer heading.
    // Device flat-ish: atan2(y, x) ≈ heading when axes match ENU — approximate.
    final magHeading = (_deg(math.atan2(e.y, e.x)) + 360) % 360;
    final blended = _blendHeading(_state.headingDeg, magHeading);
    _state = _state.copyWith(headingDeg: blended);
    _emit();
  }

  double _blendHeading(double gyroH, double magH) {
    final diff = _shortestDiff(gyroH, magH);
    return (gyroH + magWeight * diff + 360) % 360;
  }

  double _shortestDiff(double from, double to) {
    var d = (to - from + 180) % 360 - 180;
    if (d < -180) d += 360;
    return d;
  }

  void _advanceByStep(double strideM) {
    final hRad = _state.headingDeg * math.pi / 180;
    // Local ENU approximation
    const metersPerDegLat = 111320.0;
    final metersPerDegLon =
        111320.0 * math.cos(_state.lat * math.pi / 180).abs().clamp(0.2, 1.0);

    final dNorth = strideM * math.cos(hRad);
    final dEast = strideM * math.sin(hRad);

    final newLat = _state.lat + dNorth / metersPerDegLat;
    final newLon = _state.lon + dEast / metersPerDegLon;

    _state = _state.copyWith(
      lat: newLat,
      lon: newLon,
      stepCount: _state.stepCount + 1,
      strideM: strideM,
    );
    _emit();
  }

  void _emit() {
    if (!_controller.isClosed) {
      _controller.add(_state);
    }
  }

  static double _deg(double r) => r * 180 / math.pi;

  /// Whether this platform is likely to expose a real gyro.
  static bool get likelyHasGyro {
    if (kIsWeb) return true; // Chrome may expose DeviceMotion with permission
    return defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS;
  }
}
