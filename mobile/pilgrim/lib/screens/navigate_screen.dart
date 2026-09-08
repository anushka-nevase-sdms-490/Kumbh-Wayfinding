import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/navigation_controller.dart';
import '../services/pdr_engine.dart';
import '../theme.dart';
import '../widgets/navigation_arrow.dart';
import 'scan_screen.dart';

class NavigateScreen extends StatelessWidget {
  const NavigateScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final nav = context.watch<NavigationController>();
    final pdr = context.read<PdrEngine>();

    return StreamBuilder(
      stream: pdr.stream,
      initialData: pdr.state,
      builder: (context, snap) {
        final s = snap.data ?? pdr.state;
        return Scaffold(
          body: Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0xFF1F6F6A), Color(0xFF143F3C)],
              ),
            ),
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    Row(
                      children: [
                        IconButton(
                          onPressed: () => Navigator.pop(context),
                          icon: const Icon(Icons.close, color: Colors.white),
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
                    const SizedBox(height: 8),
                    Text(
                      nav.destination?.name ?? '',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 28,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      '${nav.remainingM.toStringAsFixed(0)} m remaining',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.75),
                        fontSize: 16,
                      ),
                    ),
                    const Spacer(),
                    // Arrow shows where to walk relative to current gyro heading
                    NavigationArrow(rotationDeg: nav.arrowDeg, size: 260),
                    const SizedBox(height: 16),
                    Text(
                      'Follow the arrow',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.85),
                        fontSize: 18,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Steps ${s.stepCount} · stride ${s.strideM.toStringAsFixed(2)} m · '
                      'ωz ${s.gyroRateZ.toStringAsFixed(2)} rad/s',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.55),
                        fontSize: 12,
                      ),
                    ),
                    const Spacer(),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () async {
                              await Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => const ScanScreen(),
                                ),
                              );
                            },
                            icon: const Icon(Icons.qr_code),
                            label: const Text('Rescan board'),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: Colors.white,
                              side: const BorderSide(color: Colors.white54),
                              minimumSize: const Size.fromHeight(52),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: () => pdr.injectStep(),
                            icon: const Icon(Icons.directions_walk),
                            label: const Text('Step+'),
                            style: FilledButton.styleFrom(
                              backgroundColor: setuSaffron,
                              minimumSize: const Size.fromHeight(52),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      nav.status,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.7),
                      ),
                      textAlign: TextAlign.center,
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
