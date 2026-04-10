import sqlite3
import time

DB_PATH = "hassab.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        created_at INTEGER
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS sections (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        name TEXT,
        unit TEXT,
        color TEXT,
        icon TEXT,
        pinned INTEGER DEFAULT 0,
        created_at INTEGER
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        section_id TEXT,
        op TEXT,
        num REAL,
        label TEXT,
        note TEXT,
        ts INTEGER,
        pinned INTEGER DEFAULT 0
    )''')
    conn.commit()
    conn.close()

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn