import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/navigation_controller.dart';
import '../services/pack_store.dart';
import '../services/pdr_engine.dart';
import '../theme.dart';
import '../widgets/navigation_arrow.dart';
import 'destination_screen.dart';
import 'gyro_lab_screen.dart';
import 'navigate_screen.dart';
import 'scan_screen.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final nav = context.watch<NavigationController>();
    final pdr = context.read<PdrEngine>();
    final pack = context.read<PackStore>().pack;

    return StreamBuilder(
      stream: pdr.stream,
      initialData: pdr.state,
      builder: (context, snap) {
        final s = snap.data ?? pdr.state;
        return Scaffold(
          body: Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFFF7F1E6), Color(0xFFE4EFEA), Color(0xFFD7E6E2)],
              ),
            ),
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          'Setu',
                          style: Theme.of(context).textTheme.displayLarge,
                        ),
                        const Spacer(),
                        GyroBadge(
                          live: s.sensorsLive,
                          headingDeg: s.headingDeg,
                          gyroRateZ: s.gyroRateZ,
                          magDisturbed: s.magDisturbed,
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Offline wayfinding · zero network',
                      style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                            color: setuInk.withValues(alpha: 0.65),
                          ),
                    ),
                    const SizedBox(height: 28),
                    Expanded(
                      child: Column(
                        children: [
                          NavigationArrow(rotationDeg: s.headingDeg),
                          const SizedBox(height: 12),
                          Text(
                            s.sourceNote,
                            style: TextStyle(
                              color: setuInk.withValues(alpha: 0.55),
                              fontSize: 13,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            nav.status,
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.headlineMedium,
                          ),
                          if (pack != null) ...[
                            const SizedBox(height: 8),
                            Text(
                              'Pack ${pack.version} · ${pack.nodesByCode.length} boards',
                              style: TextStyle(
                                color: setuInk.withValues(alpha: 0.45),
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    FilledButton.icon(
                      onPressed: () async {
                        await Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => const ScanScreen()),
                        );
                      },
                      icon: const Icon(Icons.qr_code_scanner),
                      label: const Text('Scan QR board'),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(54),
                      ),
                    ),
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: nav.currentAnchor == null
                          ? null
                          : () async {
                              await Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => const DestinationScreen(),
                                ),
                              );
                              if (nav.route != null && context.mounted) {
                                Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) => const NavigateScreen(),
                                  ),
                                );
                              }
                            },
                      icon: const Icon(Icons.place_outlined),
                      label: const Text('Pick destination'),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(54),
                        foregroundColor: setuInk,
                        side: const BorderSide(color: setuRiver),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: TextButton.icon(
                            onPressed: () {
                              Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => const GyroLabScreen(),
                                ),
                              );
                            },
                            icon: const Icon(Icons.science_outlined),
                            label: const Text('Gyro lab'),
                          ),
                        ),
                        Expanded(
                          child: TextButton(
                            onPressed: () {
                              // Demo: pretend we scanned Ram Kund without camera
                              nav.onQrScanned('SETU-A01');
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text(
                                    'Demo: anchored at Ram Kund Ghat (SETU-A01)',
                                  ),
                                ),
                              );
                            },
                            child: const Text('Demo scan'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
