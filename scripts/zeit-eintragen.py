#!/usr/bin/env python3
"""
Manuelle Zeit eintragen - ACC Dashboard
========================================
Interaktives Script zum Nachtragen verlorener Rundenzeiten.

Aufruf:  python3 zeit-eintragen.py
"""

import urllib.request
import json
import sys

API = "http://localhost:8000/api"

# Auto-Liste (carModel → Name)
CARS = {
    0: "Porsche 991 GT3 R", 1: "Mercedes-AMG GT3", 2: "Ferrari 488 GT3",
    3: "Audi R8 LMS", 4: "Lamborghini Huracán GT3", 5: "McLaren 650S GT3",
    6: "Nissan GT-R Nismo GT3 2018", 7: "BMW M6 GT3", 8: "Bentley Continental GT3 2018",
    9: "Porsche 991 II GT3 Cup", 10: "Nissan GT-R Nismo GT3 2017",
    11: "Bentley Continental GT3 2016", 12: "Aston Martin V12 Vantage GT3",
    13: "Reiter Engineering R-EX GT3", 14: "Emil Frey Jaguar G3", 15: "Lexus RC F GT3",
    16: "Lamborghini Huracán GT3 EVO", 17: "Honda NSX GT3", 18: "Lamborghini Huracán ST",
    19: "Audi R8 LMS EVO", 20: "AMR V8 Vantage GT3", 21: "Honda NSX GT3 EVO",
    22: "McLaren 720S GT3", 23: "Porsche 911 II GT3 R", 24: "Ferrari 488 GT3 EVO",
    25: "Mercedes-AMG GT3 EVO", 26: "Ferrari 488 Challenge EVO", 27: "BMW M2 CS Racing",
    28: "Porsche 992 GT3 Cup", 29: "Lamborghini Huracán ST EVO2", 30: "BMW M4 GT3",
    31: "Audi R8 LMS EVO II", 32: "Ferrari 296 GT3", 33: "Lamborghini Huracán GT3 EVO2",
    34: "Porsche 992 GT3 R", 35: "McLaren 720S GT3 EVO", 36: "Ford Mustang GT3",
}

TRACKS = [
    "barcelona", "brands_hatch", "cota", "donington", "hungaroring", "imola",
    "indianapolis", "kyalami", "laguna_seca", "misano", "monza", "mount_panorama",
    "nurburgring", "nurburgring_24h", "oulton_park", "paul_ricard", "red_bull_ring",
    "silverstone", "snetterton", "spa", "suzuka", "valencia", "watkins_glen",
    "zandvoort", "zolder", "cota_2020",
]


def api_post(path, data):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def ask(prompt, options=None, allow_empty=False):
    while True:
        val = input(prompt).strip()
        if val or allow_empty:
            if options and val not in options:
                print(f"   ⚠️  Ungültig. Möglich: {', '.join(options[:10])}...")
                continue
            return val
        print("   ⚠️  Bitte etwas eingeben.")


def main():
    print()
    print("=" * 50)
    print("   🏎️  Manuelle Zeit eintragen")
    print("=" * 50)
    print()

    # Fahrername
    player = ask("Fahrername (z.B. Andreas Hartmann): ")

    # Steam-ID (optional)
    steam = ask("Steam-ID (optional, Enter zum Überspringen): ", allow_empty=True)

    # Strecke
    print()
    print("Strecken:", ", ".join(TRACKS))
    track = ask("Strecke: ", options=TRACKS)

    # Auto
    print()
    print("Autos:")
    for k in sorted(CARS.keys()):
        print(f"  {k:2} = {CARS[k]}")
    while True:
        try:
            car = int(ask("\nAuto-Nummer: "))
            if car in CARS:
                break
            print("   ⚠️  Ungültige Nummer.")
        except ValueError:
            print("   ⚠️  Bitte eine Zahl.")

    # Rundenzeit
    print()
    laptime = ask("Rundenzeit (Format 8:29.102): ")

    # Sektoren (optional)
    print()
    print("Sektoren optional (Enter zum Überspringen):")
    s1 = ask("  Sektor 1 (z.B. 2:57.000): ", allow_empty=True)
    s2 = ask("  Sektor 2: ", allow_empty=True)
    s3 = ask("  Sektor 3: ", allow_empty=True)

    # Session-Typ
    print()
    stype = ask("Session-Typ (FP/Q/R) [FP]: ", allow_empty=True) or "FP"

    # Senden
    payload = {
        "player_name": player,
        "steam_id": steam,
        "track": track,
        "car_model": car,
        "laptime": laptime,
        "s1": s1, "s2": s2, "s3": s3,
        "session_type": stype,
    }

    print()
    print("Sende...")
    try:
        result = api_post("/manual-lap", payload)
        if result.get("ok"):
            print()
            print("=" * 50)
            print("   ✅ Erfolgreich eingetragen!")
            print("=" * 50)
            print(f"   {result['message']}")
            print()
        else:
            print(f"   ❌ Fehler: {result.get('error')}")
    except Exception as e:
        print(f"   ❌ Verbindungsfehler: {e}")
        print("   Läuft das Backend? (sudo systemctl status acc-backend)")


if __name__ == "__main__":
    main()
