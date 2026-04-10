from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_caching import Cache
import uuid
import time
import sqlite3
from database import init_db, get_db

app = Flask(__name__)
CORS(app)

# إعداد التخزين المؤقت (في الذاكرة)
app.config['CACHE_TYPE'] = 'SimpleCache'
app.config['CACHE_DEFAULT_TIMEOUT'] = 60  # ثانية واحدة للاختبار، يمكن زيادتها إلى 300
cache = Cache(app)

init_db()

# ---------- دوال مساعدة ----------
def get_user_data(user_id):
    conn = get_db()
    user = conn.execute("SELECT 1 FROM users WHERE user_id = ?", (user_id,)).fetchone()
    if not user:
        conn.execute("INSERT INTO users (user_id, created_at) VALUES (?, ?)",
                     (user_id, int(time.time() * 1000)))
        conn.commit()
    conn.close()

def calculate_section_total(section_id):
    """حساب المجموع التراكمي لعمليات قسم معين"""
    conn = get_db()
    rows = conn.execute(
        "SELECT op, num FROM records WHERE section_id = ?",
        (section_id,)
    ).fetchall()
    conn.close()
    total = 0.0
    for row in rows:
        op = row['op']
        num = float(row['num']) if row['num'] is not None else 0
        if op == '+':
            total += num
        elif op == '-':
            total -= num
        elif op == '*':
            total *= num
        elif op == '/':
            if num != 0:
                total /= num
        # يمكن إضافة عمليات أخرى
    return total

def clear_section_cache(section_id):
    """مسح الكاش المرتبط بقسم معين"""
    # نمط مفتاح الكاش في memoize هو (function_name, args...)
    cache.delete_memoized(get_sections_internal, section_id)
    cache.delete_memoized(get_records_internal, section_id)
    cache.delete_memoized(get_section_summary, section_id)

# ---------- دوال داخلية للحصول على البيانات مع الكاش ----------
@cache.memoize(60)
def get_sections_internal(user_id):
    """جلب الأقسام الخاصة بمستخدم (مع إمكانية تضمين المجموع)"""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM sections WHERE user_id = ? ORDER BY pinned DESC, name COLLATE NOCASE",
        (user_id,)
    ).fetchall()
    sections = [dict(row) for row in rows]
    conn.close()
    return sections

@cache.memoize(60)
def get_records_internal(section_id):
    """جلب عمليات قسم معين"""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM records WHERE section_id = ? ORDER BY pinned DESC, ts ASC",
        (section_id,)
    ).fetchall()
    records = [dict(row) for row in rows]
    conn.close()
    return records

@cache.memoize(30)  # مدة أقصر للمجموع لأنه يتغير كثيراً
def get_section_summary(section_id):
    """إرجاع ملخص القسم (المجموع وعدد العمليات)"""
    conn = get_db()
    count_row = conn.execute(
        "SELECT COUNT(*) as cnt FROM records WHERE section_id = ?",
        (section_id,)
    ).fetchone()
    count = count_row['cnt'] if count_row else 0
    conn.close()
    total = calculate_section_total(section_id)
    return {"total": total, "count": count}

# ---------- الأقسام ----------
@app.route('/api/sections', methods=['GET'])
def get_sections():
    user_id = request.headers.get('X-Telegram-User-Id')
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 401
    user_id = int(user_id)
    get_user_data(user_id)

    # جلب الأقسام من الكاش
    sections = get_sections_internal(user_id)

    # إذا طلب تضمين المجموع (؟include_summary=true)
    include_summary = request.args.get('include_summary', 'false').lower() == 'true'
    if include_summary:
        for sec in sections:
            summary = get_section_summary(sec['id'])
            sec['total'] = summary['total']
            sec['record_count'] = summary['count']
    return jsonify(sections)

