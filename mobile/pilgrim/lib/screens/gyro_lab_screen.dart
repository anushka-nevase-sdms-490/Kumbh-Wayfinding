import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/pdr_engine.dart';
import '../theme.dart';
import '../widgets/navigation_arrow.dart';

/// Dedicated screen so the jury (and you) can prove the gyroscope is live.
class GyroLabScreen extends StatelessWidget {
  const GyroLabScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final pdr = context.read<PdrEngine>();

    return Scaffold(
      appBar: AppBar(title: const Text('Gyroscope lab')),
      body: StreamBuilder(
        stream: pdr.stream,
        initialData: pdr.state,
        builder: (context, snap) {
          final s = snap.data ?? pdr.state;
          return Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                Text(
                  s.sensorsLive ? 'GYROSCOPE LIVE' : 'NO GYRO SIGNAL',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.2,
                    color: s.sensorsLive ? setuRiver : Colors.red,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Turn the phone in your hand. The arrow must rotate from the '
                  'gyroscope — not GPS, not the network.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: setuInk.withValues(alpha: 0.65)),
                ),
                const SizedBox(height: 24),
                NavigationArrow(rotationDeg: s.headingDeg, size: 240),
                const SizedBox(height: 24),
                _Metric(label: 'Heading', value: '${s.headingDeg.toStringAsFixed(1)}°'),
                _Metric(label: 'Gyro ωz', value: '${s.gyroRateZ.toStringAsFixed(3)} rad/s'),
                _Metric(label: 'Mag field', value: '${s.magFieldUt.toStringAsFixed(1)} µT'),
                _Metric(
                  label: 'Mag status',
                  value: s.magDisturbed ? 'DISTURBED — ignored' : 'OK — light correct',
                ),
                _Metric(label: 'Steps', value: '${s.stepCount}'),
                _Metric(label: 'Source', value: s.sourceNote),
                const Spacer(),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => pdr.injectYawDeg(-15),
                        child: const Text('Yaw −15°'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => pdr.injectYawDeg(15),
                        child: const Text('Yaw +15°'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: FilledButton(
                        onPressed: () => pdr.injectStep(),
                        child: const Text('Step'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: TextStyle(color: setuInk.withValues(alpha: 0.55)),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}
