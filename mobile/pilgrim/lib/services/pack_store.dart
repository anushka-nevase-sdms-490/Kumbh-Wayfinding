import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../models/graph.dart';

class PackStore {
  static const _prefsKey = 'setu_offline_pack_json';
  OfflinePack? pack;

  Future<OfflinePack> load({String? apiBase}) async {
    // 1) Cached download
    final prefs = await SharedPreferences.getInstance();
    final cached = prefs.getString(_prefsKey);
    if (cached != null) {
      pack = OfflinePack.fromJson(jsonDecode(cached) as Map<String, dynamic>);
      return pack!;
    }

    // 2) Try backend (optional — only when online)
    if (apiBase != null && apiBase.isNotEmpty) {
      try {
        final res = await http
            .get(Uri.parse('$apiBase/api/pack/latest/json'))
            .timeout(const Duration(seconds: 3));
        if (res.statusCode == 200) {
          await prefs.setString(_prefsKey, res.body);
          pack = OfflinePack.fromJson(
            jsonDecode(res.body) as Map<String, dynamic>,
          );
          return pack!;
        }
      } catch (_) {/* fall through to asset */}
    }

    // 3) Bundled demo pack — always works offline
    final raw = await rootBundle.loadString('assets/pack/setu_pack_demo.json');
    await prefs.setString(_prefsKey, raw);
    pack = OfflinePack.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    return pack!;
  }

  Future<void> saveFromJson(String json) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsKey, json);
    pack = OfflinePack.fromJson(jsonDecode(json) as Map<String, dynamic>);
  }

  Future<void> reloadBundled() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_prefsKey);
    await load();
  }
}