@app.route('/api/sections', methods=['POST'])
def create_section():
    user_id = request.headers.get('X-Telegram-User-Id')
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 401
    user_id = int(user_id)
    data = request.get_json()
    name = data.get('name')
    if not name:
        return jsonify({"error": "Name required"}), 400
    section_id = str(uuid.uuid4())
    unit = data.get('unit', '')
    color = data.get('color', '#f5c842')
    icon = data.get('icon', '📁')
    conn = get_db()
    conn.execute(
        "INSERT INTO sections (id, user_id, name, unit, color, icon, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (section_id, user_id, name, unit, color, icon, 0, int(time.time() * 1000))
    )
    conn.commit()
    conn.close()

    # مسح كاش الأقسام لهذا المستخدم
    cache.delete_memoized(get_sections_internal, user_id)

    return jsonify({"id": section_id, "message": "created"}), 201

@app.route('/api/sections/<section_id>', methods=['DELETE'])
def delete_section(section_id):
    user_id = request.headers.get('X-Telegram-User-Id')
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 401
    user_id = int(user_id)
    conn = get_db()
    # التحقق من الملكية
    sec = conn.execute("SELECT user_id FROM sections WHERE id = ?", (section_id,)).fetchone()
    if not sec or sec['user_id'] != user_id:
        conn.close()
        return jsonify({"error": "Forbidden"}), 403

    conn.execute("DELETE FROM records WHERE section_id = ?", (section_id,))
    conn.execute("DELETE FROM sections WHERE id = ?", (section_id,))
    conn.commit()
    conn.close()

    # مسح الكاش
    clear_section_cache(section_id)
    cache.delete_memoized(get_sections_internal, user_id)

    return jsonify({"message": "deleted"})

@app.route('/api/sections/<section_id>/pin', methods=['PATCH'])
def pin_section(section_id):
    user_id = request.headers.get('X-Telegram-User-Id')
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 401
    user_id = int(user_id)
    conn = get_db()
    cur = conn.execute("SELECT pinned FROM sections WHERE id = ? AND user_id = ?", (section_id, user_id))
    row = cur.fetchone()
    if row:
        new_pin = 0 if row['pinned'] else 1
        conn.execute("UPDATE sections SET pinned = ? WHERE id = ?", (new_pin, section_id))
        conn.commit()
    conn.close()

    # تحديث الكاش
    cache.delete_memoized(get_sections_internal, user_id)
    return jsonify({"message": "ok"})

# ---------- نقطة نهاية جديدة: ملخص قسم ----------
@app.route('/api/sections/<section_id>/summary', methods=['GET'])
def section_summary(section_id):
    user_id = request.headers.get('X-Telegram-User-Id')
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 401
    user_id = int(user_id)
    # التحقق من ملكية القسم
    conn = get_db()
    sec = conn.execute("SELECT 1 FROM sections WHERE id = ? AND user_id = ?", (section_id, user_id)).fetchone()
    conn.close()
    if not sec:
        return jsonify({"error": "Forbidden"}), 403

    summary = get_section_summary(section_id)
    return jsonify(summary)

# ---------- العمليات ----------
@app.route('/api/records', methods=['GET'])
def get_records():
    section_id = request.args.get('section_id')
    if not section_id:
        return jsonify({"error": "section_id required"}), 400
    user_id = request.headers.get('X-Telegram-User-Id')
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 401
    user_id = int(user_id)

    # التحقق من ملكية القسم (مرة واحدة، ثم نستخدم الكاش)
    conn = get_db()
    sec = conn.execute("SELECT 1 FROM sections WHERE id = ? AND user_id = ?", (section_id, user_id)).fetchone()
    conn.close()
    if not sec:
        return jsonify({"error": "Forbidden"}), 403

    records = get_records_internal(section_id)
    return jsonify(records)

