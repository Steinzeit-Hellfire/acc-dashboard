#!/usr/bin/env python3
"""ACC Dashboard Backend v6"""
import json, glob, os, sqlite3, re, math
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

RESULTS_DIR = os.getenv("ACC_RESULTS_DIR", "/home/detrees95/acc-results")
CONFIGS_DIR = os.getenv("ACC_CONFIGS_DIR", "/home/detrees95/acc-configs")
DB_PATH     = os.getenv("ACC_DB_PATH",     "/home/detrees95/acc-dashboard/acc.db")
TZ = ZoneInfo("Europe/Berlin")

app = FastAPI(title="ACC Dashboard API", version="6.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def ms(v):
    if not v or v <= 0: return "—"
    return f"{v//60000}:{((v%60000)/1000):06.3f}"

def berlin(ts):
    try: return datetime.fromisoformat(ts).astimezone(TZ).strftime("%d.%m.%Y %H:%M")
    except: return ts or "—"

def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY, track TEXT, session_type TEXT,
            server_name TEXT, is_wet INTEGER DEFAULT 0,
            ambient_temp INTEGER DEFAULT 0, track_temp INTEGER DEFAULT 0,
            timestamp TEXT, file_path TEXT
        );
        CREATE TABLE IF NOT EXISTS laps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT, steam_id TEXT, player_name TEXT,
            track TEXT, car TEXT, car_model INTEGER,
            laptime_ms INTEGER, s1_ms INTEGER, s2_ms INTEGER, s3_ms INTEGER,
            valid INTEGER, timestamp TEXT,
            UNIQUE(session_id, steam_id, laptime_ms)
        );
        CREATE TABLE IF NOT EXISTS drivers (
            steam_id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT,
            short_name TEXT, nationality INTEGER
        );
        CREATE TABLE IF NOT EXISTS penalties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT, steam_id TEXT, player_name TEXT,
            track TEXT, penalty_type TEXT, reason TEXT, timestamp TEXT
        );
        CREATE TABLE IF NOT EXISTS name_map (
            steam_id TEXT PRIMARY KEY, player_name TEXT
        );
    """)
    for col in [("server_name","TEXT"),("is_wet","INTEGER DEFAULT 0"),
                ("ambient_temp","INTEGER DEFAULT 0"),("track_temp","INTEGER DEFAULT 0")]:
        try: conn.execute(f"ALTER TABLE sessions ADD COLUMN {col[0]} {col[1]}")
        except: pass
    conn.commit(); conn.close()

CAR = {
    0:"Porsche 991 GT3 R",1:"Mercedes-AMG GT3",2:"Ferrari 488 GT3",
    3:"Audi R8 LMS",4:"Lamborghini Huracán GT3",5:"McLaren 650S GT3",
    6:"Nissan GT-R Nismo GT3 2018",7:"BMW M6 GT3",8:"Bentley Continental GT3 2018",
    9:"Porsche 991 II GT3 Cup",10:"Nissan GT-R Nismo GT3 2017",
    11:"Bentley Continental GT3 2016",12:"Aston Martin V12 Vantage GT3",
    13:"Reiter Engineering R-EX GT3",14:"Emil Frey Jaguar G3",15:"Lexus RC F GT3",
    16:"Lamborghini Huracán GT3 EVO",17:"Honda NSX GT3",18:"Lamborghini Huracán ST",
    19:"Audi R8 LMS EVO",20:"AMR V8 Vantage GT3",21:"Honda NSX GT3 EVO",
    22:"McLaren 720S GT3",23:"Porsche 911 II GT3 R",24:"Ferrari 488 GT3 EVO",
    25:"Mercedes-AMG GT3 EVO",26:"Ferrari 488 Challenge EVO",27:"BMW M2 CS Racing",
    28:"Porsche 992 GT3 Cup",29:"Lamborghini Huracán ST EVO2",30:"BMW M4 GT3",
    31:"Audi R8 LMS EVO II",32:"Ferrari 296 GT3",33:"Lamborghini Huracán GT3 EVO2",
    34:"Porsche 992 GT3 R",35:"McLaren 720S GT3 EVO",36:"Ford Mustang GT3",
}

def nid(s):
    if not s: return s
    s = s.strip()
    return s if s.startswith("S") else "S" + s

def parse_json(fp):
    with open(fp, "r", encoding="utf-8-sig") as f: raw = f.read()
    return json.loads(re.sub(r",\s*([}\]])", r"\1", raw))

def load_cfg():
    cfg = {}
    for f in glob.glob(os.path.join(CONFIGS_DIR, "*_event.json")):
        try:
            d = parse_json(f)
            cfg[Path(f).stem.replace("_event","")] = {
                "ambient_temp": d.get("ambientTemp", 0),
                "track_temp": d.get("ambientTemp", 0) + 5
            }
        except: pass
    return cfg

def ingest(fp, cfg):
    conn = get_db()
    try: data = parse_json(fp)
    except Exception as e:
        print(f"[SKIP] {fp}: {e}"); conn.close(); return
    track = data.get("trackName", "unknown")
    stype = data.get("sessionType", "FP")
    srv   = data.get("serverName", "")
    wet   = data.get("sessionResult", {}).get("isWetSession", 0)
    sid   = Path(fp).stem
    ts    = datetime.fromtimestamp(Path(fp).stat().st_mtime).isoformat()
    wcfg  = list(cfg.values())[-1] if cfg else {"ambient_temp": 0, "track_temp": 0}
    conn.execute("INSERT OR IGNORE INTO sessions VALUES (?,?,?,?,?,?,?,?,?)",
                 (sid, track, stype, srv, wet, wcfg["ambient_temp"], wcfg["track_temp"], ts, fp))
    dmap = {}
    for line in data.get("sessionResult", {}).get("leaderBoardLines", []):
        car = line.get("car", {})
        idx = car.get("carId", car.get("carIndex", 0))
        cm  = car.get("carModel", -1)
        for d in car.get("drivers", []):
            s  = nid(d.get("playerId", "").strip())
            fn = d.get("firstName", ""); ln = d.get("lastName", ""); sn = d.get("shortName", "")
            nm = f"{fn} {ln}".strip() or sn or s
            if s:
                dmap[idx] = {"steam_id": s, "name": nm, "car_model": cm}
                conn.execute("INSERT OR IGNORE INTO drivers VALUES (?,?,?,?,?)", (s,fn,ln,sn,d.get("nationality",0)))
                conn.execute("INSERT OR REPLACE INTO name_map VALUES (?,?)", (s, nm))
    for lap in data.get("laps", []):
        idx = lap.get("carId", lap.get("carIndex", -1))
        lt  = lap.get("laptime", 0)
        sp  = lap.get("splits", [0,0,0])
        v   = 1 if lap.get("isValidForBest", True) else 0
        di  = dmap.get(idx, {})
        s   = di.get("steam_id", f"car_{idx}")
        nm  = di.get("name", f"Unknown #{idx}")
        cm  = di.get("car_model", -1)
        cn  = CAR.get(cm, f"Car #{cm}")
        try:
            conn.execute("""INSERT OR IGNORE INTO laps
               (session_id,steam_id,player_name,track,car,car_model,laptime_ms,s1_ms,s2_ms,s3_ms,valid,timestamp)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
               (sid,s,nm,track,cn,cm,lt,
                sp[0] if sp else 0, sp[1] if len(sp)>1 else 0, sp[2] if len(sp)>2 else 0, v, ts))
        except: pass
    # ── Laufzeit-Strafen (penalties) + Post-Race (beide Schreibweisen!) ──
    pen_list = (data.get("penalties", []) +
                data.get("post_race_penalties", []) +    # snake_case
                data.get("postRacePenalties", []))        # camelCase (ACC Standard)
    for pen in pen_list:
        idx = pen.get("carId", pen.get("carIndex", -1))
        di  = dmap.get(idx, {})
        s   = di.get("steam_id", f"car_{idx}")
        nm  = di.get("name", f"Unknown #{idx}")
        pt  = str(pen.get("penalty", pen.get("penaltyShortcut", "")))
        rs  = str(pen.get("reason", pen.get("violationInLap", pen.get("clearedInLap", ""))))
        if not pt or pt in ("", "None", "0"): continue  # leere Strafen überspringen
        try: conn.execute("INSERT OR IGNORE INTO penalties (session_id,steam_id,player_name,track,penalty_type,reason,timestamp) VALUES (?,?,?,?,?,?,?)",(sid,s,nm,track,pt,str(rs),ts))
        except: pass

    # ── DSQ + DNF aus finishStatus der Leaderboard-Zeilen ──
    for line in data.get("sessionResult", {}).get("leaderBoardLines", []):
        fs = line.get("finishStatus", "None")
        if fs not in ("DSQ", "DNF", "DQ"): continue
        car = line.get("car", {})
        idx = car.get("carId", car.get("carIndex", -1))
        di  = dmap.get(idx, {})
        s   = di.get("steam_id", f"car_{idx}")
        nm  = di.get("name", f"Unknown #{idx}")
        pt  = "Disqualified" if "DSQ" in fs or "DQ" in fs else "DNF"
        rs  = line.get("missingMandatoryPitstop", 0)
        rs_str = "Pflicht-Pitstop vergessen" if rs else fs
        try: conn.execute("INSERT OR IGNORE INTO penalties (session_id,steam_id,player_name,track,penalty_type,reason,timestamp) VALUES (?,?,?,?,?,?,?)",(sid,s,nm,track,pt,rs_str,ts))
        except: pass
    conn.commit(); conn.close()

def fix_names():
    conn = get_db()
    conn.execute("UPDATE laps SET player_name=(SELECT nm.player_name FROM name_map nm WHERE nm.steam_id=laps.steam_id) WHERE steam_id IN (SELECT steam_id FROM name_map)")
    conn.execute("UPDATE penalties SET player_name=(SELECT nm.player_name FROM name_map nm WHERE nm.steam_id=penalties.steam_id) WHERE steam_id IN (SELECT steam_id FROM name_map)")
    conn.execute("DELETE FROM laps WHERE steam_id LIKE 'car_%'")
    conn.execute("DELETE FROM penalties WHERE steam_id LIKE 'car_%'")
    conn.commit(); conn.close()

def ingest_all():
    cfg = load_cfg()
    files = sorted(glob.glob(os.path.join(RESULTS_DIR, "*.json")))
    for f in files: ingest(f, cfg)
    fix_names()
    print(f"[OK] {len(files)} Dateien")

@app.on_event("startup")
def startup(): init_db(); ingest_all()

# ── Standard-Endpunkte ─────────────────────────────────────────────────────────
@app.get("/api/tracks")
def get_tracks():
    conn = get_db()
    rows = conn.execute("SELECT track,COUNT(*) as laps,COUNT(DISTINCT steam_id) as drivers,MIN(laptime_ms) as best_ms FROM laps WHERE valid=1 GROUP BY track ORDER BY track").fetchall()
    conn.close()
    return [dict(r)|{"best_laptime":ms(r["best_ms"])} for r in rows]

@app.get("/api/leaderboard/{track}")
def get_leaderboard(track:str, car:str=Query(default=None)):
    conn = get_db()
    q = "SELECT steam_id,player_name,car,MIN(laptime_ms) as best_ms,MIN(s1_ms) as best_s1,MIN(s2_ms) as best_s2,MIN(s3_ms) as best_s3,COUNT(*) as total_laps FROM laps WHERE track=? AND valid=1"
    p = [track]
    if car: q += " AND car=?"; p.append(car)
    q += " GROUP BY steam_id,car ORDER BY best_ms ASC"
    rows = conn.execute(q, p).fetchall()
    conn.close()
    leader = rows[0]["best_ms"] if rows else 0
    return [{**dict(r),"position":i+1,"best_laptime":ms(r["best_ms"]),
             "best_s1":ms(r["best_s1"]),"best_s2":ms(r["best_s2"]),"best_s3":ms(r["best_s3"]),
             "gap":f"+{ms(r['best_ms']-leader)}" if r["best_ms"]>leader else "—",
             "gap_ms":r["best_ms"]-leader} for i,r in enumerate(rows)]

@app.get("/api/cars/{track}")
def get_cars(track:str):
    conn = get_db()
    rows = conn.execute("SELECT DISTINCT car,COUNT(*) as laps,MIN(laptime_ms) as best_ms FROM laps WHERE track=? AND valid=1 AND car NOT LIKE 'Car #%' GROUP BY car ORDER BY best_ms ASC",(track,)).fetchall()
    conn.close()
    return [dict(r)|{"best_laptime":ms(r["best_ms"])} for r in rows]

