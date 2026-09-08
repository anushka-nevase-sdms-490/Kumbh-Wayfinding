import 'dart:math' as math;

/// Graph node from the offline pack.
class QrNode {
  final int id;
  final String code;
  final String name;
  final double lat;
  final double lon;
  final String nodeType;
  final String? icon;

  const QrNode({
    required this.id,
    required this.code,
    required this.name,
    required this.lat,
    required this.lon,
    required this.nodeType,
    this.icon,
  });

  factory QrNode.fromJson(Map<String, dynamic> j) => QrNode(
        id: j['id'] as int? ?? 0,
        code: (j['code'] as String).toUpperCase(),
        name: j['name'] as String,
        lat: (j['lat'] as num).toDouble(),
        lon: (j['lon'] as num).toDouble(),
        nodeType: j['node_type'] as String? ?? 'junction',
        icon: j['icon'] as String?,
      );

  bool get isDestination =>
      nodeType != 'junction' && nodeType != 'help';
}

class GraphEdge {
  final String fromCode;
  final String toCode;
  final double distanceM;
  final String surface;
  final bool bidirectional;

  const GraphEdge({
    required this.fromCode,
    required this.toCode,
    required this.distanceM,
    this.surface = 'paved',
    this.bidirectional = true,
  });

  factory GraphEdge.fromJson(Map<String, dynamic> j) => GraphEdge(
        fromCode: (j['from_code'] as String).toUpperCase(),
        toCode: (j['to_code'] as String).toUpperCase(),
        distanceM: (j['distance_m'] as num).toDouble(),
        surface: j['surface'] as String? ?? 'paved',
        bidirectional: j['bidirectional'] as bool? ?? true,
      );
}

class OfflinePack {
  final String version;
  final String signature;
  final Map<String, QrNode> nodesByCode;
  final List<GraphEdge> edges;

  OfflinePack({
    required this.version,
    required this.signature,
    required this.nodesByCode,
    required this.edges,
  });

  factory OfflinePack.fromJson(Map<String, dynamic> j) {
    final nodes = <String, QrNode>{};
    for (final n in (j['nodes'] as List)) {
      final node = QrNode.fromJson(Map<String, dynamic>.from(n as Map));
      nodes[node.code] = node;
    }
    final edges = (j['edges'] as List)
        .map((e) => GraphEdge.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
    return OfflinePack(
      version: j['version'] as String? ?? 'unknown',
      signature: j['signature'] as String? ?? '',
      nodesByCode: nodes,
      edges: edges,
    );
  }

  List<QrNode> get destinations =>
      nodesByCode.values.where((n) => n.isDestination).toList()
        ..sort((a, b) => a.name.compareTo(b.name));
}

/// Geographic helpers (WGS84).
class Geo {
  static double haversineM(double lat1, double lon1, double lat2, double lon2) {
    const r = 6371000.0;
    final dLat = _rad(lat2 - lat1);
    final dLon = _rad(lon2 - lon1);
    final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(_rad(lat1)) *
            math.cos(_rad(lat2)) *
            math.sin(dLon / 2) *
            math.sin(dLon / 2);
    return 2 * r * math.asin(math.sqrt(a));
  }

  /// Initial bearing from point 1 → 2, degrees clockwise from north [0, 360).
  static double bearingDeg(double lat1, double lon1, double lat2, double lon2) {
    final phi1 = _rad(lat1);
    final phi2 = _rad(lat2);
    final dLon = _rad(lon2 - lon1);
    final y = math.sin(dLon) * math.cos(phi2);
    final x = math.cos(phi1) * math.sin(phi2) -
        math.sin(phi1) * math.cos(phi2) * math.cos(dLon);
    return (_deg(math.atan2(y, x)) + 360) % 360;
  }

  static double _rad(double d) => d * math.pi / 180;
  static double _deg(double r) => r * 180 / math.pi;
}
