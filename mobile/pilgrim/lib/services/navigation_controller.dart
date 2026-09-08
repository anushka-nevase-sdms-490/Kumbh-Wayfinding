import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/graph.dart';
import 'pack_store.dart';
import 'pdr_engine.dart';
import 'router.dart';

/// Orchestrates scan → destination → gyro-guided walk.
class NavigationController extends ChangeNotifier {
  NavigationController({required this.packStore, required this.pdr}) {
    _pdrSub = pdr.stream.listen((_) {
      _onPdrTick();
    });
  }

  final PackStore packStore;
  final PdrEngine pdr;

  StreamSubscription<PdrState>? _pdrSub;

  QrNode? currentAnchor;
  QrNode? destination;
  RouteResult? route;
  int nextWaypointIndex = 0;
  double remainingM = 0;
  double bearingToNextDeg = 0;
  /// Arrow rotation relative to device heading (what the UI draws).
  double arrowDeg = 0;
  String status = 'Scan a QR board to begin';

  OfflinePack get pack => packStore.pack!;

  void _onPdrTick() {
    if (route == null || destination == null) {
      notifyListeners();
      return;
    }
    _updateGuidance();
    notifyListeners();
  }

  void onQrScanned(String raw) {
    final code = _normalizeCode(raw);
    final node = pack.nodesByCode[code];
    if (node == null) {
      status = 'Unknown code: $code';
      notifyListeners();
      return;
    }
    currentAnchor = node;
    pdr.resetToAnchor(lat: node.lat, lon: node.lon);
    status = 'You are at ${node.name}';

    // If already navigating, snap and advance waypoint if this is on the route.
    if (route != null) {
      final idx = route!.codes.indexOf(code);
      if (idx >= 0) {
        nextWaypointIndex = (idx + 1).clamp(0, route!.codes.length - 1);
      }
      _updateGuidance();
    }
    notifyListeners();
  }

  void setDestination(QrNode dest) {
    if (currentAnchor == null) {
      status = 'Scan a board first';
      notifyListeners();
      return;
    }
    destination = dest;
    final router = Router(pack);
    route = router.find(currentAnchor!.code, dest.code);
    nextWaypointIndex = route!.codes.length > 1 ? 1 : 0;
    if (route!.isEmpty) {
      status = 'No walkable path to ${dest.name}';
    } else {
      status = 'Walking to ${dest.name}';
      _updateGuidance();
    }
    notifyListeners();
  }

  void clearRoute() {
    destination = null;
    route = null;
    remainingM = 0;
    status = currentAnchor == null
        ? 'Scan a QR board to begin'
        : 'You are at ${currentAnchor!.name} — pick a destination';
    notifyListeners();
  }

  void _updateGuidance() {
    if (route == null || route!.codes.isEmpty) return;
    final codes = route!.codes;
    if (nextWaypointIndex >= codes.length) {
      remainingM = 0;
      status = 'Arrived at ${destination!.name}';
      return;
    }

    final next = pack.nodesByCode[codes[nextWaypointIndex]]!;
    final s = pdr.state;
    bearingToNextDeg = Geo.bearingDeg(s.lat, s.lon, next.lat, next.lon);
    arrowDeg = (bearingToNextDeg - s.headingDeg + 360) % 360;
    remainingM = remainingAlongRoute(
      pack: pack,
      routeCodes: codes,
      lat: s.lat,
      lon: s.lon,
      nextIndex: nextWaypointIndex,
    );

    // Auto-advance when within ~8 m of next waypoint (PDR estimate).
    final distNext = Geo.haversineM(s.lat, s.lon, next.lat, next.lon);
    if (distNext < 8 && nextWaypointIndex < codes.length - 1) {
      nextWaypointIndex++;
    } else if (distNext < 8 && nextWaypointIndex == codes.length - 1) {
      status = 'Arrived at ${destination!.name}';
    }
  }

  String _normalizeCode(String raw) {
    var s = raw.trim().toUpperCase();
    // Support URLs like setu://node/SETU-A01 or plain SETU-A01
    if (s.contains('/')) {
      s = s.split('/').last;
    }
    if (s.contains('=')) {
      s = s.split('=').last;
    }
    return s;
  }

  @override
  void dispose() {
    _pdrSub?.cancel();
    super.dispose();
  }
}
