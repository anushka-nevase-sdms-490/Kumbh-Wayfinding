import 'dart:collection';
import 'dart:math' as math;

import '../models/graph.dart';

class RouteResult {
  final List<String> codes;
  final double totalDistanceM;

  const RouteResult({required this.codes, required this.totalDistanceM});

  bool get isEmpty => codes.isEmpty;
}

/// A* over the local walkable graph — fully offline.
class Router {
  final OfflinePack pack;
  late final Map<String, List<_Link>> _adj;

  Router(this.pack) {
    _adj = {};
    for (final e in pack.edges) {
      _adj.putIfAbsent(e.fromCode, () => []).add(_Link(e.toCode, e.distanceM));
      if (e.bidirectional) {
        _adj.putIfAbsent(e.toCode, () => []).add(_Link(e.fromCode, e.distanceM));
      }
    }
  }

  RouteResult find(String fromCode, String toCode) {
    fromCode = fromCode.toUpperCase();
    toCode = toCode.toUpperCase();
    if (fromCode == toCode) {
      return RouteResult(codes: [fromCode], totalDistanceM: 0);
    }
    if (!pack.nodesByCode.containsKey(fromCode) ||
        !pack.nodesByCode.containsKey(toCode)) {
      return const RouteResult(codes: [], totalDistanceM: 0);
    }

    final open = HeapPriorityQueue<_Node>((a, b) => a.f.compareTo(b.f));
    final gScore = <String, double>{fromCode: 0};
    final cameFrom = <String, String>{};
    final closed = <String>{};

    open.add(_Node(fromCode, _heuristic(fromCode, toCode)));

    while (open.isNotEmpty) {
      final current = open.removeFirst();
      if (current.code == toCode) {
        return _reconstruct(cameFrom, toCode, gScore[toCode]!);
      }
      if (!closed.add(current.code)) continue;

      for (final link in _adj[current.code] ?? const <_Link>[]) {
        if (closed.contains(link.to)) continue;
        final tent = gScore[current.code]! + link.cost;
        if (tent < (gScore[link.to] ?? double.infinity)) {
          cameFrom[link.to] = current.code;
          gScore[link.to] = tent;
          open.add(_Node(link.to, tent + _heuristic(link.to, toCode)));
        }
      }
    }
    return const RouteResult(codes: [], totalDistanceM: 0);
  }

  double _heuristic(String a, String b) {
    final na = pack.nodesByCode[a]!;
    final nb = pack.nodesByCode[b]!;
    return Geo.haversineM(na.lat, na.lon, nb.lat, nb.lon);
  }

  RouteResult _reconstruct(
    Map<String, String> cameFrom,
    String goal,
    double dist,
  ) {
    final path = Queue<String>();
    var cur = goal;
    path.addFirst(cur);
    while (cameFrom.containsKey(cur)) {
      cur = cameFrom[cur]!;
      path.addFirst(cur);
    }
    return RouteResult(codes: path.toList(), totalDistanceM: dist);
  }
}

class _Link {
  final String to;
  final double cost;
  _Link(this.to, this.cost);
}

class _Node {
  final String code;
  final double f;
  _Node(this.code, this.f);
}

/// Minimal binary heap (avoid extra deps).
class HeapPriorityQueue<E> {
  final Comparator<E> _compare;
  final List<E> _data = [];

  HeapPriorityQueue(this._compare);

  bool get isNotEmpty => _data.isNotEmpty;

  void add(E value) {
    _data.add(value);
    _bubbleUp(_data.length - 1);
  }

  E removeFirst() {
    final first = _data.first;
    final last = _data.removeLast();
    if (_data.isNotEmpty) {
      _data[0] = last;
      _bubbleDown(0);
    }
    return first;
  }

  void _bubbleUp(int i) {
    while (i > 0) {
      final p = (i - 1) ~/ 2;
      if (_compare(_data[i], _data[p]) >= 0) break;
      final tmp = _data[i];
      _data[i] = _data[p];
      _data[p] = tmp;
      i = p;
    }
  }

  void _bubbleDown(int i) {
    while (true) {
      final l = 2 * i + 1;
      final r = 2 * i + 2;
      var smallest = i;
      if (l < _data.length && _compare(_data[l], _data[smallest]) < 0) {
        smallest = l;
      }
      if (r < _data.length && _compare(_data[r], _data[smallest]) < 0) {
        smallest = r;
      }
      if (smallest == i) break;
      final tmp = _data[i];
      _data[i] = _data[smallest];
      _data[smallest] = tmp;
      i = smallest;
    }
  }
}

/// Remaining distance along a polyline of nodes from an estimated position.
double remainingAlongRoute({
  required OfflinePack pack,
  required List<String> routeCodes,
  required double lat,
  required double lon,
  required int nextIndex,
}) {
  if (routeCodes.isEmpty || nextIndex >= routeCodes.length) return 0;
  var rem = Geo.haversineM(
    lat,
    lon,
    pack.nodesByCode[routeCodes[nextIndex]]!.lat,
    pack.nodesByCode[routeCodes[nextIndex]]!.lon,
  );
  for (var i = nextIndex; i < routeCodes.length - 1; i++) {
    final a = pack.nodesByCode[routeCodes[i]]!;
    final b = pack.nodesByCode[routeCodes[i + 1]]!;
    rem += Geo.haversineM(a.lat, a.lon, b.lat, b.lon);
  }
  return rem;
}

double normalizeAngleDiff(double a, double b) {
  var d = (a - b + 180) % 360 - 180;
  if (d < -180) d += 360;
  return d;
}

double clamp(double v, double lo, double hi) => math.max(lo, math.min(hi, v));
