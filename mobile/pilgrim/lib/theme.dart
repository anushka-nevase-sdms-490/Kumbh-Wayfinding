import 'package:flutter/material.dart';

/// Warm river-silt palette — not purple, not cream-serif AI default.
const Color setuInk = Color(0xFF1A2421);
const Color setuRiver = Color(0xFF1F6F6A);
const Color setuSaffron = Color(0xFFC45C26);
const Color setuSand = Color(0xFFE8DCC8);
const Color setuMist = Color(0xFFF3EDE3);

final ThemeData setuTheme = ThemeData(
  useMaterial3: true,
  brightness: Brightness.light,
  colorScheme: ColorScheme.fromSeed(
    seedColor: setuRiver,
    primary: setuRiver,
    secondary: setuSaffron,
    surface: setuMist,
    onPrimary: Colors.white,
    onSurface: setuInk,
  ),
  scaffoldBackgroundColor: setuMist,
  appBarTheme: const AppBarTheme(
    backgroundColor: Colors.transparent,
    elevation: 0,
    foregroundColor: setuInk,
    centerTitle: false,
  ),
  fontFamily: 'Roboto', // system fallback; replace with bundled font later
  textTheme: const TextTheme(
    displayLarge: TextStyle(
      fontSize: 40,
      fontWeight: FontWeight.w700,
      letterSpacing: -1,
      color: setuInk,
    ),
    headlineMedium: TextStyle(
      fontSize: 24,
      fontWeight: FontWeight.w600,
      color: setuInk,
    ),
    bodyLarge: TextStyle(fontSize: 16, height: 1.4, color: setuInk),
    labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      backgroundColor: setuRiver,
      foregroundColor: Colors.white,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
  ),
);
