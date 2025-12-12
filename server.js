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
  const { username, password } = req.body || {};

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ token: ADMIN_TOKEN });
  }
  return res.status(401).json({ error: "Usuário ou senha inválidos" });
});

// Itens (listagem - você pode usar só no admin no front)
app.get("/api/items", (req, res) => {
  db.all("SELECT * FROM items ORDER BY id", [], (err, rows) => {
    if (err) {
      console.error("Erro ao listar itens:", err);
      return res.status(500).json({ error: "Erro ao listar itens" });
    }
    return res.json(rows);
  });
});

// Criar item (admin)
app.post("/api/items", requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Nome do item é obrigatório" });
  }

  const itemName = name.trim();
  db.run("INSERT INTO items (name) VALUES (?)", [itemName], function (err) {
    if (err) {
      console.error("Erro ao inserir item:", err);
      return res.status(500).json({ error: "Erro ao inserir item" });
    }
    return res.json({ id: this.lastID, name: itemName });
  });
});

// Remover item (admin)
app.delete("/api/items/:id", requireAdmin, (req, res) => {
  db.run("DELETE FROM items WHERE id = ?", [req.params.id], function (err) {
    if (err) {
      console.error("Erro ao remover item:", err);
      return res.status(500).json({ error: "Erro ao remover item" });
    }
    return res.json({ success: true });
  });
});

// Sorteios (PÚBLICO - para todos verem)
app.get("/api/draws", (req, res) => {
  const sql = `
    SELECT d.id, d.person_name, d.created_at, i.name AS item_name 
    FROM draws d 
    JOIN items i ON d.item_id = i.id
    ORDER BY d.created_at DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error("Erro ao listar sorteios:", err);
      return res.status(500).json({ error: "Erro ao listar sorteios" });
    }
    return res.json(rows);
  });
});

// Realizar sorteio
app.post("/api/draw", (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Digite seu nome." });
  }
  const personName = name.trim();

  // Verifica se já existe sorteio para essa pessoa
  const checkSql = `
    SELECT d.*, i.name AS item_name 
    FROM draws d
    JOIN items i ON d.item_id = i.id
    WHERE d.person_name = ?
  `;

  db.get(checkSql, [personName], (err, row) => {
    if (err) {
      console.error("Erro ao verificar sorteio:", err);
      return res.status(500).json({ error: "Erro ao verificar sorteio" });
    }

    if (row) {
      return res.json({ item: row.item_name, alreadyAssigned: true });
    }

    // Busca itens e balanceia por menos usados
    const sqlItems = `
      SELECT items.id, items.name, COUNT(draws.id) AS used_count
      FROM items
      LEFT JOIN draws ON items.id = draws.item_id
      GROUP BY items.id
      ORDER BY used_count ASC
    `;

    db.all(sqlItems, [], (err2, items) => {
      if (err2) {
        console.error("Erro ao buscar itens:", err2);
        return res.status(500).json({ error: "Erro ao buscar itens" });
      }

      if (!items || items.length === 0) {
        return res.status(400).json({
          error: "Nenhuma opção cadastrada ainda. Peça para o admin cadastrar."
        });
      }

      const minCount = items[0].used_count;
      const filtered = items.filter(i => i.used_count === minCount);
      const sorteado = filtered[Math.floor(Math.random() * filtered.length)];

      db.run(
        "INSERT INTO draws (person_name, item_id) VALUES (?, ?)",
        [personName, sorteado.id],
        function (err3) {
          if (err3) {
            console.error("Erro ao salvar sorteio:", err3);
            return res.status(500).json({ error: "Erro ao salvar sorteio" });
          }
          return res.json({ item: sorteado.name, alreadyAssigned: false });
        }
      );
    });
  });
});

app.listen(PORT, () => {
  console.log("Rodando na porta " + PORT);
});
