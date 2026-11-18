'use strict';

const {randomUUID} = require('node:crypto');
const {pool} = require('./postgres.cjs');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const scope = "workspace='live' AND kind='personal-item'";
const owned = scope + " AND id=$1 AND data->>'ownerId'=$2";

function personalWorkspace(ownerId) {
  if (typeof ownerId !== 'string' || !uuidPattern.test(ownerId)) throw new Error('Invalid workspace identity');
  const query = (sql, params) => pool().query(sql, params);
  const key = id => [ownerId + ':' + id, ownerId];
  const item = ({id, data}) => ({
    id: id.slice(ownerId.length + 1),
    kind: data.kind,
    title: data.title,
    detail: data.detail,
    dueOn: data.dueOn,
    dueTime: data.dueTime,
    done: data.done,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    version: data.version,
  });

  async function list() {
    const rows = await query(
      "SELECT id,data FROM nh_documents WHERE " + scope + " AND id LIKE $1 AND data->>'ownerId'=$2 ORDER BY updated DESC,id",
      [ownerId + ':%', ownerId],
    );
    return rows.rows.map(item);
  }

  async function get(id) {
    const row = (await query('SELECT id,data FROM nh_documents WHERE ' + owned, key(id))).rows[0];
    return row ? item(row) : null;
  }

  async function create(draft, id = randomUUID()) {
    const now = new Date().toISOString();
    const data = {...draft, ownerId, createdAt: now, updatedAt: now, version: 1};
    const row = (await query(
      "INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-item',$1,$2) ON CONFLICT DO NOTHING RETURNING id,data",
      [key(id)[0], JSON.stringify(data)],
    )).rows[0];
    if (row) return item(row);
    const saved = await get(id);
    if (saved && saved.version === 1 && Object.keys(draft).every(field => saved[field] === draft[field])) return saved;
    return null;
  }

  async function update(previous, draft) {
    const data = {
      ...draft,
      ownerId,
      createdAt: previous.createdAt,
      updatedAt: new Date().toISOString(),
      version: previous.version + 1,
    };
    const row = (await query(
      "UPDATE nh_documents SET data=$3,updated=clock_timestamp() WHERE " + owned + " AND data->>'version'=$4 RETURNING id,data",
      [...key(previous.id), JSON.stringify(data), String(previous.version)],
    )).rows[0];
    return row ? item(row) : null;
  }

  async function remove(id, version) {
    return (await query(
      "DELETE FROM nh_documents WHERE " + owned + " AND data->>'version'=$3 RETURNING id",
      [...key(id), String(version)],
    )).rows.length === 1;
  }

  return {list, get, create, update, remove};
}

module.exports = {personalWorkspace, uuidPattern};
