const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database("party.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS draws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_name TEXT NOT NULL UNIQUE,
      item_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES items(id)
    )
  `);
});

// LOGIN FIXO
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin";
const ADMIN_TOKEN = "TOKEN_ADMIN_123";

function isAdmin(req) {
  const auth = req.headers["authorization"] || "";
  return auth === `Bearer ${ADMIN_TOKEN}`;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: "Não autorizado" });
  next();
}

// Login admin
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ token: ADMIN_TOKEN });
  }
  res.status(401).json({ error: "Usuário ou senha inválidos" });
});

// Itens (público para listar)
app.get("/api/items", (req, res) => {
  db.all("SELECT * FROM items", [], (err, rows) => {
    res.json(rows);
  });
});

// Criar item (admin)
app.post("/api/items", requireAdmin, (req, res) => {
  const { name } = req.body;

  db.run("INSERT INTO items (name) VALUES (?)", [name], function (err) {
    res.json({ id: this.lastID, name });
  });
});

// Remover item (admin)
app.delete("/api/items/:id", requireAdmin, (req, res) => {
  db.run("DELETE FROM items WHERE id = ?", [req.params.id], function () {
    res.json({ success: true });
  });
});

// Sorteios (AGORA PÚBLICO!)
app.get("/api/draws", (req, res) => {
  const sql = `
    SELECT d.id, d.person_name, d.created_at, i.name AS item_name 
    FROM draws d 
    JOIN items i ON d.item_id = i.id
    ORDER BY d.created_at DESC
  `;
  db.all(sql, [], (err, rows) => res.json(rows));
});

// Realizar sorteio
app.post("/api/draw", (req, res) => {
  const { name } = req.body;
  const personName = name.trim();

  // Verifica se já existe
  const checkSql = `
    SELECT d.*, i.name AS item_name 
    FROM draws d
    JOIN items i ON d.item_id = i.id
    WHERE d.person_name = ?
  `;

  db.get(checkSql, [personName], (err, row) => {
    if (row) {
      return res.json({ item: row.item_name, alreadyAssigned: true });
    }

    const sqlItems = `
      SELECT items.id, items.name, COUNT(draws.id) AS used_count
      FROM items
      LEFT JOIN draws ON items.id = draws.item_id
      GROUP BY items.id
      ORDER BY used_count ASC
    `;

    db.all(sqlItems, [], (err2, items) => {
      const minCount = items[0].used_count;
      const filtered = items.filter(i => i.used_count === minCount);
      const sorteado = filtered[Math.floor(Math.random() * filtered.length)];

      db.run(
        "INSERT INTO draws (person_name, item_id) VALUES (?, ?)",
        [personName, sorteado.id],
        function () {
          res.json({ item: sorteado.name, alreadyAssigned: false });
        }
      );
    });
  });
});

app.listen(PORT, () => {
  console.log("Rodando na porta " + PORT);
});

