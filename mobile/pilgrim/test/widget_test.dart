import 'package:flutter_test/flutter_test.dart';
import 'package:setu_pilgrim/services/router.dart';
import 'package:setu_pilgrim/models/graph.dart';
import 'dart:convert';
import 'package:flutter/services.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('A* finds path between seed nodes', () async {
    final raw = await rootBundle.loadString('assets/pack/setu_pack_demo.json');
    final pack = OfflinePack.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    final route = Router(pack).find('SETU-A01', 'SETU-A03');
    expect(route.codes.isNotEmpty, true);
    expect(route.codes.first, 'SETU-A01');
    expect(route.codes.last, 'SETU-A03');
    expect(route.totalDistanceM, greaterThan(0));
  });
}
