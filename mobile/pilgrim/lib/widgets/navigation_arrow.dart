import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme.dart';

/// Big live navigation arrow. Rotates with [rotationDeg] (0 = up = forward).
class NavigationArrow extends StatelessWidget {
  const NavigationArrow({
    super.key,
    required this.rotationDeg,
    this.size = 220,
  });

  final double rotationDeg;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Transform.rotate(
      angle: rotationDeg * math.pi / 180,
      child: CustomPaint(
        size: Size(size, size),
        painter: _ArrowPainter(),
      ),
    );
  }
}

class _ArrowPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final cx = size.width / 2;
    final cy = size.height / 2;
    final paint = Paint()..style = PaintingStyle.fill;

    // Soft ring
    paint.color = setuRiver.withValues(alpha: 0.12);
    canvas.drawCircle(Offset(cx, cy), size.width * 0.48, paint);

    paint.color = setuRiver.withValues(alpha: 0.22);
    canvas.drawCircle(Offset(cx, cy), size.width * 0.36, paint);

    // Arrow pointing up (device forward)
    final path = Path()
      ..moveTo(cx, size.height * 0.08)
      ..lineTo(size.width * 0.72, size.height * 0.62)
      ..lineTo(cx, size.height * 0.48)
      ..lineTo(size.width * 0.28, size.height * 0.62)
      ..close();

    paint.color = setuSaffron;
    canvas.drawPath(path, paint);

    paint.color = setuInk.withValues(alpha: 0.15);
    canvas.drawCircle(Offset(cx, cy), 10, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// Compact gyro live indicator.
class GyroBadge extends StatelessWidget {
  const GyroBadge({
    super.key,
    required this.live,
    required this.headingDeg,
    required this.gyroRateZ,
    required this.magDisturbed,
  });

  final bool live;
  final double headingDeg;
  final double gyroRateZ;
  final bool magDisturbed;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: live ? setuRiver.withValues(alpha: 0.12) : Colors.red.shade50,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: live ? setuRiver.withValues(alpha: 0.35) : Colors.red.shade200,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.rotate_90_degrees_ccw,
            size: 16,
            color: live ? setuRiver : Colors.red.shade700,
          ),
          const SizedBox(width: 6),
          Text(
            live
                ? 'GYRO ${headingDeg.toStringAsFixed(0)}°'
                : 'GYRO OFF',
            style: TextStyle(
              fontWeight: FontWeight.w700,
              fontSize: 12,
              letterSpacing: 0.4,
              color: live ? setuRiver : Colors.red.shade700,
            ),
          ),
          if (magDisturbed) ...[
            const SizedBox(width: 8),
            Text(
              'MAG IGNORE',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: setuSaffron,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
