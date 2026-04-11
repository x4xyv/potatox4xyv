import sqlite3

DB_PATH = "hassab.db"


def init_db():
    conn = sqlite3.connect(DB_PATH)
    # WAL mode: أسرع للقراءة المتزامنة
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    c = conn.cursor()

    c.execute('''CREATE TABLE IF NOT EXISTS users (
        user_id    INTEGER PRIMARY KEY,
        created_at INTEGER NOT NULL
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS sections (
        id         TEXT    PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        name       TEXT    NOT NULL,
        unit       TEXT    DEFAULT '',
        color      TEXT    DEFAULT '#f5c842',
        icon       TEXT    DEFAULT '📁',
        pinned     INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS records (
        id         TEXT    PRIMARY KEY,
        section_id TEXT    NOT NULL,
        op         TEXT    NOT NULL DEFAULT '+',
        num        REAL    NOT NULL DEFAULT 0,
        label      TEXT    DEFAULT '',
        note       TEXT    DEFAULT '',
        ts         INTEGER NOT NULL,
        pinned     INTEGER DEFAULT 0
    )''')

    # فهارس للأداء — تُسرِّع الاستعلامات بشكل كبير
    c.execute("CREATE INDEX IF NOT EXISTS idx_sections_user       ON sections(user_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_sections_user_pin   ON sections(user_id, pinned)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_records_section     ON records(section_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_records_section_ts  ON records(section_id, ts)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_records_section_pin ON records(section_id, pinned)")

    conn.commit()
    conn.close()


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn
