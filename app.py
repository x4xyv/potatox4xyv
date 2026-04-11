from flask import Flask, request, jsonify
from flask_cors import CORS
import uuid
import time
import os
from database import init_db, get_db

app = Flask(__name__)
CORS(app)

init_db()


# ---------- مساعدة ----------
def get_user_id():
    """استخراج user_id من الـ header مع التحقق من صحته."""
    raw = request.headers.get('X-Telegram-User-Id')
    if not raw:
        return None
    try:
        return int(raw)
    except (ValueError, TypeError):
        return None


def ensure_user(conn, user_id):
    """إنشاء المستخدم إن لم يكن موجوداً."""
    if not conn.execute("SELECT 1 FROM users WHERE user_id=?", (user_id,)).fetchone():
        conn.execute(
            "INSERT INTO users (user_id, created_at) VALUES (?,?)",
            (user_id, int(time.time() * 1000))
        )
        conn.commit()


# ---------- الأقسام ----------
@app.route('/api/sections', methods=['GET'])
def get_sections():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({"error": "Missing user_id"}), 401

    conn = get_db()
    try:
        ensure_user(conn, user_id)
        rows = conn.execute(
            '''SELECT s.*,
               COALESCE((SELECT COUNT(*) FROM records r WHERE r.section_id = s.id), 0) AS record_count
               FROM sections s
               WHERE s.user_id = ?
               ORDER BY s.pinned DESC, s.name COLLATE NOCASE''',
            (user_id,)
        ).fetchall()
        return jsonify([dict(r) for r in rows])
    finally:
        conn.close()


@app.route('/api/sections', methods=['POST'])
def create_section():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({"error": "Missing user_id"}), 401

    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "Name required"}), 400

    section_id = str(uuid.uuid4())
    unit  = (data.get('unit') or '').strip()
    color = data.get('color', '#f5c842')
    icon  = data.get('icon', '📁')

    conn = get_db()
    try:
        ensure_user(conn, user_id)
        conn.execute(
            "INSERT INTO sections (id, user_id, name, unit, color, icon, pinned, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (section_id, user_id, name, unit, color, icon, 0, int(time.time() * 1000))
        )
        conn.commit()
        return jsonify({"id": section_id, "message": "created"}), 201
    finally:
        conn.close()


@app.route('/api/sections/<section_id>', methods=['PUT'])
def update_section(section_id):
    """تعديل بيانات قسم موجود — كان مفقوداً من قبل."""
    user_id = get_user_id()
    if user_id is None:
        return jsonify({"error": "Missing user_id"}), 401

    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "Name required"}), 400

    unit  = (data.get('unit') or '').strip()
    color = data.get('color', '#f5c842')
    icon  = data.get('icon', '📁')

    conn = get_db()
    try:
        row = conn.execute(
            "SELECT 1 FROM sections WHERE id=? AND user_id=?", (section_id, user_id)
        ).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        conn.execute(
            "UPDATE sections SET name=?, unit=?, color=?, icon=? WHERE id=? AND user_id=?",
            (name, unit, color, icon, section_id, user_id)
        )
        conn.commit()
        return jsonify({"message": "updated"})
    finally:
        conn.close()


@app.route('/api/sections/<section_id>', methods=['DELETE'])
def delete_section(section_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({"error": "Missing user_id"}), 401

    conn = get_db()
    try:
        conn.execute("DELETE FROM records  WHERE section_id=?",            (section_id,))
        conn.execute("DELETE FROM sections WHERE id=? AND user_id=?", (section_id, user_id))
        conn.commit()
        return jsonify({"message": "deleted"})
    finally:
        conn.close()


@app.route('/api/sections/<section_id>/pin', methods=['PATCH'])
def pin_section(section_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({"error": "Missing user_id"}), 401

    conn = get_db()
    try:
        row = conn.execute(
            "SELECT pinned FROM sections WHERE id=? AND user_id=?", (section_id, user_id)
        ).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404
        conn.execute(
            "UPDATE sections SET pinned=? WHERE id=? AND user_id=?",
            (0 if row['pinned'] else 1, section_id, user_id)
        )
        conn.commit()
        return jsonify({"message": "ok"})
    finally:
        conn.close()


# ---------- العمليات ----------
@app.route('/api/records', methods=['GET'])
def get_records():
    section_id = request.args.get('section_id')
    if not section_id:
        return jsonify({"error": "section_id required"}), 400

    user_id = get_user_id()
    if user_id is None:
        return jsonify({"error": "Missing user_id"}), 401

    conn = get_db()
    try:
        sec = conn.execute(
            "SELECT 1 FROM sections WHERE id=? AND user_id=?", (section_id, user_id)
        ).fetchone()
        if not sec:
            return jsonify({"error": "Forbidden"}), 403

        rows = conn.execute(
            "SELECT * FROM records WHERE section_id=? ORDER BY pinned DESC, ts ASC",
            (section_id,)
        ).fetchall()
        return jsonify([dict(r) for r in rows])
    finally:
        conn.close()


@app.route('/api/records', methods=['POST'])
def add_record():
    user_id = get_user_id()
    if user_id is None:
        return jsonify({"error": "Missing user_id"}), 401

    data = request.get_json(silent=True) or {}
    section_id = data.get('section_id')
    op         = data.get('op')
    num        = data.get('num')

    if not section_id or not op or num is None:
        return jsonify({"error": "Missing fields"}), 400

    conn = get_db()
    try:
        sec = conn.execute(
            "SELECT 1 FROM sections WHERE id=? AND user_id=?", (section_id, user_id)
        ).fetchone()
        if not sec:
            return jsonify({"error": "Forbidden"}), 403

        record_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO records (id, section_id, op, num, label, note, ts, pinned) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (record_id, section_id, op, float(num),
             data.get('label', ''), data.get('note', ''),
             int(time.time() * 1000), 0)
        )
        conn.commit()
        return jsonify({"id": record_id, "message": "created"}), 201
    finally:
        conn.close()


@app.route('/api/records/<record_id>', methods=['PUT'])
def update_record(record_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({"error": "Missing user_id"}), 401

    data = request.get_json(silent=True) or {}

    conn = get_db()
    try:
        row = conn.execute(
            '''SELECT sections.user_id FROM records
               JOIN sections ON records.section_id = sections.id
               WHERE records.id=?''',
            (record_id,)
        ).fetchone()
        if not row or row['user_id'] != user_id:
            return jsonify({"error": "Forbidden"}), 403

        op  = data.get('op', '+')
        num = float(data.get('num', 0))
        conn.execute(
            "UPDATE records SET op=?, num=?, label=?, note=? WHERE id=?",
            (op, num, data.get('label', ''), data.get('note', ''), record_id)
        )
        conn.commit()
        return jsonify({"message": "updated"})
    finally:
        conn.close()


@app.route('/api/records/<record_id>', methods=['DELETE'])
def delete_record(record_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({"error": "Missing user_id"}), 401

    conn = get_db()
    try:
        row = conn.execute(
            '''SELECT sections.user_id FROM records
               JOIN sections ON records.section_id = sections.id
               WHERE records.id=?''',
            (record_id,)
        ).fetchone()
        if not row or row['user_id'] != user_id:
            return jsonify({"error": "Forbidden"}), 403

        conn.execute("DELETE FROM records WHERE id=?", (record_id,))
        conn.commit()
        return jsonify({"message": "deleted"})
    finally:
        conn.close()


@app.route('/api/records/<record_id>/pin', methods=['PATCH'])
def pin_record(record_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({"error": "Missing user_id"}), 401

    conn = get_db()
    try:
        row = conn.execute(
            '''SELECT records.pinned FROM records
               JOIN sections ON records.section_id = sections.id
               WHERE records.id=? AND sections.user_id=?''',
            (record_id, user_id)
        ).fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404

        conn.execute(
            "UPDATE records SET pinned=? WHERE id=?",
            (0 if row['pinned'] else 1, record_id)
        )
        conn.commit()
        return jsonify({"message": "ok"})
    finally:
        conn.close()


@app.route('/api/sections/<section_id>/clear', methods=['DELETE'])
def clear_records(section_id):
    user_id = get_user_id()
    if user_id is None:
        return jsonify({"error": "Missing user_id"}), 401

    conn = get_db()
    try:
        sec = conn.execute(
            "SELECT 1 FROM sections WHERE id=? AND user_id=?", (section_id, user_id)
        ).fetchone()
        if not sec:
            return jsonify({"error": "Forbidden"}), 403

        conn.execute("DELETE FROM records WHERE section_id=?", (section_id,))
        conn.commit()
        return jsonify({"message": "cleared"})
    finally:
        conn.close()


if __name__ == '__main__':
    debug_mode = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=debug_mode)
