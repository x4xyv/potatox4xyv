import sqlite3
import os

# اسم ملف قاعدة البيانات (يمكن تغييره حسب الحاجة)
DATABASE = os.environ.get('DATABASE_PATH', 'database.db')

def get_db():
    """
    إنشاء اتصال بقاعدة البيانات وإرجاعه.
    تمكين row_factory للوصول إلى الأعمدة بالاسم.
    """
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    # تفعيل دعم المفاتيح الأجنبية
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    """
    تهيئة قاعدة البيانات: إنشاء الجداول والفهارس إذا لم تكن موجودة.
    تُستدعى مرة واحدة عند بدء تشغيل التطبيق.
    """
    conn = get_db()
    
    # جدول المستخدمين
    conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            created_at INTEGER NOT NULL
        )
    ''')
    
    # جدول الأقسام
    conn.execute('''
        CREATE TABLE IF NOT EXISTS sections (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            unit TEXT DEFAULT '',
            color TEXT DEFAULT '#f5c842',
            icon TEXT DEFAULT '📁',
            pinned INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
        )
    ''')
    
    # جدول العمليات (السجلات)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS records (
            id TEXT PRIMARY KEY,
            section_id TEXT NOT NULL,
            op TEXT NOT NULL,
            num REAL,
            label TEXT DEFAULT '',
            note TEXT DEFAULT '',
            ts INTEGER NOT NULL,
            pinned INTEGER DEFAULT 0,
            FOREIGN KEY (section_id) REFERENCES sections (id) ON DELETE CASCADE
        )
    ''')
    
    # إنشاء الفهارس لتحسين أداء الاستعلامات المتكررة
    # فهرس على user_id في جدول sections لتسريع جلب أقسام المستخدم
    conn.execute('CREATE INDEX IF NOT EXISTS idx_sections_user_id ON sections(user_id)')
    
    # فهرس على section_id في جدول records لتسريع جلب عمليات قسم معين
    conn.execute('CREATE INDEX IF NOT EXISTS idx_records_section_id ON records(section_id)')
    
    # (اختياري) فهرس مركب لترتيب العمليات حسب pin ثم التاريخ
    conn.execute('CREATE INDEX IF NOT EXISTS idx_records_section_pin_ts ON records(section_id, pinned DESC, ts ASC)')
    
    conn.commit()
    conn.close()
    print("✅ تم تهيئة قاعدة البيانات بنجاح (مع الفهارس).")

# للاختبار المباشر عند تشغيل الملف
if __name__ == '__main__':
    init_db()