@app.get("/api/sessions/{track}")
def get_sessions(track:str):
    conn = get_db()
    rows = conn.execute("""
        SELECT s.*,COUNT(l.id) as lap_count,COUNT(DISTINCT l.steam_id) as driver_count,MIN(l.laptime_ms) as best_ms
        FROM sessions s LEFT JOIN laps l ON l.session_id=s.id AND l.valid=1
        WHERE s.track=? GROUP BY s.id ORDER BY s.timestamp DESC
    """,(track,)).fetchall()
    result = []
    for r in rows:
        # Fahrerliste für Stint-Analyse mitliefern
        drivers = conn.execute(
            "SELECT DISTINCT steam_id, player_name FROM laps WHERE session_id=? AND valid=1",
            (r["id"],)
        ).fetchall()
        result.append(dict(r) | {
            "best_laptime":  ms(r["best_ms"]),
            "timestamp_berlin": berlin(r["timestamp"]),
            "drivers_list": [dict(d) for d in drivers]
        })
    conn.close()
    return result

@app.get("/api/penalties/{track}")
def get_penalties(track:str):
    conn = get_db()
    rows = conn.execute("SELECT p.*,s.server_name,s.is_wet FROM penalties p LEFT JOIN sessions s ON s.id=p.session_id WHERE p.track=? ORDER BY p.timestamp DESC LIMIT 100",(track,)).fetchall()
    conn.close()
    return [dict(r)|{"timestamp_berlin":berlin(r["timestamp"])} for r in rows]

@app.get("/api/drivers")
def get_drivers():
    conn = get_db()
    rows = conn.execute("SELECT steam_id,player_name,COUNT(DISTINCT track) as tracks,COUNT(*) as total_laps,MIN(laptime_ms) as best_ms,COUNT(DISTINCT car) as cars_driven,MAX(timestamp) as last_seen FROM laps WHERE valid=1 GROUP BY steam_id ORDER BY total_laps DESC").fetchall()
    conn.close()
    return [dict(r)|{"best_laptime":ms(r["best_ms"]),"last_seen_berlin":berlin(r["last_seen"])} for r in rows]

@app.get("/api/driver/{steam_id}")
def get_driver(steam_id:str):
    conn = get_db()
    info = conn.execute("SELECT * FROM drivers WHERE steam_id=?",(steam_id,)).fetchone()
    rows = conn.execute("SELECT track,car,MIN(laptime_ms) as best_ms,COUNT(*) as total_laps FROM laps WHERE steam_id=? AND valid=1 GROUP BY track,car ORDER BY track,best_ms ASC",(steam_id,)).fetchall()
    conn.close()
    return {"driver":dict(info) if info else {"steam_id":steam_id},"tracks":[dict(r)|{"best_laptime":ms(r["best_ms"])} for r in rows]}

@app.get("/api/stats")
def get_stats():
    conn = get_db()
    s = conn.execute("SELECT COUNT(DISTINCT steam_id) as total_drivers,COUNT(DISTINCT track) as total_tracks,COUNT(DISTINCT session_id) as total_sessions,COUNT(*) as total_laps FROM laps WHERE valid=1").fetchone()
    f = conn.execute("SELECT player_name,track,MIN(laptime_ms) as best_ms FROM laps WHERE valid=1").fetchone()
    conn.close()
    return {**dict(s),"fastest_overall":dict(f)|{"best_laptime":ms(f["best_ms"])} if f and f["best_ms"] else None}

@app.get("/api/analysis/{track}")
def get_analysis(track:str):
    conn = get_db()
    all_laps = conn.execute("SELECT steam_id,player_name,car,laptime_ms,s1_ms,s2_ms,s3_ms,timestamp FROM laps WHERE track=? AND valid=1 ORDER BY steam_id,timestamp ASC",(track,)).fetchall()
    by_d = {}
    for lap in all_laps:
        sid = lap["steam_id"]
        if sid not in by_d: by_d[sid] = {"player_name":lap["player_name"],"laps":[],"cars":set()}
        by_d[sid]["laps"].append(dict(lap))
        by_d[sid]["cars"].add(lap["car"])
    gs1 = min((r["s1_ms"] for r in all_laps if r["s1_ms"]>0), default=0)
    gs2 = min((r["s2_ms"] for r in all_laps if r["s2_ms"]>0), default=0)
    gs3 = min((r["s3_ms"] for r in all_laps if r["s3_ms"]>0), default=0)
    result = []
    for sid, info in by_d.items():
        laps = info["laps"]; times = [l["laptime_ms"] for l in laps]
        best = min(times); avg = sum(times)/len(times); worst = max(times)
        std = math.sqrt(sum((t-avg)**2 for t in times)/len(times))
        bs1 = min((l["s1_ms"] for l in laps if l["s1_ms"]>0), default=0)
        bs2 = min((l["s2_ms"] for l in laps if l["s2_ms"]>0), default=0)
        bs3 = min((l["s3_ms"] for l in laps if l["s3_ms"]>0), default=0)
        cars = sorted(info["cars"])
        result.append({"steam_id":sid,"player_name":info["player_name"],
            "car":", ".join(cars) if len(cars)<=2 else f"{len(cars)} Fahrzeuge",
            "lap_count":len(times),"best_ms":best,"avg_ms":round(avg),"worst_ms":worst,
            "std_dev_ms":round(std),"best_laptime":ms(best),"avg_laptime":ms(round(avg)),
            "worst_laptime":ms(worst),"std_dev":ms(round(std)),
            "consistency_pct":round(100-(std/avg*100),1) if avg>0 else 0,
            "best_s1":bs1,"best_s1_str":ms(bs1),"best_s2":bs2,"best_s2_str":ms(bs2),
            "best_s3":bs3,"best_s3_str":ms(bs3)})
    result.sort(key=lambda x:x["best_ms"])
    car_rows = conn.execute("SELECT car,MIN(laptime_ms) as best_ms,COUNT(DISTINCT steam_id) as drivers,COUNT(*) as laps FROM laps WHERE track=? AND valid=1 AND car NOT LIKE 'Car #%' GROUP BY car ORDER BY best_ms ASC",(track,)).fetchall()
    conn.close()
    return {"drivers":result,"global_s1":gs1,"global_s1_str":ms(gs1),
            "global_s2":gs2,"global_s2_str":ms(gs2),"global_s3":gs3,"global_s3_str":ms(gs3),
            "car_ranking":[dict(r)|{"best_laptime":ms(r["best_ms"])} for r in car_rows]}

@app.get("/api/laps/{track}/{steam_id}")
def get_laps(track:str, steam_id:str):
    conn = get_db()
    rows = conn.execute("SELECT laptime_ms,s1_ms,s2_ms,s3_ms,car,timestamp FROM laps WHERE track=? AND steam_id=? AND valid=1 ORDER BY timestamp ASC",(track,steam_id)).fetchall()
    conn.close()
    best = None; result = []
    for i, r in enumerate(rows):
        t = r["laptime_ms"]; is_pb = best is None or t < best
        if is_pb: best = t
        result.append({**dict(r),"lap_num":i+1,"laptime":ms(t),"is_pb":is_pb,"ts_berlin":berlin(r["timestamp"])})
    return result

# ── NEUE ENDPUNKTE ─────────────────────────────────────────────────────────────

@app.get("/api/records")
def get_records():
    """Streckenrekorde: beste Zeit pro Strecke mit Fahrer, Auto und Datum."""
    conn = get_db()
    tracks = conn.execute("SELECT DISTINCT track FROM laps WHERE valid=1 ORDER BY track").fetchall()
    result = []
    for t in tracks:
        tr = t["track"]
        row = conn.execute("""
            SELECT l.player_name, l.steam_id, l.car, l.laptime_ms,
                   l.s1_ms, l.s2_ms, l.s3_ms, s.timestamp
            FROM laps l JOIN sessions s ON s.id=l.session_id
            WHERE l.track=? AND l.valid=1
            ORDER BY l.laptime_ms ASC LIMIT 1
        """, (tr,)).fetchone()
        if row:
            result.append({**dict(row),"track":tr,
                "best_laptime":ms(row["laptime_ms"]),
                "best_s1":ms(row["s1_ms"]),"best_s2":ms(row["s2_ms"]),"best_s3":ms(row["s3_ms"]),
                "record_date":berlin(row["timestamp"])})
    conn.close()
    return result