@app.route('/api/records', methods=['POST'])
def add_record():
    user_id = request.headers.get('X-Telegram-User-Id')
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 401
    user_id = int(user_id)
    data = request.get_json()
    section_id = data.get('section_id')
    op = data.get('op')
    num = data.get('num')
    label = data.get('label', '')
    note = data.get('note', '')
    if not section_id or not op or num is None:
        return jsonify({"error": "Missing fields"}), 400

    conn = get_db()
    sec = conn.execute("SELECT 1 FROM sections WHERE id = ? AND user_id = ?", (section_id, user_id)).fetchone()
    if not sec:
        conn.close()
        return jsonify({"error": "Forbidden"}), 403

    record_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO records (id, section_id, op, num, label, note, ts, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (record_id, section_id, op, num, label, note, int(time.time() * 1000), 0)
    )
    conn.commit()
    conn.close()

    # إبطال الكاش لهذا القسم
    clear_section_cache(section_id)

    return jsonify({"id": record_id, "message": "created"}), 201

@app.route('/api/records/<record_id>', methods=['PUT'])
def update_record(record_id):
    user_id = request.headers.get('X-Telegram-User-Id')
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 401
    user_id = int(user_id)
    data = request.get_json()
    op = data.get('op')
    num = data.get('num')
    label = data.get('label', '')
    note = data.get('note', '')
    conn = get_db()
    row = conn.execute('''SELECT sections.id as section_id, sections.user_id FROM records 
                          JOIN sections ON records.section_id = sections.id 
                          WHERE records.id = ?''', (record_id,)).fetchone()
    if not row or row['user_id'] != user_id:
        conn.close()
        return jsonify({"error": "Forbidden"}), 403

    section_id = row['section_id']
    conn.execute("UPDATE records SET op=?, num=?, label=?, note=? WHERE id=?",
                 (op, num, label, note, record_id))
    conn.commit()
    conn.close()

    clear_section_cache(section_id)
    return jsonify({"message": "updated"})

@app.route('/api/records/<record_id>', methods=['DELETE'])
def delete_record(record_id):
    user_id = request.headers.get('X-Telegram-User-Id')
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 401
    user_id = int(user_id)
    conn = get_db()
    row = conn.execute('''SELECT sections.id as section_id, sections.user_id FROM records 
                          JOIN sections ON records.section_id = sections.id 
                          WHERE records.id = ?''', (record_id,)).fetchone()
    if not row or row['user_id'] != user_id:
        conn.close()
        return jsonify({"error": "Forbidden"}), 403

    section_id = row['section_id']
    conn.execute("DELETE FROM records WHERE id = ?", (record_id,))
    conn.commit()
    conn.close()

    clear_section_cache(section_id)
    return jsonify({"message": "deleted"})

@app.route('/api/records/<record_id>/pin', methods=['PATCH'])
def pin_record(record_id):
    user_id = request.headers.get('X-Telegram-User-Id')
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 401
    user_id = int(user_id)
    conn = get_db()
    row = conn.execute('''SELECT sections.id as section_id, records.pinned FROM records 
                          JOIN sections ON records.section_id = sections.id 
                          WHERE records.id = ? AND sections.user_id = ?''', (record_id, user_id)).fetchone()
    if row:
        new_pin = 0 if row['pinned'] else 1
        conn.execute("UPDATE records SET pinned = ? WHERE id = ?", (new_pin, record_id))
        conn.commit()
        section_id = row['section_id']
        conn.close()
        clear_section_cache(section_id)
    else:
        conn.close()
        return jsonify({"error": "Forbidden"}), 403
    return jsonify({"message": "ok"})

@app.route('/api/sections/<section_id>/clear', methods=['DELETE'])
def clear_records(section_id):
    user_id = request.headers.get('X-Telegram-User-Id')
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 401
    user_id = int(user_id)
    conn = get_db()
    sec = conn.execute("SELECT 1 FROM sections WHERE id = ? AND user_id = ?", (section_id, user_id)).fetchone()
    if not sec:
        conn.close()
        return jsonify({"error": "Forbidden"}), 403

    conn.execute("DELETE FROM records WHERE section_id = ?", (section_id,))
    conn.commit()
    conn.close()

    clear_section_cache(section_id)
    return jsonify({"message": "cleared"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)