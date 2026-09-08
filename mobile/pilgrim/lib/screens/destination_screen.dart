import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/graph.dart';
import '../services/navigation_controller.dart';
import '../services/pack_store.dart';
import '../theme.dart';

IconData _iconFor(String? icon) {
  switch (icon) {
    case 'ghat':
      return Icons.water;
    case 'medical':
      return Icons.local_hospital_outlined;
    case 'toilet':
      return Icons.wc;
    case 'parking':
      return Icons.local_parking;
    case 'lost_found':
      return Icons.person_search_outlined;
    case 'transport':
      return Icons.directions_bus_outlined;
    case 'help':
      return Icons.support_agent;
    default:
      return Icons.place_outlined;
  }
}

class DestinationScreen extends StatelessWidget {
  const DestinationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final pack = context.read<PackStore>().pack!;
    final nav = context.read<NavigationController>();
    final destinations = pack.destinations;

    return Scaffold(
      appBar: AppBar(title: const Text('Where to?')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: GridView.builder(
          itemCount: destinations.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.05,
          ),
          itemBuilder: (context, i) {
            final QrNode d = destinations[i];
            return Material(
              color: Colors.white.withValues(alpha: 0.7),
              borderRadius: BorderRadius.circular(18),
              child: InkWell(
                borderRadius: BorderRadius.circular(18),
                onTap: () {
                  nav.setDestination(d);
                  Navigator.of(context).pop();
                },
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(_iconFor(d.icon), size: 42, color: setuRiver),
                      const SizedBox(height: 12),
                      Text(
                        d.name,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