@app.get("/api/elo")
def get_elo():
    """LFM-kalibriertes ELO: Rundenzeit vs. globalem LFM-Feld + Positionswertung."""
    conn = get_db()

    # ── LFM Referenz-Zeiten (ms) pro Strecke pro ELO-Klasse ──────────────────
    # Basierend auf bekannten LFM-Community-Daten (konservative Schätzungen)
    LFM_REF = {
        "nurburgring_24h": {8000:472000,6000:487000,5000:497000,3500:508000,2500:520000,2000:533000,1700:547000,1500:562000,1300:578000,1000:600000},
        "spa":             {8000:122000,6000:125000,5000:127500,3500:130000,2500:133000,2000:136000,1700:139000,1500:142000,1300:146000,1000:152000},
        "monza":           {8000:104000,6000:107000,5000:109000,3500:111000,2500:113500,2000:116000,1700:118500,1500:121000,1300:124000,1000:129000},
        "silverstone":     {8000:116000,6000:119000,5000:121000,3500:123500,2500:126000,2000:129000,1700:132000,1500:135000,1300:138000,1000:144000},
        "barcelona":       {8000:116500,6000:119500,5000:121500,3500:124000,2500:127000,2000:130000,1700:133000,1500:136000,1300:140000,1000:146000},
        "hungaroring":     {8000:112000,6000:115000,5000:117000,3500:119500,2500:122000,2000:125000,1700:128000,1500:131000,1300:135000,1000:141000},
        "zandvoort":       {8000:110500,6000:113500,5000:115500,3500:118000,2500:120500,2000:123500,1700:126500,1500:129500,1300:133000,1000:139000},
        "misano":          {8000:102000,6000:104500,5000:106500,3500:108500,2500:111000,2000:113500,1700:116000,1500:118500,1300:122000,1000:127000},
        "imola":           {8000:109000,6000:112000,5000:114000,3500:116500,2500:119000,2000:122000,1700:125000,1500:128000,1300:132000,1000:138000},
        "brands_hatch":    {8000:88000, 6000:90500, 5000:92500, 3500:94500, 2500:97000, 2000:99500, 1700:102000,1500:105000,1300:108000,1000:113000},
        "paul_ricard":     {8000:112000,6000:115000,5000:117000,3500:119500,2500:122000,2000:125000,1700:128000,1500:131000,1300:135000,1000:141000},
        "zolder":          {8000:87500, 6000:90000, 5000:91500, 3500:93500, 2500:96000, 2000:98500, 1700:101000,1500:103500,1300:107000,1000:112000},
        "mount_panorama":  {8000:122000,6000:125500,5000:128000,3500:131000,2500:134500,2000:138000,1700:141500,1500:145000,1300:149000,1000:156000},
        "kyalami":         {8000:112500,6000:115500,5000:117500,3500:120000,2500:122500,2000:125500,1700:128500,1500:131500,1300:135000,1000:141000},
        "laguna_seca":     {8000:83000, 6000:85500, 5000:87000, 3500:89000, 2500:91000, 2000:93500, 1700:96000, 1500:98500, 1300:101500,1000:107000},
        "red_bull_ring":   {8000:88500, 6000:91000, 5000:92500, 3500:94500, 2500:97000, 2000:99500, 1700:102000,1500:104500,1300:107500,1000:112500},
        "nurburgring":     {8000:114000,6000:117000,5000:119000,3500:121500,2500:124000,2000:127000,1700:130000,1500:133000,1300:137000,1000:143000},
        "donington":       {8000:83000, 6000:85500, 5000:87000, 3500:89000, 2500:91500, 2000:94000, 1700:96500, 1500:99000, 1300:102000,1000:107000},
        "snetterton":      {8000:104000,6000:107000,5000:109000,3500:111000,2500:114000,2000:117000,1700:120000,1500:123000,1300:127000,1000:133000},
        "oulton_park":     {8000:92000, 6000:94500, 5000:96500, 3500:98500, 2500:101000,2000:103500,1700:106000,1500:109000,1300:112500,1000:118000},
        "indianapolis":    {8000:108000,6000:111000,5000:113000,3500:115500,2500:118000,2000:121000,1700:124000,1500:127000,1300:131000,1000:137000},
        "watkins_glen":    {8000:107000,6000:110000,5000:112000,3500:114500,2500:117000,2000:120000,1700:123000,1500:126000,1300:130000,1000:136000},
        "suzuka":          {8000:122000,6000:125000,5000:127000,3500:129500,2500:132000,2000:135000,1700:138000,1500:141000,1300:145000,1000:151000},
        "cota":            {8000:120000,6000:123000,5000:125000,3500:127500,2500:130000,2000:133000,1700:136000,1500:139000,1300:143000,1000:149000},
        "valencia":        {8000:112000,6000:115000,5000:117000,3500:119500,2500:122000,2000:125000,1700:128000,1500:131000,1300:135000,1000:141000},
    }

    def laptime_to_elo(laptime_ms: int, track: str) -> int:
        """Ordnet Rundenzeit einem LFM-ELO-Wert zu."""
        ref = LFM_REF.get(track)
        if not ref or not laptime_ms or laptime_ms <= 0:
            return 1500  # Standard-Startwert
        brackets = sorted(ref.keys(), reverse=True)
        # Schneller als Alien → ELO = 8000 + Bonus
        if laptime_ms <= ref[8000]:
            delta = ref[8000] - laptime_ms
            return min(9500, 8000 + int(delta / ref[8000] * 3000))
        # Langsamer als Iron → ELO skaliert runter
        if laptime_ms >= ref[1000]:
            delta = laptime_ms - ref[1000]
            return max(200, 1000 - int(delta / ref[1000] * 800))
        # Interpolation zwischen den Brackets
        for i in range(len(brackets)-1):
            upper_elo = brackets[i]
            lower_elo = brackets[i+1]
            upper_ms  = ref[upper_elo]
            lower_ms  = ref[lower_elo]
            if upper_ms <= laptime_ms <= lower_ms:
                frac = (laptime_ms - upper_ms) / (lower_ms - upper_ms)
                return round(upper_elo - frac * (upper_elo - lower_elo))
        return 1500

    def lfm_license(elo: int, sessions: int):
        if sessions < 10: return "Rookie",   "#888888"
        if elo <  1000:   return "Iron",     "#b0b0b0"
        if elo <  1300:   return "Iron+",    "#c8c8c8"
        if elo <  1500:   return "Bronze",   "#cd7f32"
        if elo <  1700:   return "Bronze+",  "#d4893a"
        if elo <  2000:   return "Silver",   "#9ba3af"
        if elo <  2500:   return "Silver+",  "#c0c8d0"
        if elo <  3500:   return "Gold",     "#f5c842"
        if elo <  5000:   return "Gold+",    "#fad84e"
        if elo <  6000:   return "Platinum", "#00d4aa"
        if elo <  8000:   return "Legend",   "#7c6cfa"
        return "Alien", "#e8173a"

    # ── Beste Rundenzeit pro Fahrer pro Strecke ───────────────────────────────
    driver_bests = conn.execute("""
        SELECT steam_id, player_name, track, MIN(laptime_ms) as best_ms
        FROM laps WHERE valid=1 GROUP BY steam_id, track
    """).fetchall()

    # ── Speed-Rating: Durchschnittlicher laptime-ELO über alle Strecken ──────
    driver_speed = {}  # steam_id → {name, speed_elos, tracks}
    for r in driver_bests:
        sid = r["steam_id"]
        sp_elo = laptime_to_elo(r["best_ms"], r["track"])
        if sid not in driver_speed:
            driver_speed[sid] = {"name": r["player_name"], "speed_elos": [], "tracks": {}}
        driver_speed[sid]["speed_elos"].append(sp_elo)
        driver_speed[sid]["tracks"][r["track"]] = {
            "best_ms": r["best_ms"],
            "speed_elo": sp_elo,
            "laptime": ms(r["best_ms"])
        }

    # ── Positions-ELO: Klassisches paarweises ELO aus Rennergebnissen ────────
    sessions = conn.execute("""
        SELECT DISTINCT l.session_id, s.timestamp FROM laps l
        JOIN sessions s ON s.id=l.session_id
        WHERE l.valid=1 ORDER BY s.timestamp ASC
    """).fetchall()

    pos_elos = {}
    for sess in sessions:
        drivers = conn.execute("""
            SELECT steam_id, player_name, MIN(laptime_ms) as best_ms
            FROM laps WHERE session_id=? AND valid=1
            GROUP BY steam_id ORDER BY best_ms ASC
        """, (sess["session_id"],)).fetchall()
        if len(drivers) < 2: continue
        for d in drivers:
            if d["steam_id"] not in pos_elos:
                pos_elos[d["steam_id"]] = {"elo": 1500.0, "name": d["player_name"],
                                            "wins": 0, "sessions": 0, "podiums": 0}
        new_elos = {d["steam_id"]: pos_elos[d["steam_id"]]["elo"] for d in drivers}
        n = len(drivers)
        for i in range(n):
            sid_i = drivers[i]["steam_id"]
            sessions_i = pos_elos[sid_i]["sessions"]
            K = 64 if sessions_i < 5 else 48 if sessions_i < 15 else 36 if sessions_i < 30 else 24
            for j in range(i+1, n):
                sid_j = drivers[j]["steam_id"]
                ra = pos_elos[sid_i]["elo"]; rb = pos_elos[sid_j]["elo"]
                ea = 1 / (1 + 10**((rb-ra)/400))
                new_elos[sid_i] += K * (1 - ea)
                new_elos[sid_j] += K * (0 - (1-ea))
        for idx, d in enumerate(drivers):
            pos_elos[d["steam_id"]]["elo"] = max(100, new_elos[d["steam_id"]])
            pos_elos[d["steam_id"]]["sessions"] += 1
            if idx == 0: pos_elos[d["steam_id"]]["wins"] += 1
            if idx < 3:  pos_elos[d["steam_id"]]["podiums"] += 1

    conn.close()

    # ── Hybrid-ELO: 60% Speed-Rating + 40% Positions-ELO ────────────────────
    result = []
    all_sids = set(driver_speed.keys()) | set(pos_elos.keys())
    for sid in all_sids:
        sp = driver_speed.get(sid, {})
        po = pos_elos.get(sid, {})
        name = sp.get("name") or po.get("name") or sid

        avg_speed_elo = round(sum(sp.get("speed_elos", [1500])) / max(len(sp.get("speed_elos", [1])), 1))
        pos_elo_val   = round(po.get("elo", 1500))
        sessions_n    = po.get("sessions", 0)

        # Hybrid: mit wachsender Erfahrung mehr Gewicht auf Positions-ELO
        w_speed = max(0.4, 0.85 - sessions_n * 0.03)  # 85% → 40%
        w_pos   = 1 - w_speed
        hybrid  = round(w_speed * avg_speed_elo + w_pos * pos_elo_val)

        lic, col = lfm_license(hybrid, sessions_n)
        result.append({
            "steam_id": sid, "player_name": name,
            "elo": hybrid,
            "speed_elo": avg_speed_elo,
            "position_elo": pos_elo_val,
            "wins": po.get("wins", 0),
            "podiums": po.get("podiums", 0),
            "sessions": sessions_n,
            "license": lic, "license_color": col,
            "track_details": sp.get("tracks", {})
        })

    result.sort(key=lambda x: x["elo"], reverse=True)
    for i, r in enumerate(result): r["rank"] = i + 1
    return result

    conn = get_db()
    sessions = conn.execute("""
        SELECT DISTINCT l.session_id, s.timestamp FROM laps l
        JOIN sessions s ON s.id=l.session_id
        WHERE l.valid=1 ORDER BY s.timestamp ASC
    """).fetchall()

    elos = {}  # steam_id -> {elo, name, wins, sessions, podiums, best_finish, races_for_k}

    for sess in sessions:
        drivers = conn.execute("""
            SELECT steam_id, player_name, MIN(laptime_ms) as best_ms
            FROM laps WHERE session_id=? AND valid=1
            GROUP BY steam_id ORDER BY best_ms ASC
        """, (sess["session_id"],)).fetchall()
        if len(drivers) < 2: continue

        for d in drivers:
            if d["steam_id"] not in elos:
                elos[d["steam_id"]] = {
                    "elo": 1500.0,  # LFM Startpunkte
                    "name": d["player_name"],
                    "wins": 0, "sessions": 0, "podiums": 0
                }

        new_elos = {d["steam_id"]: elos[d["steam_id"]]["elo"] for d in drivers}
        n = len(drivers)

        for i in range(n):
            sid_i = drivers[i]["steam_id"]
            sessions_i = elos[sid_i]["sessions"]
            # LFM-ähnlicher K-Faktor: neue Fahrer volatiler
            if sessions_i < 5:    K = 64
            elif sessions_i < 15: K = 48
            elif sessions_i < 30: K = 36
            else:                 K = 24

            for j in range(i+1, n):
                sid_j = drivers[j]["steam_id"]
                ra = elos[sid_i]["elo"]
                rb = elos[sid_j]["elo"]
                ea = 1 / (1 + 10**((rb-ra)/400))
                # i ist schneller als j → score 1 für i
                new_elos[sid_i] += K * (1 - ea)
                new_elos[sid_j] += K * (0 - (1 - ea))

        for idx, d in enumerate(drivers):
            elos[d["steam_id"]]["elo"] = max(100, new_elos[d["steam_id"]])  # Minimum 100
            elos[d["steam_id"]]["sessions"] += 1
            if idx == 0: elos[d["steam_id"]]["wins"] += 1
            if idx < 3:  elos[d["steam_id"]]["podiums"] += 1

    conn.close()

    def lfm_license(elo, sessions):
        if sessions < 10: return "Rookie", "#888888"
        if elo < 1000:  return "Iron",     "#b0b0b0"
        if elo < 1300:  return "Iron+",    "#c0c0c0"
        if elo < 1500:  return "Bronze",   "#cd7f32"
        if elo < 1700:  return "Bronze+",  "#cd7f32"
        if elo < 2000:  return "Silver",   "#9ba3af"
        if elo < 2500:  return "Silver+",  "#c0c8d0"
        if elo < 3500:  return "Gold",     "#f5c842"
        if elo < 5000:  return "Gold+",    "#f5c842"
        if elo < 6000:  return "Platinum", "#00d4aa"
        if elo < 8000:  return "Legend",   "#7c6cfa"
        return "Alien", "#e8173a"

    result = []
    for sid, info in elos.items():
        elo_val = round(info["elo"])
        lic, col = lfm_license(elo_val, info["sessions"])
        result.append({
            "steam_id": sid, "player_name": info["name"],
            "elo": elo_val, "wins": info["wins"],
            "podiums": info["podiums"], "sessions": info["sessions"],
            "license": lic, "license_color": col
        })
    result.sort(key=lambda x: x["elo"], reverse=True)
    for i, r in enumerate(result): r["rank"] = i + 1
    return result


@app.get("/api/h2h/{id1}/{id2}")
def get_h2h(id1:str, id2:str):
    """Head-to-Head Vergleich zweier Fahrer auf allen gemeinsamen Strecken."""
    conn = get_db()
    n1 = conn.execute("SELECT player_name FROM laps WHERE steam_id=? LIMIT 1",(id1,)).fetchone()
    n2 = conn.execute("SELECT player_name FROM laps WHERE steam_id=? LIMIT 1",(id2,)).fetchone()
    name1 = n1["player_name"] if n1 else id1
    name2 = n2["player_name"] if n2 else id2
    tracks1 = {r["track"] for r in conn.execute("SELECT DISTINCT track FROM laps WHERE steam_id=? AND valid=1",(id1,)).fetchall()}
    tracks2 = {r["track"] for r in conn.execute("SELECT DISTINCT track FROM laps WHERE steam_id=? AND valid=1",(id2,)).fetchall()}
    common = sorted(tracks1 & tracks2)
    result = []; wins1 = 0; wins2 = 0
    for tr in common:
        r1 = conn.execute("SELECT MIN(laptime_ms) as best,MIN(s1_ms) as s1,MIN(s2_ms) as s2,MIN(s3_ms) as s3,COUNT(*) as laps FROM laps WHERE steam_id=? AND track=? AND valid=1",(id1,tr)).fetchone()
        r2 = conn.execute("SELECT MIN(laptime_ms) as best,MIN(s1_ms) as s1,MIN(s2_ms) as s2,MIN(s3_ms) as s3,COUNT(*) as laps FROM laps WHERE steam_id=? AND track=? AND valid=1",(id2,tr)).fetchone()
        if not r1["best"] or not r2["best"]: continue
        b1,b2 = r1["best"],r2["best"]
        winner = 1 if b1<b2 else 2
        if winner==1: wins1+=1
        else: wins2+=1
        delta = b1-b2
        result.append({"track":tr,"best1":ms(b1),"best2":ms(b2),
            "s1_1":ms(r1["s1"]),"s1_2":ms(r2["s1"]),
            "s2_1":ms(r1["s2"]),"s2_2":ms(r2["s2"]),
            "s3_1":ms(r1["s3"]),"s3_2":ms(r2["s3"]),
            "laps1":r1["laps"],"laps2":r2["laps"],
            "delta_ms":delta,"delta_str":("+"+ms(abs(delta)) if delta>0 else "-"+ms(abs(delta))) if delta!=0 else "=",
            "winner":winner})
    conn.close()
    return {"name1":name1,"name2":name2,"steam_id1":id1,"steam_id2":id2,
            "wins1":wins1,"wins2":wins2,"tracks":result}

