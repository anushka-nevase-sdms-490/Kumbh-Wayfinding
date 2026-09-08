import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'services/navigation_controller.dart';
import 'services/pack_store.dart';
import 'services/pdr_engine.dart';
import 'screens/home_screen.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final packStore = PackStore();
  await packStore.load(apiBase: const String.fromEnvironment(
    'SETU_API',
    defaultValue: 'http://10.0.2.2:8000', // Android emulator → host
  ));
  final pdr = PdrEngine();
  await pdr.start();

  runApp(
    MultiProvider(
      providers: [
        Provider.value(value: packStore),
        Provider.value(value: pdr),
        ChangeNotifierProvider(
          create: (_) => NavigationController(packStore: packStore, pdr: pdr),
        ),
      ],
      child: const SetuPilgrimApp(),
    ),
  );
}

class SetuPilgrimApp extends StatelessWidget {
  const SetuPilgrimApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Setu',
      debugShowCheckedModeBanner: false,
      theme: setuTheme,
      home: const HomeScreen(),
    );
  }
}
