import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/home/ally-landry/.hermes/kanban.db', { readOnly: true });
const taskIds = ['t_81cfe25b','t_810c8eff','t_523bddc8','t_392afdad','t_b24b876e','t_9c41f1ef','t_09185843','t_5c12e080','t_9090d2bf','t_61efec6d'];
for (const id of taskIds) {
  const rows = db.prepare("SELECT id, task_id, status, outcome, summary, error, metadata FROM task_runs WHERE task_id = ? ORDER BY id DESC LIMIT 1").all(id);
  console.log(id, rows);
}
db.close();