@app.get("/api/improvement/{steam_id}")
def get_improvement(steam_id:str):
    """Verbesserungs-Tracker: erste vs. beste Zeit pro Strecke."""
    conn = get_db()
    tracks = conn.execute("SELECT DISTINCT track FROM laps WHERE steam_id=? AND valid=1",(steam_id,)).fetchall()
    result = []
    for t in tracks:
        tr = t["track"]
        first = conn.execute("SELECT laptime_ms,timestamp FROM laps WHERE steam_id=? AND track=? AND valid=1 ORDER BY timestamp ASC,laptime_ms ASC LIMIT 1",(steam_id,tr)).fetchone()
        best  = conn.execute("SELECT laptime_ms,timestamp FROM laps WHERE steam_id=? AND track=? AND valid=1 ORDER BY laptime_ms ASC LIMIT 1",(steam_id,tr)).fetchone()
        if first and best:
            delta = first["laptime_ms"] - best["laptime_ms"]
            pct = round(delta/first["laptime_ms"]*100, 2) if first["laptime_ms"]>0 else 0
            result.append({"track":tr,
                "first_ms":first["laptime_ms"],"first_laptime":ms(first["laptime_ms"]),"first_date":berlin(first["timestamp"]),
                "best_ms":best["laptime_ms"],"best_laptime":ms(best["laptime_ms"]),"best_date":berlin(best["timestamp"]),
                "improvement_ms":delta,"improvement_str":ms(delta) if delta>0 else "—","improvement_pct":pct,
                "improved":delta>0})
    conn.close()
    return result

@app.get("/api/last-session")
def get_last_session():
    """Letzte gefahrene Session mit allen Details."""
    conn = get_db()
    sess = conn.execute("SELECT * FROM sessions ORDER BY timestamp DESC LIMIT 1").fetchone()
    if not sess: conn.close(); return None
    s = dict(sess)
    s["timestamp_berlin"] = berlin(s["timestamp"])
    drivers = conn.execute("""
        SELECT steam_id, player_name, car,
               MIN(laptime_ms) as best_ms, MIN(s1_ms) as s1, MIN(s2_ms) as s2, MIN(s3_ms) as s3,
               COUNT(*) as laps
        FROM laps WHERE session_id=? AND valid=1
        GROUP BY steam_id ORDER BY best_ms ASC
    """, (s["id"],)).fetchall()
    leader = drivers[0]["best_ms"] if drivers else 0
    drv_list = []
    for i, d in enumerate(drivers):
        gap = d["best_ms"] - leader
        drv_list.append({**dict(d),"position":i+1,"best_laptime":ms(d["best_ms"]),
            "s1":ms(d["s1"]),"s2":ms(d["s2"]),"s3":ms(d["s3"]),
            "gap":f"+{ms(gap)}" if gap>0 else "—"})
    all_laps = conn.execute("SELECT COUNT(*) as total FROM laps WHERE session_id=? AND valid=1",(s["id"],)).fetchone()
    conn.close()
    s["drivers"] = drv_list
    s["total_laps"] = all_laps["total"] if all_laps else 0
    return s

@app.get("/api/my-stats/{steam_id}")
def get_my_stats(steam_id:str):
    """Persönliche Statistiken mit Sektor-Verlusten vs. Bestzeit."""
    conn = get_db()
    nm = conn.execute("SELECT player_name FROM laps WHERE steam_id=? LIMIT 1",(steam_id,)).fetchone()
    name = nm["player_name"] if nm else steam_id
    tracks = conn.execute("SELECT DISTINCT track FROM laps WHERE steam_id=? AND valid=1",(steam_id,)).fetchall()
    result = []
    for t in tracks:
        tr = t["track"]
        my = conn.execute("SELECT MIN(laptime_ms) as best,MIN(s1_ms) as s1,MIN(s2_ms) as s2,MIN(s3_ms) as s3,COUNT(*) as laps FROM laps WHERE steam_id=? AND track=? AND valid=1",(steam_id,tr)).fetchone()
        rec = conn.execute("SELECT MIN(laptime_ms) as best,MIN(s1_ms) as s1,MIN(s2_ms) as s2,MIN(s3_ms) as s3 FROM laps WHERE track=? AND valid=1",(tr,)).fetchone()
        if my["best"] and rec["best"]:
            gap = my["best"]-rec["best"]
            s1_loss = (my["s1"] or 0)-(rec["s1"] or 0)
            s2_loss = (my["s2"] or 0)-(rec["s2"] or 0)
            s3_loss = (my["s3"] or 0)-(rec["s3"] or 0)
            result.append({"track":tr,"my_best":ms(my["best"]),"my_best_ms":my["best"],
                "record_ms":rec["best"],"record_laptime":ms(rec["best"]),
                "gap_ms":gap,"gap_str":f"+{ms(gap)}" if gap>0 else "=",
                "s1_loss":s1_loss,"s1_loss_str":f"+{ms(s1_loss)}" if s1_loss>0 else ("=" if s1_loss==0 else ms(abs(s1_loss))),
                "s2_loss":s2_loss,"s2_loss_str":f"+{ms(s2_loss)}" if s2_loss>0 else ("=" if s2_loss==0 else ms(abs(s2_loss))),
                "s3_loss":s3_loss,"s3_loss_str":f"+{ms(s3_loss)}" if s3_loss>0 else ("=" if s3_loss==0 else ms(abs(s3_loss))),
                "laps":my["laps"]})
    conn.close()
    return {"steam_id":steam_id,"name":name,"tracks":result}

@app.get("/api/sync-time")
def get_sync_time():
    files = glob.glob(os.path.join(RESULTS_DIR,"*.json"))
    if not files: return {"sync_time":None,"sync_time_str":"Keine Daten"}
    latest = max(files,key=os.path.getmtime); ts = os.path.getmtime(latest)
    dt = datetime.fromtimestamp(ts,tz=TZ)
    return {"sync_time":ts,"sync_time_str":dt.strftime("%d.%m.%Y %H:%M")}

@app.post("/api/reload")
def reload(): ingest_all(); return {"status":"ok"}

@app.get("/health")
def health(): return {"status":"ok"}

# ═══════════════════════════════════════════════════════
# NEUE ENDPOINTS v7
# ═══════════════════════════════════════════════════════

@app.get("/api/activity")
def get_activity(limit:int=80, from_date:str=None, to_date:str=None):
    """Aktivitäts-Feed: neueste Runden mit PB/Rekord-Markierungen."""
    conn = get_db()
    q = """
        SELECT l.steam_id, l.player_name, l.track, l.car,
               l.laptime_ms, l.s1_ms, l.s2_ms, l.s3_ms,
               l.timestamp, s.is_wet, s.server_name,
               s.session_type
        FROM laps l JOIN sessions s ON s.id=l.session_id
        WHERE l.valid=1
    """
    p = []
    if from_date: q += " AND l.timestamp >= ?"; p.append(from_date)
    if to_date:   q += " AND l.timestamp <= ?"; p.append(to_date + "T23:59:59")
    q += " ORDER BY l.timestamp DESC LIMIT ?"
    p.append(limit)
    rows = conn.execute(q, p).fetchall()

    # Track records für PB-Markierung
    records = {}
    for r in conn.execute("SELECT track, MIN(laptime_ms) as best FROM laps WHERE valid=1 GROUP BY track").fetchall():
        records[r["track"]] = r["best"]

    # Personal bests per driver per track
    pb = {}
    for r in conn.execute("SELECT steam_id, track, MIN(laptime_ms) as best FROM laps WHERE valid=1 GROUP BY steam_id, track").fetchall():
        pb[(r["steam_id"], r["track"])] = r["best"]

    result = []
    for r in rows:
        is_record = r["laptime_ms"] == records.get(r["track"])
        is_pb     = r["laptime_ms"] == pb.get((r["steam_id"], r["track"]))
        result.append({
            **dict(r),
            "laptime":     ms(r["laptime_ms"]),
            "is_pb":       is_pb,
            "is_record":   is_record,
            "timestamp_berlin": berlin(r["timestamp"])
        })
    conn.close()
    return result

@app.get("/api/championship")
def get_championship():
    """F1-Punktesystem basierend auf Session-Ergebnissen."""
    PTS = [25,18,15,12,10,8,6,4,2,1]
    conn = get_db()
    sessions = conn.execute("""
        SELECT DISTINCT l.session_id, s.track, s.timestamp, s.is_wet
        FROM laps l JOIN sessions s ON s.id=l.session_id
        WHERE l.valid=1 ORDER BY s.timestamp ASC
    """).fetchall()

    standings = {}  # steam_id → {name, points, wins, podiums, sessions, results[]}
    session_results = []

    for sess in sessions:
        drivers = conn.execute("""
            SELECT steam_id, player_name, MIN(laptime_ms) as best_ms
            FROM laps WHERE session_id=? AND valid=1
            GROUP BY steam_id ORDER BY best_ms ASC
        """, (sess["session_id"],)).fetchall()
        if len(drivers) < 2: continue

        sr = {"track": sess["track"], "timestamp": berlin(sess["timestamp"]),
              "is_wet": sess["is_wet"], "results": []}
        for idx, d in enumerate(drivers):
            sid = d["steam_id"]
            pts = PTS[idx] if idx < len(PTS) else 0
            if sid not in standings:
                standings[sid] = {"player_name": d["player_name"], "points": 0,
                                  "wins": 0, "podiums": 0, "sessions": 0, "best_finish": 99}
            standings[sid]["points"]  += pts
            standings[sid]["sessions"] += 1
            if idx == 0: standings[sid]["wins"] += 1
            if idx < 3:  standings[sid]["podiums"] += 1
            standings[sid]["best_finish"] = min(standings[sid]["best_finish"], idx+1)
            sr["results"].append({"steam_id": sid, "name": d["player_name"],
                                   "position": idx+1, "points": pts, "laptime": ms(d["best_ms"])})
        session_results.append(sr)

    conn.close()
    result = [{"steam_id": sid, **info} for sid, info in standings.items()]
    result.sort(key=lambda x: (-x["points"], x["wins"]*-1))
    for i, r in enumerate(result): r["rank"] = i + 1
    return {"standings": result, "sessions": session_results}

@app.get("/api/achievements/{steam_id}")
def get_achievements(steam_id: str):
    """Errungenschaften für einen Fahrer."""
    conn = get_db()
    def q1(sql, p=[]): return conn.execute(sql, p).fetchone()
    def qa(sql, p=[]): return conn.execute(sql, p).fetchall()

    total_laps    = q1("SELECT COUNT(*) as c FROM laps WHERE steam_id=? AND valid=1", [steam_id])["c"]
    total_tracks  = q1("SELECT COUNT(DISTINCT track) as c FROM laps WHERE steam_id=? AND valid=1", [steam_id])["c"]
    total_wins    = 0
    sessions_data = qa("""SELECT DISTINCT session_id FROM laps WHERE steam_id=? AND valid=1""", [steam_id])
    wet_sessions  = q1("SELECT COUNT(*) as c FROM sessions s JOIN laps l ON l.session_id=s.id WHERE l.steam_id=? AND s.is_wet=1", [steam_id])["c"]
    penalties     = q1("SELECT COUNT(*) as c FROM penalties WHERE steam_id=?", [steam_id])["c"]
    records_held  = q1("""
        SELECT COUNT(*) as c FROM (
          SELECT track, MIN(laptime_ms) as best FROM laps WHERE steam_id=? AND valid=1 GROUP BY track
        ) my JOIN (
          SELECT track, MIN(laptime_ms) as best FROM laps WHERE valid=1 GROUP BY track
        ) glb ON my.track=glb.track WHERE my.best=glb.best
    """, [steam_id])["c"]
    # Best consistency
    best_con = q1("""
        SELECT track, COUNT(*) as laps, AVG(laptime_ms) as avg_ms,
               AVG((laptime_ms-(SELECT AVG(laptime_ms) FROM laps l2 WHERE l2.steam_id=laps.steam_id AND l2.track=laps.track AND l2.valid=1))*(laptime_ms-(SELECT AVG(laptime_ms) FROM laps l2 WHERE l2.steam_id=laps.steam_id AND l2.track=laps.track AND l2.valid=1))) as variance
        FROM laps WHERE steam_id=? AND valid=1 GROUP BY track HAVING COUNT(*)>=5 ORDER BY variance ASC LIMIT 1
    """, [steam_id])
    # Count wins
    for sess in sessions_data:
        best_in_sess = q1("SELECT steam_id FROM laps WHERE session_id=? AND valid=1 GROUP BY steam_id ORDER BY MIN(laptime_ms) ASC LIMIT 1", [sess["steam_id"] if False else sess[0]])
        if best_in_sess and best_in_sess[0] == steam_id: total_wins += 1

    # Improvement
    max_improvement = q1("""
        SELECT MAX(improvement) as best FROM (
          SELECT track,
            (SELECT laptime_ms FROM laps WHERE steam_id=? AND track=l.track AND valid=1 ORDER BY timestamp ASC LIMIT 1) -
            MIN(laptime_ms) as improvement
          FROM laps l WHERE steam_id=? AND valid=1 GROUP BY track
        )
    """, [steam_id, steam_id])["best"] or 0

    conn.close()

    ACHIEVEMENTS = [
        ("🏆","Erster Sieg","Gewinne deine erste Session",total_wins>=1),
        ("🎯","Hat-Trick","3+ Sessions gewonnen",total_wins>=3),
        ("👑","Pole-König","5+ Sessions gewonnen",total_wins>=5),
        ("🔥","Centurion","100+ Runden gefahren",total_laps>=100),
        ("🌍","Globetrotter","5+ verschiedene Strecken",total_tracks>=5),
        ("💧","Regenmeister","In Nass-Conditions gefahren",wet_sessions>=1),
        ("🏅","Streckenrekord","Mindestens 1 Streckenrekord halten",records_held>=1),
        ("⚡","Multi-Rekord","3+ Streckenrekorde halten",records_held>=3),
        ("🎖","Sauber","0 Strafen registriert",penalties==0),
        ("📈","Verbesserer","10+ Sekunden auf einer Strecke verbessert",max_improvement>=10000),
    ]
    return [{"emoji":a[0],"name":a[1],"desc":a[2],"earned":a[3]} for a in ACHIEVEMENTS]

@app.get("/api/weather-stats")
def get_weather_stats():
    """Nass vs. Trocken Vergleich pro Fahrer."""
    conn = get_db()
    drivers = conn.execute("SELECT DISTINCT steam_id, player_name FROM laps WHERE valid=1").fetchall()
    result = []
    for d in drivers:
        sid = d["steam_id"]
        dry = conn.execute("SELECT AVG(laptime_ms) as avg, MIN(laptime_ms) as best, COUNT(*) as laps FROM laps l JOIN sessions s ON s.id=l.session_id WHERE l.steam_id=? AND l.valid=1 AND s.is_wet=0", [sid]).fetchone()
        wet = conn.execute("SELECT AVG(laptime_ms) as avg, MIN(laptime_ms) as best, COUNT(*) as laps FROM laps l JOIN sessions s ON s.id=l.session_id WHERE l.steam_id=? AND l.valid=1 AND s.is_wet=1", [sid]).fetchone()
        if not dry["laps"]: continue
        result.append({
            "steam_id": sid, "player_name": d["player_name"],
            "dry_laps": dry["laps"], "dry_best": ms(dry["best"]), "dry_avg": ms(int(dry["avg"] or 0)),
            "wet_laps": wet["laps"] if wet else 0,
            "wet_best": ms(wet["best"]) if wet and wet["best"] else "—",
            "wet_avg": ms(int(wet["avg"])) if wet and wet["avg"] else "—",
            "prefers_wet": (wet["laps"] or 0) > 0
        })
    conn.close()
    return result

@app.get("/api/stint/{session_id}/{steam_id}")
def get_stint(session_id: str, steam_id: str):
    """Alle Runden eines Fahrers in einer Session (Stint-Analyse)."""
    conn = get_db()
    laps = conn.execute("""
        SELECT laptime_ms, s1_ms, s2_ms, s3_ms, valid, timestamp
        FROM laps WHERE session_id=? AND steam_id=? ORDER BY rowid ASC
    """, (session_id, steam_id)).fetchall()
    conn.close()
    result = []
    best = None
    for i, l in enumerate(laps):
        t = l["laptime_ms"]
        is_pb = l["valid"] and (best is None or t < best)
        if is_pb and l["valid"]: best = t
        result.append({**dict(l), "lap_num": i+1, "laptime": ms(t),
                       "is_pb": is_pb, "valid": bool(l["valid"])})
    return result

@app.get("/api/server-status")
def get_server_status():
    """
    Server-Status: kombiniert TCP-Check + Sync-Zeit.
    Grün = Server erreichbar (TCP ODER letzter Sync < 10min).
    """
    import socket
    SERVER_IP = "152.53.47.94"
    PORTS = {"Neuzeit Day Dry": 9600, "Neuzeit Day Wet": 9601, "Server 3": 9602}

    # TCP-Check (klappt wenn Windows-Firewall TCP erlaubt)
    results = {}
    any_tcp = False
    for name, port in PORTS.items():
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(2)
            r = s.connect_ex((SERVER_IP, port))
            s.close()
            online = (r == 0)
        except:
            online = False
        results[name] = {"online": online, "port": port}
        if online: any_tcp = True

    # Sync-Zeit prüfen: wenn letzter Sync < 15min → Server war erreichbar
    last_sync_str = None
    sync_recent = False
    try:
        conn = get_db()
        row = conn.execute(
            "SELECT value FROM config WHERE key='last_sync_time'"
        ).fetchone()
        conn.close()
        if row:
            last_sync_str = row["value"]
            from datetime import datetime as dt2
            last_sync_dt = dt2.fromisoformat(last_sync_str)
            diff_min = (dt2.now() - last_sync_dt).total_seconds() / 60
            sync_recent = diff_min < 15
    except: pass

    # Spieler aus neuester Session (alle, nicht nur gültige Runden)
    player_count = 0
    try:
        conn = get_db()
        row = conn.execute("""
            SELECT COUNT(DISTINCT steam_id) as c FROM laps
            WHERE session_id = (
                SELECT id FROM sessions ORDER BY timestamp DESC LIMIT 1
            )
        """).fetchone()
        conn.close()
        if row: player_count = row["c"]
    except: pass

    # Online = TCP klappt ODER letzter Sync war kürzlich
    any_online = any_tcp or sync_recent

    return {
        "servers": results,
        "ip": SERVER_IP,
        "any_online": any_online,
        "any_tcp": any_tcp,
        "sync_recent": sync_recent,
        "last_sync": last_sync_str,
        "player_count": player_count
    }


@app.post("/api/backup")
def create_backup():
    """Erstellt ein Backup der Datenbank."""
    import shutil
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = DB_PATH.replace(".db", f"_backup_{ts}.db")
    try:
        shutil.copy2(DB_PATH, backup_path)
        size = os.path.getsize(backup_path)
        return {"ok": True, "path": backup_path, "size_kb": round(size/1024, 1), "timestamp": ts}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/api/sparklines/{steam_id}")
def get_sparklines(steam_id: str):
    """Letzte 6 Bestzeiten pro Strecke für Sparkline-Charts."""
    conn = get_db()
    tracks = conn.execute("SELECT DISTINCT track FROM laps WHERE steam_id=? AND valid=1", [steam_id]).fetchall()
    result = {}
    for t in tracks:
        tr = t["track"]
        sessions = conn.execute("""
            SELECT session_id, MIN(laptime_ms) as best FROM laps
            WHERE steam_id=? AND track=? AND valid=1
            GROUP BY session_id ORDER BY MIN(timestamp) ASC
        """, [steam_id, tr]).fetchall()
        result[tr] = [r["best"] for r in sessions[-6:]]
    conn.close()
    return result

# ═══════════════════════════════════════════════════════
# NEUE ENDPOINTS — Feature-Update 2
# ═══════════════════════════════════════════════════════

import hashlib, hmac as _hmac

# ── DB-Schema erweitern ──
def migrate_v2():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS notes (
            session_id TEXT, text TEXT, timestamp TEXT,
            PRIMARY KEY(session_id)
        );
        CREATE TABLE IF NOT EXISTS goals (
            steam_id TEXT, track TEXT, target_ms INTEGER,
            created TEXT,
            PRIMARY KEY(steam_id, track)
        );
        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE, color TEXT
        );
        CREATE TABLE IF NOT EXISTS team_members (
            team_id INTEGER, steam_id TEXT,
            PRIMARY KEY(team_id, steam_id)
        );
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY, value TEXT
        );
    """)
    conn.commit(); conn.close()

try: migrate_v2()
except: pass

# last_sync_time initialisieren wenn noch nicht gesetzt
try:
    _conn = get_db()
    if not _conn.execute("SELECT value FROM config WHERE key='last_sync_time'").fetchone():
        _conn.execute("INSERT OR REPLACE INTO config VALUES (?,?)",
                     ("last_sync_time", datetime.now().isoformat()))
        _conn.commit()
    _conn.close()
except: pass

def cfg_get(key, default=None):
    conn = get_db()
    r = conn.execute("SELECT value FROM config WHERE key=?", (key,)).fetchone()
    conn.close()
    return r["value"] if r else default

def cfg_set(key, value):
    conn = get_db()
    conn.execute("INSERT OR REPLACE INTO config VALUES (?,?)", (key, str(value)))
    conn.commit(); conn.close()

# ── Admin-Passwort ──
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

security = HTTPBasic(auto_error=False)

def check_auth(creds: HTTPBasicCredentials = Depends(security)):
    pw = cfg_get("admin_password", "")
    if not pw: return True  # kein Passwort gesetzt = offen
    if not creds: raise HTTPException(status_code=401, headers={"WWW-Authenticate": "Basic"})
    ok = _hmac.compare_digest(creds.password, pw)
    if not ok: raise HTTPException(status_code=403)
    return True

@app.post("/api/config/password")
def set_password(body: dict):
    cfg_set("admin_password", body.get("password",""))
    return {"ok": True}

@app.get("/api/config/sync-interval")
def get_sync_interval():
    return {"minutes": int(cfg_get("sync_interval", 5))}

@app.post("/api/config/sync-interval")
def set_sync_interval(body: dict):
    m = max(1, min(60, int(body.get("minutes", 5))))
    cfg_set("sync_interval", m)
    # Crontab updaten
    try:
        import subprocess
        line = f"*/{m} * * * * /home/detrees95/acc-dashboard/acc-sync.sh"
        subprocess.run(["bash","-c",f'(crontab -l 2>/dev/null | grep -v acc-sync; echo "{line}") | crontab -'], check=False)
    except: pass
    return {"ok": True, "minutes": m}

# ── Podium-Tracker ──
@app.get("/api/podium")
def get_podium():
    conn = get_db()
    sessions = conn.execute("""
        SELECT DISTINCT l.session_id, s.track FROM laps l
        JOIN sessions s ON s.id=l.session_id WHERE l.valid=1
    """).fetchall()
    stats = {}
    for sess in sessions:
        order = conn.execute("""
            SELECT steam_id, player_name, MIN(laptime_ms) as best
            FROM laps WHERE session_id=? AND valid=1
            GROUP BY steam_id ORDER BY best ASC
        """, (sess["session_id"],)).fetchall()
        if len(order) < 2: continue
        for i, d in enumerate(order[:3]):
            sid = d["steam_id"]
            if sid not in stats:
                stats[sid] = {"player_name": d["player_name"], "p1":0,"p2":0,"p3":0,"sessions":0,"wins_tracks":{}}
            stats[sid]["sessions"] += 1
            key = ["p1","p2","p3"][i]
            stats[sid][key] += 1
            if i == 0:
                t = sess["track"]
                stats[sid]["wins_tracks"][t] = stats[sid]["wins_tracks"].get(t,0)+1
        for d in order[3:]:
            sid = d["steam_id"]
            if sid not in stats:
                stats[sid] = {"player_name": d["player_name"], "p1":0,"p2":0,"p3":0,"sessions":0,"wins_tracks":{}}
            stats[sid]["sessions"] += 1
    conn.close()
    result = [{"steam_id":k,**v} for k,v in stats.items()]
    result.sort(key=lambda x: (-x["p1"],-x["p2"],-x["p3"]))
    return result

# ── Renndauer-Analyse ──
@app.get("/api/race-analysis")
def get_race_analysis():
    conn = get_db()
    rows = conn.execute("""
        SELECT s.track, s.session_type, s.timestamp, s.is_wet,
               COUNT(l.id) as lap_count,
               COUNT(DISTINCT l.steam_id) as drivers,
               AVG(l.laptime_ms) as avg_lap,
               MIN(l.laptime_ms) as best_lap,
               SUM(l.laptime_ms) as total_ms
        FROM sessions s JOIN laps l ON l.session_id=s.id AND l.valid=1
        WHERE s.session_type='R'
        GROUP BY s.id ORDER BY s.timestamp DESC LIMIT 30
    """).fetchall()
    conn.close()
    return [{
        **dict(r),
        "avg_lap_str": ms(int(r["avg_lap"] or 0)),
        "best_lap_str": ms(r["best_lap"]),
        "total_str": ms(r["total_ms"]),
        "total_min": round((r["total_ms"] or 0)/60000, 1),
        "timestamp_berlin": berlin(r["timestamp"])
    } for r in rows]

# ── Form-Kurve ──
@app.get("/api/form/{steam_id}")
def get_form(steam_id: str):
    conn = get_db()
    tracks = conn.execute(
        "SELECT DISTINCT track FROM laps WHERE steam_id=? AND valid=1", [steam_id]
    ).fetchall()
    result = {}
    for t in tracks:
        tr = t["track"]
        sessions = conn.execute("""
            SELECT session_id, MIN(laptime_ms) as best, MIN(timestamp) as ts
            FROM laps WHERE steam_id=? AND track=? AND valid=1
            GROUP BY session_id ORDER BY ts ASC
        """, [steam_id, tr]).fetchall()
        if len(sessions) < 2: continue
        points = [{"session": i+1, "best": r["best"], "laptime": ms(r["best"]), "ts": berlin(r["ts"])}
                  for i, r in enumerate(sessions)]
        # Trend: positive = improving (lower time)
        first_avg = sum(p["best"] for p in points[:len(points)//2]) / max(1,len(points)//2)
        last_avg  = sum(p["best"] for p in points[len(points)//2:]) / max(1,len(points)-len(points)//2)
        trend = "improving" if last_avg < first_avg else "declining" if last_avg > first_avg * 1.005 else "stable"
        result[tr] = {"points": points, "trend": trend,
                       "improvement_ms": int(first_avg - last_avg),
                       "improvement_str": ms(abs(int(first_avg-last_avg)))}
    conn.close()
    return result

# ── Sektor-Rekorde Timeline ──
@app.get("/api/sector-timeline/{track}")
def get_sector_timeline(track: str):
    conn = get_db()
    # Chronologisch beste S1/S2/S3 und gesamt
    laps = conn.execute("""
        SELECT l.steam_id, l.player_name, l.s1_ms, l.s2_ms, l.s3_ms,
               l.laptime_ms, l.timestamp
        FROM laps l WHERE l.track=? AND l.valid=1 AND l.s1_ms>0 AND l.s2_ms>0 AND l.s3_ms>0
        ORDER BY l.timestamp ASC
    """, (track,)).fetchall()
    best_s1=best_s2=best_s3=best_lap=None
    records = []
    for lap in laps:
        changed = False
        if not best_s1 or lap["s1_ms"] < best_s1:
            best_s1=lap["s1_ms"]; changed=True
        if not best_s2 or lap["s2_ms"] < best_s2:
            best_s2=lap["s2_ms"]; changed=True
        if not best_s3 or lap["s3_ms"] < best_s3:
            best_s3=lap["s3_ms"]; changed=True
        if not best_lap or lap["laptime_ms"] < best_lap:
            best_lap=lap["laptime_ms"]; changed=True
        if changed:
            records.append({
                "ts": berlin(lap["timestamp"]),
                "driver": lap["player_name"],
                "s1": ms(best_s1), "s2": ms(best_s2), "s3": ms(best_s3),
                "lap": ms(best_lap),
                "s1_ms":best_s1,"s2_ms":best_s2,"s3_ms":best_s3,"lap_ms":best_lap
            })
    conn.close()
    return records

# ── Fahrzeug-Statistik ──
@app.get("/api/car-stats/{track}")
def get_car_stats(track: str):
    conn = get_db()
    rows = conn.execute("""
        SELECT car, COUNT(*) as laps, COUNT(DISTINCT steam_id) as drivers,
               MIN(laptime_ms) as best_ms, AVG(laptime_ms) as avg_ms
        FROM laps WHERE track=? AND valid=1 AND laptime_ms>0
        GROUP BY car ORDER BY best_ms ASC
    """, (track,)).fetchall()
    conn.close()
    if not rows: return []
    leader = rows[0]["best_ms"]
    return [{**dict(r),"best":ms(r["best_ms"]),"avg":ms(int(r["avg_ms"] or 0)),
             "gap_ms":r["best_ms"]-leader,"gap":ms(r["best_ms"]-leader)} for r in rows]

# ── Session-Notizen ──
@app.get("/api/notes/{session_id}")
def get_note(session_id: str):
    conn = get_db()
    r = conn.execute("SELECT * FROM notes WHERE session_id=?", (session_id,)).fetchone()
    conn.close()
    return dict(r) if r else {"session_id": session_id, "text": ""}

@app.post("/api/notes/{session_id}")
def save_note(session_id: str, body: dict):
    conn = get_db()
    conn.execute("INSERT OR REPLACE INTO notes VALUES (?,?,?)",
                 (session_id, body.get("text",""), datetime.now().isoformat()))
    conn.commit(); conn.close()
    return {"ok": True}

# ── Persönliche Ziele ──
@app.get("/api/goals/{steam_id}")
def get_goals(steam_id: str):
    conn = get_db()
    rows = conn.execute("SELECT * FROM goals WHERE steam_id=?", (steam_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/goals/{steam_id}")
def save_goal(steam_id: str, body: dict):
    track = body.get("track","")
    tms   = body.get("target_ms", 0)
    conn  = get_db()
    if tms:
        conn.execute("INSERT OR REPLACE INTO goals VALUES (?,?,?,?)",
                     (steam_id, track, int(tms), datetime.now().isoformat()))
    else:
        conn.execute("DELETE FROM goals WHERE steam_id=? AND track=?", (steam_id, track))
    conn.commit(); conn.close()
    return {"ok": True}

# ── Teams ──
@app.get("/api/teams")
def get_teams():
    conn = get_db()
    teams = conn.execute("SELECT * FROM teams").fetchall()
    result = []
    for t in teams:
        members = conn.execute("""
            SELECT tm.steam_id, nm.player_name FROM team_members tm
            LEFT JOIN name_map nm ON nm.steam_id=tm.steam_id
            WHERE tm.team_id=?
        """, (t["id"],)).fetchall()
        result.append({**dict(t), "members": [dict(m) for m in members]})
    conn.close()
    return result

@app.post("/api/teams")
def save_team(body: dict):
    conn = get_db()
    name   = body.get("name","")
    color  = body.get("color","#bf5af2")
    members= body.get("members",[])
    tid = body.get("id")
    if tid:
        conn.execute("UPDATE teams SET name=?,color=? WHERE id=?", (name,color,tid))
        conn.execute("DELETE FROM team_members WHERE team_id=?", (tid,))
    else:
        cur = conn.execute("INSERT INTO teams (name,color) VALUES (?,?)", (name,color))
        tid = cur.lastrowid
    for sid in members:
        try: conn.execute("INSERT OR IGNORE INTO team_members VALUES (?,?)", (tid, sid))
        except: pass
    conn.commit(); conn.close()
    return {"ok": True, "id": tid}

@app.delete("/api/teams/{tid}")
def delete_team(tid: int):
    conn = get_db()
    conn.execute("DELETE FROM team_members WHERE team_id=?", (tid,))
    conn.execute("DELETE FROM teams WHERE id=?", (tid,))
    conn.commit(); conn.close()
    return {"ok": True}

@app.get("/api/team-standings")
def get_team_standings():
    conn = get_db()
    teams = conn.execute("SELECT * FROM teams").fetchall()
    PTS = [25,18,15,12,10,8,6,4,2,1]
    result = []
    for team in teams:
        members = [r["steam_id"] for r in conn.execute(
            "SELECT steam_id FROM team_members WHERE team_id=?", (team["id"],)).fetchall()]
        if not members: continue
        points = 0
        sessions = conn.execute("""
            SELECT DISTINCT session_id FROM laps WHERE steam_id IN ({})
        """.format(",".join("?"*len(members))), members).fetchall()
        for sess in sessions:
            order = conn.execute("""
                SELECT steam_id, MIN(laptime_ms) as best FROM laps
                WHERE session_id=? AND valid=1 GROUP BY steam_id ORDER BY best ASC
            """, (sess["session_id"],)).fetchall()
            if len(order) < 2: continue
            for i, d in enumerate(order):
                if d["steam_id"] in members:
                    points += PTS[i] if i < len(PTS) else 0
        result.append({**dict(team), "points": points, "members": members})
    result.sort(key=lambda x: -x["points"])
    conn.close()
    return result

# ── Auto-Backup scheduled ──
import threading

def auto_backup_loop():
    import time, shutil
    while True:
        interval = int(cfg_get("backup_interval_h", 24))
        time.sleep(interval * 3600)
        try:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            shutil.copy2(DB_PATH, DB_PATH.replace(".db", f"_auto_{ts}.db"))
            # Alte Backups löschen (nur 7 behalten)
            import glob as _glob
            baks = sorted(_glob.glob(DB_PATH.replace(".db","_auto_*.db")))
            for old in baks[:-7]: os.remove(old)
        except: pass

threading.Thread(target=auto_backup_loop, daemon=True).start()

def auto_sync_loop():
    """Führt acc-sync.sh automatisch aus – kein Crontab nötig."""
    import subprocess, time
    SYNC_SCRIPT = "/home/detrees95/acc-dashboard/acc-sync.sh"
    while True:
        try:
            interval_min = int(cfg_get("sync_interval", 5))
        except:
            interval_min = 5
        time.sleep(interval_min * 60)
        try:
            if os.path.exists(SYNC_SCRIPT):
                result = subprocess.run(
                    ["bash", SYNC_SCRIPT],
                    capture_output=True, text=True, timeout=120
                )
                # Sync-Zeit speichern
                conn = get_db()
                conn.execute("INSERT OR REPLACE INTO config VALUES (?,?)",
                             ("last_sync_time", datetime.now().isoformat()))
                conn.commit()
                conn.close()
                # DB neu einlesen
                try: ingest_all()
                except: pass
        except Exception as e:
            pass  # Stille Fehler – nächster Versuch beim nächsten Intervall

threading.Thread(target=auto_sync_loop, daemon=True).start()


# ── Live-Timing (Datei-basiert, kein UDP nötig) ──
from fastapi.responses import StreamingResponse
import asyncio

@app.get("/api/live")
async def live_timing():
    """Server-Sent Events: live Daten aus dem neuesten JSON auf dem Pi."""
    async def event_stream():
        seen = set()
        while True:
            try:
                conn = get_db()
                # Neueste Session
                last = conn.execute(
                    "SELECT * FROM sessions ORDER BY timestamp DESC LIMIT 1"
                ).fetchone()
                if last:
                    sid = last["id"]
                    rows = conn.execute("""
                        SELECT l.steam_id, l.player_name, l.car,
                               l.laptime_ms, l.s1_ms, l.s2_ms, l.s3_ms,
                               l.valid, l.timestamp
                        FROM laps l WHERE l.session_id=?
                        ORDER BY l.timestamp DESC LIMIT 50
                    """, (sid,)).fetchall()
                    # Nur neue Runden senden
                    new_laps = [r for r in rows if r["timestamp"] not in seen]
                    if new_laps:
                        for r in new_laps:
                            seen.add(r["timestamp"])
                        payload = json.dumps({
                            "session": dict(last) | {"timestamp_berlin": berlin(last["timestamp"])},
                            "laps": [{**dict(r), "laptime": ms(r["laptime_ms"])} for r in new_laps],
                            "ts": datetime.now().isoformat()
                        })
                        yield f"data: {payload}\n\n"
                conn.close()
            except Exception as e:
                yield f"data: {{\"error\":\"{str(e)}\"}}\n\n"
            await asyncio.sleep(5)  # alle 5 Sekunden prüfen

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )

@app.get("/api/live-poll")
def live_poll():
    """Schneller Live-Polling Endpoint – liefert aktuelle Session + alle Runden."""
    conn = get_db()
    
    # Neueste Session
    last = conn.execute(
        "SELECT * FROM sessions ORDER BY timestamp DESC LIMIT 1"
    ).fetchone()
    
    if not last:
        conn.close()
        return {"session": None, "drivers": [], "laps": []}
    
    sid = last["id"]
    
    # Alle Runden dieser Session, neueste zuerst
    laps = conn.execute("""
        SELECT l.steam_id, l.player_name, l.car,
               l.laptime_ms, l.s1_ms, l.s2_ms, l.s3_ms, l.valid,
               l.timestamp, l.rowid as lid
        FROM laps l
        WHERE l.session_id = ?
        ORDER BY l.rowid DESC
        LIMIT 200
    """, (sid,)).fetchall()
    
    # Bestzeiten pro Fahrer berechnen
    driver_bests = {}
    for lap in laps:
        sid2 = lap["steam_id"]
        if sid2 not in driver_bests:
            driver_bests[sid2] = {
                "steam_id": sid2,
                "player_name": lap["player_name"],
                "car": lap["car"],
                "best_ms": None,
                "last_lap_ms": lap["laptime_ms"],
                "last_lap": ms(lap["laptime_ms"]),
                "laps": 0,
                "last_valid": bool(lap["valid"])
            }
        d = driver_bests[sid2]
        d["laps"] += 1
        if lap["valid"] and (d["best_ms"] is None or lap["laptime_ms"] < d["best_ms"]):
            d["best_ms"] = lap["laptime_ms"]
    
    for d in driver_bests.values():
        d["best"] = ms(d["best_ms"]) if d["best_ms"] else "—"
    
    drivers = sorted(driver_bests.values(), 
                     key=lambda x: x["best_ms"] if x["best_ms"] else 999999999)
    leader_ms = drivers[0]["best_ms"] if drivers and drivers[0]["best_ms"] else None
    for i, d in enumerate(drivers):
        d["position"] = i + 1
        d["gap"] = ms(d["best_ms"] - leader_ms) if d["best_ms"] and leader_ms else "—"
    
    conn.close()
    return {
        "session": {
            **dict(last),
            "timestamp_berlin": berlin(last["timestamp"]),
            "track_name": tn_py(last["track"]),
            "session_type_name": {"FP":"Training","Q":"Qualifying","R":"Rennen"}.get(last["session_type"], last["session_type"])
        },
        "drivers": drivers,
        "laps": [{
            **dict(lap),
            "laptime": ms(lap["laptime_ms"]),
            "s1": ms(lap["s1_ms"]) if lap["s1_ms"] else "—",
            "s2": ms(lap["s2_ms"]) if lap["s2_ms"] else "—",
            "s3": ms(lap["s3_ms"]) if lap["s3_ms"] else "—",
        } for lap in laps[:50]],
        "total_laps": len(laps)
    }

def tn_py(t):
    names = {"nurburgring_24h":"Nürburgring 24h","nurburgring":"Nürburgring",
             "spa":"Spa-Francorchamps","monza":"Monza","brands_hatch":"Brands Hatch",
             "imola":"Imola","misano":"Misano","barcelona":"Barcelona",
             "silverstone":"Silverstone","hungaroring":"Hungaroring",
             "zandvoort":"Zandvoort","zolder":"Zolder","paul_ricard":"Paul Ricard",
             "mount_panorama":"Mount Panorama","red_bull_ring":"Red Bull Ring"}
    return names.get(t, t.replace("_"," ").title())

# ═══════════════════════════════════════════════════════
# ACC Broadcasting Connector (UDP Live-Timing)
# Verbindet sich mit dem ACC Dedicated Server via UDP
# Broadcasting API (Kunos Simulazione SDK)
# ═══════════════════════════════════════════════════════

import struct, asyncio, threading
from enum import IntEnum

class _MsgType(IntEnum):
    REGISTER_COMMAND_APPLICATION = 1
    UNREGISTER_COMMAND_APPLICATION = 9
    REQUEST_ENTRY_LIST = 10
    REQUEST_TRACK_DATA = 11
    CHANGE_HUD_PAGE = 49
    CHANGE_FOCUS = 50
    INSTANT_REPLAY_REQUEST = 51
    PLAY_MANUAL_REPLAY_HIGHLIGHT = 52
    SAVE_MANUAL_REPLAY_HIGHLIGHT = 60
    # Incoming
    REGISTRATION_RESULT = 1
    REALTIME_UPDATE = 2
    REALTIME_CAR_UPDATE = 3
    ENTRY_LIST = 4
    TRACK_DATA = 5
    ENTRY_LIST_CAR = 6
    BROADCASTING_EVENT = 7

# Live-Data Store
_acc_live = {
    "connected": False,
    "connecting": False,
    "session_type": None,
    "session_phase": None,
    "track": None,
    "cars": {},          # carId → {carNumber, drivers, bestLap, currentLap, ...}
    "connection_id": None,
    "error": None,
    "server_ip": None,
    "server_port": None,
}

def _read_string(buf, pos):
    length = struct.unpack_from('<H', buf, pos)[0]
    pos += 2
    s = buf[pos:pos+length].decode('utf-8', errors='replace')
    return s, pos + length

def _write_string(s):
    b = s.encode('utf-8')
    return struct.pack('<H', len(b)) + b

def _build_register(display_name, conn_pw, cmd_pw, interval_ms, protocol_ver=4):
    data  = struct.pack('<BB', _MsgType.REGISTER_COMMAND_APPLICATION, protocol_ver)
    data += _write_string(display_name)
    data += _write_string(conn_pw)
    data += _write_string(cmd_pw)
    data += struct.pack('<H', interval_ms)
    return data

async def _acc_connector_task(ip, port, conn_pw, cmd_pw, interval_ms):
    global _acc_live
    loop = asyncio.get_event_loop()
    transport = None

    class ACCProtocol(asyncio.DatagramProtocol):
        def __init__(self):
            self.transport = None

        def connection_made(self, t):
            self.transport = t
            # Send registration
            reg = _build_register("ACC-Dashboard-Pi", conn_pw, cmd_pw, interval_ms)
            t.sendto(reg)
            _acc_live["connecting"] = True
            _acc_live["error"] = None

        def datagram_received(self, data, addr):
            try:
                msg_type = data[0]
                if msg_type == 1:  # REGISTRATION_RESULT
                    conn_id = struct.unpack_from('<I', data, 1)[0]
                    ok = data[5]
                    if ok:
                        _acc_live["connected"] = True
                        _acc_live["connecting"] = False
                        _acc_live["connection_id"] = conn_id
                        # Request track + entry list
                        self.transport.sendto(struct.pack('<BI', _MsgType.REQUEST_ENTRY_LIST, conn_id))
                        self.transport.sendto(struct.pack('<BI', _MsgType.REQUEST_TRACK_DATA, conn_id))
                    else:
                        msg, _ = _read_string(data, 6)
                        _acc_live["connected"] = False
                        _acc_live["connecting"] = False
                        _acc_live["error"] = msg
                elif msg_type == 2:  # REALTIME_UPDATE
                    pos = 1
                    event_idx = struct.unpack_from('<H', data, pos)[0]; pos += 2
                    session_idx = struct.unpack_from('<H', data, pos)[0]; pos += 2
                    session_type = data[pos]; pos += 1
                    phase = data[pos]; pos += 1
                    types = {0:'FP', 1:'Q', 2:'R', 3:'FP', 4:'Q', 10:'R'}
                    phases = {0:'NONE', 1:'STARTING', 2:'PRE_FORMATION', 3:'FORMATION_LAP',
                              4:'PRE_SESSION', 5:'SESSION', 6:'SESSION_OVER', 7:'POST_SESSION', 8:'RESULT_UI'}
                    _acc_live["session_type"] = types.get(session_type, str(session_type))
                    _acc_live["session_phase"] = phases.get(phase, str(phase))
                elif msg_type == 3:  # REALTIME_CAR_UPDATE
                    pos = 1
                    car_id = struct.unpack_from('<H', data, pos)[0]; pos += 2
                    driver_idx = data[pos]; pos += 1
                    driver_count = data[pos]; pos += 1
                    gear = data[pos] - 2; pos += 1
                    yaw = struct.unpack_from('<f', data, pos)[0]; pos += 4
                    pitch = struct.unpack_from('<f', data, pos)[0]; pos += 4
                    roll = struct.unpack_from('<f', data, pos)[0]; pos += 4
                    car_location = data[pos]; pos += 1
                    speed_kmh = struct.unpack_from('<H', data, pos)[0]; pos += 2
                    pos_u = struct.unpack_from('<I', data, pos)[0]; pos += 4  # position unused
                    delta = struct.unpack_from('<i', data, pos)[0]; pos += 4
                    best_ms = struct.unpack_from('<i', data, pos)[0]; pos += 4
                    last_ms = struct.unpack_from('<i', data, pos)[0]; pos += 4
                    if car_id not in _acc_live["cars"]:
                        _acc_live["cars"][car_id] = {"car_id": car_id}
                    car = _acc_live["cars"][car_id]
                    car["speed_kmh"] = speed_kmh
                    car["gear"] = gear
                    car["delta_ms"] = delta
                    car["best_ms"] = best_ms if best_ms > 0 else None
                    car["last_ms"] = last_ms if last_ms > 0 else None
                    car["location"] = car_location
                elif msg_type == 6:  # ENTRY_LIST_CAR
                    pos = 1
                    car_id = struct.unpack_from('<H', data, pos)[0]; pos += 2
                    model = data[pos]; pos += 1
                    cup_cat = data[pos]; pos += 1
                    car_number = struct.unpack_from('<H', data, pos)[0]; pos += 2
                    pos += 1  # nationality
                    driver_count2 = data[pos]; pos += 1
                    drivers = []
                    for _ in range(driver_count2):
                        fn, pos = _read_string(data, pos)
                        ln, pos = _read_string(data, pos)
                        sid, pos = _read_string(data, pos)
                        nat = data[pos]; pos += 1
                        cat = data[pos]; pos += 1
                        drivers.append({"first_name": fn, "last_name": ln, "steam_id": sid})
                    if car_id not in _acc_live["cars"]:
                        _acc_live["cars"][car_id] = {"car_id": car_id}
                    _acc_live["cars"][car_id]["drivers"] = drivers
                    _acc_live["cars"][car_id]["car_number"] = car_number
                elif msg_type == 5:  # TRACK_DATA
                    pos = 5  # skip connection id
                    track_name, pos = _read_string(data, pos)
                    _acc_live["track"] = track_name
            except Exception as e:
                pass

        def error_received(self, exc):
            _acc_live["error"] = str(exc)

        def connection_lost(self, exc):
            _acc_live["connected"] = False
            _acc_live["connecting"] = False
            if exc:
                _acc_live["error"] = str(exc)

    try:
        transport, protocol = await loop.create_datagram_endpoint(
            ACCProtocol, remote_addr=(ip, port)
        )
        # Keep alive – send heartbeat every 5s
        while _acc_live.get("_keep_running"):
            await asyncio.sleep(5)
            if _acc_live.get("connection_id") and transport:
                try:
                    transport.sendto(struct.pack('<BI',
                        _MsgType.REQUEST_ENTRY_LIST, _acc_live["connection_id"]))
                except: pass
    except Exception as e:
        _acc_live["error"] = str(e)
        _acc_live["connected"] = False
        _acc_live["connecting"] = False
    finally:
        if transport:
            try: transport.close()
            except: pass

_acc_loop = None
_acc_thread = None

def _start_acc_event_loop():
    global _acc_loop
    _acc_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_acc_loop)
    _acc_loop.run_forever()

@app.post("/api/acc-connect")
def acc_connect(body: dict):
    """Verbindet sich mit dem ACC Broadcasting Server."""
    global _acc_thread, _acc_loop

    ip       = body.get("ip", "152.53.47.94")
    port     = int(body.get("port", 9600))
    conn_pw  = body.get("password", "")
    cmd_pw   = body.get("command_password", "")
    interval = int(body.get("interval_ms", 250))

    # Stop any existing connection
    _acc_live["_keep_running"] = False
    _acc_live["connected"] = False
    _acc_live["cars"] = {}

    # Start event loop thread if not running
    if _acc_thread is None or not _acc_thread.is_alive():
        _acc_thread = threading.Thread(target=_start_acc_event_loop, daemon=True)
        _acc_thread.start()
        import time; time.sleep(0.2)

    # Schedule connection on the event loop
    _acc_live["_keep_running"] = True
    _acc_live["connecting"] = True
    _acc_live["server_ip"] = ip
    _acc_live["server_port"] = port

    asyncio.run_coroutine_threadsafe(
        _acc_connector_task(ip, port, conn_pw, cmd_pw, interval),
        _acc_loop
    )
    return {"ok": True, "message": f"Verbinde mit {ip}:{port}…"}

@app.post("/api/acc-disconnect")
def acc_disconnect():
    """Trennt die ACC Broadcasting Verbindung."""
    _acc_live["_keep_running"] = False
    _acc_live["connected"] = False
    _acc_live["connecting"] = False
    _acc_live["cars"] = {}
    return {"ok": True}

@app.get("/api/acc-live-data")
def acc_live_data():
    """Gibt aktuelle Live-Daten aus dem Broadcasting Stream zurück."""
    cars = list(_acc_live.get("cars", {}).values())
    # Sortieren nach beste Runde
    def sort_key(c):
        return c.get("best_ms") or 999999999
    cars.sort(key=sort_key)

    return {
        "connected":     _acc_live.get("connected", False),
        "connecting":    _acc_live.get("connecting", False),
        "error":         _acc_live.get("error"),
        "session_type":  _acc_live.get("session_type"),
        "session_phase": _acc_live.get("session_phase"),
        "track":         _acc_live.get("track"),
        "player_count":  len(cars),
        "cars": [{
            "car_id":     c.get("car_id"),
            "car_number": c.get("car_number"),
            "drivers":    c.get("drivers", []),
            "speed_kmh":  c.get("speed_kmh", 0),
            "gear":       c.get("gear", 0),
            "best_ms":    c.get("best_ms"),
            "best":       ms(c["best_ms"]) if c.get("best_ms") else "—",
            "last_ms":    c.get("last_ms"),
            "last":       ms(c["last_ms"]) if c.get("last_ms") else "—",
            "delta_ms":   c.get("delta_ms", 0),
        } for c in cars]
    }


# ── ACC Server Verwaltung ──────────────────────────────
@app.get("/api/acc-servers")
def get_acc_servers():
    """
    Liest ALLE Server automatisch aus den accweb Config-Dateien.
    Fällt zurück auf manuell konfigurierte Server falls keine Configs da sind.
    """
    import socket, glob as _glob

    CFG_DIR = "/home/detrees95/acc-configs"
    SERVER_IP = "152.53.47.94"

    servers = []

    # ── Automatisch aus accweb Config-Dateien lesen ──
    # Dateien heißen: {folder_id}_settings.json, {folder_id}_configuration.json, {folder_id}_event.json
    settings_files = _glob.glob(f"{CFG_DIR}/*_settings.json")

    for sf in settings_files:
        folder_id = os.path.basename(sf).replace("_settings.json", "")
        try:
            with open(sf, encoding="utf-8") as f:
                settings = json.load(f)
        except:
            continue

        # Configuration (Ports)
        cfg_file = f"{CFG_DIR}/{folder_id}_configuration.json"
        udp_port = 9600
        try:
            with open(cfg_file, encoding="utf-8") as f:
                config = json.load(f)
            udp_port = config.get("udpPort", config.get("tcpPort", 9600))
        except: pass

        # Event (Strecke)
        event_file = f"{CFG_DIR}/{folder_id}_event.json"
        track = ""
        try:
            with open(event_file, encoding="utf-8") as f:
                event = json.load(f)
            track = event.get("track", "")
        except: pass

        name = settings.get("serverName", f"Server {folder_id}")
        password = settings.get("password", "")

        servers.append({
            "id": folder_id,
            "name": name,
            "ip": SERVER_IP,
            "port": udp_port,
            "password": password,
            "track": track,
            "source": "accweb"
        })

    # ── Fallback: manuell konfigurierte Server aus DB ──
    if not servers:
        conn = get_db()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS acc_servers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT, ip TEXT, port INTEGER,
                password TEXT DEFAULT '', sort_order INTEGER DEFAULT 0
            )
        """)
        count = conn.execute("SELECT COUNT(*) as c FROM acc_servers").fetchone()["c"]
        if count == 0:
            defaults = [
                ("Neuzeit Day Dry",   "152.53.47.94", 9600, "123R321", 1),
                ("Neuzeit Day Wet",   "152.53.47.94", 9601, "123R321", 2),
                ("Neuzeit Night Dry", "152.53.47.94", 9603, "123R321", 3),
            ]
            for n, ip, p, pw, o in defaults:
                conn.execute("INSERT INTO acc_servers (name,ip,port,password,sort_order) VALUES (?,?,?,?,?)",
                             (n, ip, p, pw, o))
            conn.commit()
        rows = conn.execute("SELECT * FROM acc_servers ORDER BY sort_order, id").fetchall()
        conn.close()
        servers = [{**dict(r), "source": "manual"} for r in rows]

    # ── Online-Status per TCP prüfen ──
    result = []
    for s in servers:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1.5)
            online = sock.connect_ex((s["ip"], int(s["port"]))) == 0
            sock.close()
        except:
            online = False
        result.append({**s, "online": online})

    # Sortieren: online zuerst, dann nach Port
    result.sort(key=lambda x: (not x["online"], x["port"]))
    return result

