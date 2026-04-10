from flask import Flask, request, jsonify
from flask_cors import CORS
import uuid
import time
from database import init_db, get_db

app = Flask(__name__)
CORS(app)  # يسمح للموقع بالاتصال

init_db()

# ---------- مساعدة ----------
def get_user_data(user_id):
    conn = get_db()
    user = conn.execute("SELECT 1 FROM users WHERE user_id = ?", (user_id,)).fetchone()
    if not user:
        conn.execute("INSERT INTO users (user_id, created_at) VALUES (?, ?)",
                     (user_id, int(time.time() * 1000)))
        conn.commit()
    conn.close()

# ---------- الأقسام ----------
@app.route('/api/sections', methods=['GET'])
def get_sections():
    user_id = request.headers.get('X-Telegram-User-Id')
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 401
    user_id = int(user_id)
    get_user_data(user_id)
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM sections WHERE user_id = ? ORDER BY pinned DESC, name COLLATE NOCASE",
        (user_id,)
    ).fetchall()
    sections = [dict(row) for row in rows]
    conn.close()
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
    return jsonify({"id": section_id, "message": "created"}), 201

@app.route('/api/sections/<section_id>', methods=['DELETE'])
def delete_section(section_id):
    user_id = request.headers.get('X-Telegram-User-Id')
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 401
    user_id = int(user_id)
    conn = get_db()
    conn.execute("DELETE FROM records WHERE section_id = ?", (section_id,))
    conn.execute("DELETE FROM sections WHERE id = ? AND user_id = ?", (section_id, user_id))
    conn.commit()
    conn.close()
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
        conn.execute("UPDATE sections SET pinned = ? WHERE id = ? AND user_id = ?", (new_pin, section_id, user_id))
        conn.commit()
    conn.close()
    return jsonify({"message": "ok"})

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
    conn = get_db()
    # تأكد أن القسم يخص المستخدم
    sec = conn.execute("SELECT 1 FROM sections WHERE id = ? AND user_id = ?", (section_id, user_id)).fetchone()
    if not sec:
        return jsonify({"error": "Forbidden"}), 403
    rows = conn.execute(
        "SELECT * FROM records WHERE section_id = ? ORDER BY pinned DESC, ts ASC",
        (section_id,)
    ).fetchall()
    records = [dict(row) for row in rows]
    conn.close()
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
        return jsonify({"error": "Forbidden"}), 403
    record_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO records (id, section_id, op, num, label, note, ts, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (record_id, section_id, op, num, label, note, int(time.time() * 1000), 0)
    )
    conn.commit()
    conn.close()
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
    # تأكد أن السجل يخص المستخدم عبر section
    row = conn.execute('''SELECT sections.user_id FROM records 
                          JOIN sections ON records.section_id = sections.id 
                          WHERE records.id = ?''', (record_id,)).fetchone()
    if not row or row['user_id'] != user_id:
        return jsonify({"error": "Forbidden"}), 403
    conn.execute("UPDATE records SET op=?, num=?, label=?, note=? WHERE id=?",
                 (op, num, label, note, record_id))
    conn.commit()
    conn.close()
    return jsonify({"message": "updated"})

@app.route('/api/records/<record_id>', methods=['DELETE'])
def delete_record(record_id):
    user_id = request.headers.get('X-Telegram-User-Id')
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 401
    user_id = int(user_id)
    conn = get_db()
    row = conn.execute('''SELECT sections.user_id FROM records 
                          JOIN sections ON records.section_id = sections.id 
                          WHERE records.id = ?''', (record_id,)).fetchone()
    if not row or row['user_id'] != user_id:
        return jsonify({"error": "Forbidden"}), 403
    conn.execute("DELETE FROM records WHERE id = ?", (record_id,))
    conn.commit()
    conn.close()
    return jsonify({"message": "deleted"})

@app.route('/api/records/<record_id>/pin', methods=['PATCH'])
def pin_record(record_id):
    user_id = request.headers.get('X-Telegram-User-Id')
    if not user_id:
        return jsonify({"error": "Missing user_id"}), 401
    user_id = int(user_id)
    conn = get_db()
    row = conn.execute('''SELECT pinned FROM records 
                          JOIN sections ON records.section_id = sections.id 
                          WHERE records.id = ? AND sections.user_id = ?''', (record_id, user_id)).fetchone()
    if row:
        new_pin = 0 if row['pinned'] else 1
        conn.execute("UPDATE records SET pinned = ? WHERE id = ?", (new_pin, record_id))
        conn.commit()
    conn.close()
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
        return jsonify({"error": "Forbidden"}), 403
    conn.execute("DELETE FROM records WHERE section_id = ?", (section_id,))
    conn.commit()
    conn.close()
    return jsonify({"message": "cleared"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)