@app.post("/api/acc-servers")
def save_acc_server(body: dict):
    """Server hinzufügen oder bearbeiten."""
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS acc_servers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, ip TEXT NOT NULL,
            port INTEGER NOT NULL, password TEXT DEFAULT '',
            sort_order INTEGER DEFAULT 0
        )
    """)
    sid = body.get("id")
    name = body.get("name", "")
    ip   = body.get("ip", "152.53.47.94")
    port = int(body.get("port", 9600))
    pw   = body.get("password", "")
    order = int(body.get("sort_order", 99))

    if sid:
        conn.execute(
            "UPDATE acc_servers SET name=?,ip=?,port=?,password=?,sort_order=? WHERE id=?",
            (name, ip, port, pw, order, sid)
        )
    else:
        conn.execute(
            "INSERT INTO acc_servers (name,ip,port,password,sort_order) VALUES (?,?,?,?,?)",
            (name, ip, port, pw, order)
        )
    conn.commit()
    conn.close()
    return {"ok": True}

@app.delete("/api/acc-servers/{sid}")
def delete_acc_server(sid: int):
    """Server entfernen."""
    conn = get_db()
    conn.execute("DELETE FROM acc_servers WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return {"ok": True}

# ═══════════════════════════════════════════════════════
# Manuelle Zeit-Einträge (für verlorene Sessions)
# ═══════════════════════════════════════════════════════

def parse_laptime(s):
    """Wandelt '8:29.102' oder '1:52.985' oder '92985' in Millisekunden um."""
    s = str(s).strip()
    if not s:
        return 0
    # Reine Millisekunden-Zahl?
    if s.isdigit():
        return int(s)
    # Format M:SS.mmm oder MM:SS.mmm
    try:
        if ":" in s:
            minutes, rest = s.split(":", 1)
            if "." in rest:
                seconds, millis = rest.split(".", 1)
                millis = (millis + "000")[:3]  # auf 3 Stellen auffüllen
            else:
                seconds, millis = rest, "0"
            return int(minutes) * 60000 + int(seconds) * 1000 + int(millis)
        # Nur SS.mmm
        if "." in s:
            seconds, millis = s.split(".", 1)
            millis = (millis + "000")[:3]
            return int(seconds) * 1000 + int(millis)
    except:
        return 0
    return 0

@app.post("/api/manual-lap")
def add_manual_lap(body: dict):
    """
    Trägt eine Zeit manuell ein (für verlorene/nicht gespeicherte Sessions).
    Erwartet: player_name, steam_id, track, car_model, laptime,
              optional: s1, s2, s3, session_type, date
    """
    player_name = (body.get("player_name") or "").strip()
    steam_id    = nid((body.get("steam_id") or "").strip())
    track       = (body.get("track") or "").strip()
    car_model   = int(body.get("car_model", -1))
    laptime_ms  = parse_laptime(body.get("laptime", "0"))

    # Sektoren optional
    s1 = parse_laptime(body.get("s1", "0"))
    s2 = parse_laptime(body.get("s2", "0"))
    s3 = parse_laptime(body.get("s3", "0"))

    session_type = (body.get("session_type") or "FP").strip()
    date_str     = (body.get("date") or "").strip()

    # Validierung
    if not player_name:
        return {"ok": False, "error": "Fahrername fehlt"}
    if not track:
        return {"ok": False, "error": "Strecke fehlt"}
    if car_model < 0 or car_model not in CAR:
        return {"ok": False, "error": "Ungültiges Auto"}
    if laptime_ms <= 0:
        return {"ok": False, "error": "Ungültige Rundenzeit (Format: 8:29.102)"}

    # Steam-ID generieren falls leer (eindeutig pro Fahrername)
    if not steam_id or steam_id == "S":
        import hashlib
        steam_id = "MANUAL_" + hashlib.md5(player_name.encode()).hexdigest()[:16]

    car_name = CAR.get(car_model, f"Car #{car_model}")

    # Zeitstempel
    if date_str:
        try:
            timestamp = datetime.fromisoformat(date_str).isoformat()
        except:
            timestamp = datetime.now().isoformat()
    else:
        timestamp = datetime.now().isoformat()

    # Eindeutige Session-ID für manuelle Einträge
    session_id = f"manual_{datetime.now().strftime('%Y%m%d%H%M%S')}_{steam_id[:8]}"

    conn = get_db()

    # Session anlegen
    conn.execute(
        "INSERT OR IGNORE INTO sessions VALUES (?,?,?,?,?,?,?,?,?)",
        (session_id, track, session_type, "Manueller Eintrag", 0, 0, 0, timestamp, "")
    )

    # Lap eintragen
    try:
        conn.execute("""
            INSERT OR IGNORE INTO laps
            (session_id,steam_id,player_name,track,car,car_model,laptime_ms,s1_ms,s2_ms,s3_ms,valid,timestamp)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """, (session_id, steam_id, player_name, track, car_name, car_model,
              laptime_ms, s1, s2, s3, 1, timestamp))

        # Fahrer + name_map pflegen
        parts = player_name.split(" ", 1)
        fn = parts[0]
        ln = parts[1] if len(parts) > 1 else ""
        conn.execute("INSERT OR IGNORE INTO drivers VALUES (?,?,?,?,?)",
                     (steam_id, fn, ln, fn[:3].upper(), 0))
        conn.execute("INSERT OR REPLACE INTO name_map VALUES (?,?)", (steam_id, player_name))

        conn.commit()
    except Exception as e:
        conn.close()
        return {"ok": False, "error": str(e)}

    conn.close()
    return {
        "ok": True,
        "message": f"{player_name} · {car_name} · {track} · {ms(laptime_ms)}",
        "laptime_str": ms(laptime_ms),
        "steam_id": steam_id
    }

@app.get("/api/manual-laps")
def list_manual_laps():
    """Listet alle manuell eingetragenen Zeiten (zum Verwalten/Löschen)."""
    conn = get_db()
    rows = conn.execute("""
        SELECT l.id, l.player_name, l.track, l.car, l.car_model,
               l.laptime_ms, l.timestamp, l.session_id
        FROM laps l
        WHERE l.session_id LIKE 'manual_%'
        ORDER BY l.timestamp DESC
    """).fetchall()
    conn.close()
    return [{
        **dict(r),
        "laptime_str": ms(r["laptime_ms"]),
        "date_str": berlin(r["timestamp"])
    } for r in rows]

@app.delete("/api/manual-lap/{lap_id}")
def delete_manual_lap(lap_id: int):
    """Löscht einen manuellen Eintrag."""
    conn = get_db()
    row = conn.execute("SELECT session_id FROM laps WHERE id=? AND session_id LIKE 'manual_%'", (lap_id,)).fetchone()
    if not row:
        conn.close()
        return {"ok": False, "error": "Nicht gefunden oder kein manueller Eintrag"}
    conn.execute("DELETE FROM laps WHERE id=?", (lap_id,))
    conn.execute("DELETE FROM sessions WHERE id=? AND id NOT IN (SELECT DISTINCT session_id FROM laps)", (row["session_id"],))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.get("/api/car-list")
def get_car_list():
    """Gibt die Auto-Liste zurück (für Dropdown im Formular)."""
    return [{"model": k, "name": v} for k, v in sorted(CAR.items())]
